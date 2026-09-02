import { config } from "./config.js";
import { runCourseGeneration, resolvePendingProfile, type CourseStructure, type Unit } from "./agents/teacher.js";
import { runWhiteboardSession, resolveAsk } from "./agents/whiteboard.js";

const server = config; // keep import for side-effect (dotenv)

import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";

const app = Fastify({ logger: true });
await app.register(cors, { origin: config.corsOrigin });
await app.register(websocket);

/** In-memory course store (Phase 1 — swap for Supabase later). */
const courses = new Map<string, unknown>();

app.get("/api/health", async () => ({ ok: true, version: "0.1.0" }));

app.get("/api/courses", async () => {
  return Array.from(courses.entries()).map(([id, course]) => ({ id, course }));
});

app.get("/api/courses/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const course = courses.get(id);
  if (!course) return reply.code(404).send({ error: "not found" });
  return course;
});

app.register(async (app) => {
  app.get("/api/v1/whiteboard/ws", { websocket: true }, (socket) => {
    socket.on("message", async (raw: Buffer) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (msg.type) {
        case "ping":
          socket.send(JSON.stringify({ type: "pong", t: msg.t ?? Date.now() }));
          break;

        case "start_session":
        case "resume_or_start_course_session": {
          try {
            await runWhiteboardSession({
              lectureTitle: String(msg.lecture_title ?? msg.topic ?? "Introduction"),
              lectureOutline: msg.lecture_outline,
              provider: msg.provider,
              model: msg.model,
              thinkingLevel: msg.thinking_level,
              ws: socket,
            });
          } catch (err) {
            socket.send(JSON.stringify({ type: "error", message: err instanceof Error ? err.message : String(err) }));
          }
          break;
        }

        case "user_message":
          // student answered an ask() prompt (or free-text interjection)
          resolveAsk(socket, String(msg.message ?? ""));
          break;

        case "question_answers":
          resolveAsk(socket, JSON.stringify(msg.answers));
          break;

        case "stop_generation":
          socket.close();
          break;

        default:
          break;
      }
    });
  });

  app.get("/api/v1/course-generation/ws", { websocket: true }, (socket, req) => {
    let busy = false;

    socket.on("message", async (raw: Buffer) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (msg.type) {
        case "ping":
          socket.send(JSON.stringify({ type: "pong", ts: Date.now() }));
          break;

        case "start_course_generation": {
          if (busy) {
            socket.send(JSON.stringify({ type: "course_generation_error", message: "generation already running" }));
            return;
          }
          busy = true;
          // Accumulate outline + units into the final course
          let course: (CourseStructure & { _outlineDone?: boolean }) | null = null;
          const wrappedSend = socket.send.bind(socket);
          socket.send = (raw: any) => {
            const msg = typeof raw === "string" ? JSON.parse(raw) : raw;
            if (msg.type === "course_structure_ready") {
              course = { ...msg.structure, units: [], _outlineDone: true };
            } else if (msg.type === "unit_ready" && course) {
              course.units[msg.unit_index] = msg.unit;
            } else if (msg.type === "complete" && course) {
              const units = course.units.filter(Boolean);
              if (units.length > 0) {
                const { _outlineDone, ...final } = course;
                final.units = units;
                courses.set(crypto.randomUUID(), final);
                wrappedSend(JSON.stringify({ type: "course_generation_complete", course: final }));
              }
            }
            wrappedSend(raw);
          };
          try {
            // ⭐️ provider/model come from the client — user-specifiable, not fixed
            await runCourseGeneration({
              topic: String(msg.query ?? ""),
              provider: msg.provider,
              model: msg.model,
              thinkingLevel: msg.thinking_level,
              ws: socket,
            });
          } finally {
            busy = false;
          }
          break;
        }

        case "course_generation_answers": {
          resolvePendingProfile(msg.answers);
          break;
        }

        case "stop_course_generation":
          socket.close();
          break;

        default:
          break;
      }
    });

    socket.on("close", () => {
      /* session cleanup handled by runCourseGeneration's finally */
    });
  });
});

app.listen({ port: config.port, host: config.host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
