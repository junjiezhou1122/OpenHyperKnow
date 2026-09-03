import { config } from "./config.js";
import {
  runCourseGeneration,
  resolvePendingProfile,
  resolveBlueprintConfirm,
  type CourseStructure,
  type Unit,
} from "./agents/teacher.js";
import { runWhiteboardSession, resolveAsk } from "./agents/whiteboard.js";
import { listCourses, getCourse, saveCourse, updateProgress, deleteCourse } from "./db/store.js";

import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";

const app = Fastify({ logger: false });
await app.register(cors, { origin: config.corsOrigin });
await app.register(websocket);

/* ------------------------------------------------------------------ */
/* REST: courses CRUD + progress                                       */
/* ------------------------------------------------------------------ */

app.get("/api/health", async () => ({ ok: true, version: "0.2.0" }));

app.get("/api/courses", async () => {
  const all = await listCourses();
  return all.map((c) => ({
    id: c.id,
    topic: c.topic,
    createdAt: c.createdAt,
    title: (c.course as any)?.title ?? c.topic,
    description: (c.course as any)?.description ?? "",
    unitCount: (c.course as any)?.units?.length ?? 0,
    progress: c.progress ?? {},
  }));
});

app.get("/api/courses/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const c = await getCourse(id);
  if (!c) return reply.code(404).send({ error: "not found" });
  return c;
});

app.delete("/api/courses/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const ok = await deleteCourse(id);
  return ok ? { ok: true } : reply.code(404).send({ error: "not found" });
});

app.post("/api/courses/:id/progress", async (req, reply) => {
  const { id } = req.params as { id: string };
  const { key, status } = req.body as { key: string; status: string };
  const c = await updateProgress(id, key, status);
  if (!c) return reply.code(404).send({ error: "not found" });
  return { ok: true, progress: c.progress };
});

/* ------------------------------------------------------------------ */
/* WebSocket: course generation + whiteboard                           */
/* ------------------------------------------------------------------ */

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

  app.get("/api/v1/course-generation/ws", { websocket: true }, (socket) => {
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
          const topic = String(msg.query ?? "");
          // Accumulate outline + units into the final course
          let course: (CourseStructure & { _outlineDone?: boolean }) | null = null;
          const origSend = socket.send.bind(socket);
          socket.send = (raw: any) => {
            const m = typeof raw === "string" ? JSON.parse(raw) : raw;
            if (m.type === "course_structure_ready") {
              course = { ...m.structure, units: [], _outlineDone: true };
            } else if (m.type === "unit_ready" && course) {
              course.units[m.unit_index] = m.unit;
            } else if (m.type === "complete" && course) {
              const units = course.units.filter(Boolean);
              if (units.length > 0) {
                const { _outlineDone, ...final } = course;
                final.units = units;
                saveCourse(topic, final).then((stored) => {
                  origSend(JSON.stringify({ type: "course_generation_complete", course: final, courseId: stored.id }));
                });
              }
            }
            origSend(raw);
          };
          try {
            await runCourseGeneration({
              topic,
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

        case "course_generation_answers":
          resolvePendingProfile(msg.answers);
          break;

        case "blueprint_confirm":
          resolveBlueprintConfirm(Boolean(msg.confirmed), msg.feedback);
          break;

        case "stop_course_generation":
          socket.close();
          break;

        default:
          break;
      }
    });
  });
});

app.listen({ port: config.port, host: config.host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
