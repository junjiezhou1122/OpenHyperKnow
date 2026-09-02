/**
 * E2E test: connect to course-generation WS, start generation,
 * answer profile questions, expect a full course structure.
 */
import WebSocket from "ws";

const PROVIDER = process.argv[2] ?? "github-copilot";
const MODEL = process.argv[3] ?? "claude-haiku-4.5";
const TOPIC = process.argv[4] ?? "control theory for engineers";

const ws = new WebSocket("ws://localhost:3001/api/v1/course-generation/ws");

const seen = { steps: 0, chunks: 0, questions: null, structure: null, units: [], finalCourse: null, complete: false, errors: [] };
const timer = setTimeout(() => {
  console.error("TIMEOUT. State:", JSON.stringify({ ...seen, questions: seen.questions ? "yes" : null, structure: seen.structure ? Object.keys(seen.structure) : null }, null, 2));
  process.exit(1);
}, 240_000);

ws.on("open", () => {
  console.log(`[ws] open — provider=${PROVIDER} model=${MODEL}`);
  ws.send(JSON.stringify({ type: "ping" }));
  ws.send(JSON.stringify({ type: "start_course_generation", query: TOPIC, provider: PROVIDER, model: MODEL, thinking_level: "low" }));
});

ws.on("message", (raw) => {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }

  switch (msg.type) {
    case "pong":
      console.log("[ws] pong ok");
      break;
    case "agent_step":
      seen.steps++;
      console.log(`[step] ${msg.step} → ${msg.status}`);
      break;
    case "content_chunk":
      seen.chunks++;
      break;
    case "tool_execution":
      console.log(`[tool] ${msg.tool_name} ${msg.tool_status}`);
      break;
    case "questions_step":
      seen.questions = msg.questions;
      console.log(`[questions] got ${msg.questions.length} questions`);
      // Answer them programmatically (simulating the browser UI)
      const answers = {
        prior_knowledge: msg.questions[0]?.options.slice(0, 1).map((o) => o.label) ?? [],
        lens: msg.questions[1]?.options[0]?.label ?? "",
        mastery: msg.questions[2]?.options[1]?.label ?? msg.questions[2]?.options[0]?.label ?? "",
        scale: msg.questions[3]?.options[1]?.label ?? msg.questions[3]?.options[0]?.label ?? "",
      };
      console.log("[answers]", JSON.stringify(answers));
      setTimeout(() => ws.send(JSON.stringify({ type: "course_generation_answers", answers })), 500);
      break;
    case "course_structure_ready":
      seen.structure = msg.structure;
      console.log(`[outline] "${msg.structure.title}" — ${msg.structure.units?.length ?? 0} unit titles`);
      break;
    case "unit_ready":
      seen.units[msg.unit_index] = msg.unit;
      console.log(`[unit ${msg.unit_index}] "${msg.unit.title}" — ${msg.unit.lectures.length} lectures`);
      break;
    case "course_generation_complete":
      seen.finalCourse = msg.course;
      console.log(`[course complete] ${msg.course.units.length} units`);
      break;
    case "course_generation_complete":
      console.log("[done] generation complete");
      break;
    case "complete":
      seen.complete = true;
      console.log(`[summary] chunks=${seen.chunks} steps=${seen.steps}`);
      clearTimeout(timer);
      ws.close();
      verify();
      break;
    case "course_generation_error":
      seen.errors.push(msg.message);
      console.error("[error]", msg.message);
      clearTimeout(timer);
      process.exit(1);
    default:
      break;
  }
});

ws.on("error", (e) => { console.error("[ws error]", e.message); process.exit(1); });

function verify() {
  const s = seen.finalCourse ?? seen.structure;
  const checks = [];
  const check = (name, ok) => { checks.push({ name, ok }); console.log(`${ok ? "✅" : "❌"} ${name}`); };

  check("got 4 profile questions", seen.questions?.length === 4);
  check("q1 is multiple-choice prior knowledge", seen.questions?.[0]?.type === "multiple");
  check("q2/q3/q4 are single", seen.questions?.slice(1).every((q) => q.type === "single"));
  check("outline present", !!seen.structure);
  check("final course assembled", !!seen.finalCourse);
  check("course has title", !!s?.title);
  check("3-10 units", s?.units?.length >= 3 && s?.units?.length <= 10);
  check("each unit has lectures", s?.units?.every((u) => u.lectures?.length >= 2));
  check("each lecture has lessons", s?.units?.every((u) => u.lectures.every((l) => l.lessons?.length >= 1)));
  check("lessons have content", s?.units?.every((u) => u.lectures.every((l) => l.lessons.every((ls) => (ls.content ?? "").length > 100))));
  check("units have assessments", s?.units?.every((u) => u.assessment?.length >= 2));
  check("streamed content chunks", seen.chunks > 0);
  check("complete event", seen.complete);

  const pass = checks.every((c) => c.ok);
  console.log(pass ? "\n🎉 ALL CHECKS PASSED" : "\n💥 SOME CHECKS FAILED");
  process.exit(pass ? 0 : 1);
}
