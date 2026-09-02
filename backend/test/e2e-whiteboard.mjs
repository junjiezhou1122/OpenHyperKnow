/** Whiteboard e2e: session → speak/board/graph elements → ask (interrupt) → done */
import WebSocket from "ws";

const PROVIDER = process.argv[2] ?? "github-copilot";
const MODEL = process.argv[3] ?? "gpt-4.1";

const ws = new WebSocket("ws://localhost:3001/api/v1/whiteboard/ws");
const seen = { speak: 0, board: 0, graph: 0, pages: 0, highlights: 0, asks: 0, askResolved: false, complete: false };
const boardUids = [];

const timer = setTimeout(() => {
  console.error("TIMEOUT. State:", JSON.stringify(seen));
  process.exit(1);
}, 300_000);

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "ping" }));
  ws.send(JSON.stringify({ type: "start_session", lecture_title: "Binary Search Trees", provider: PROVIDER, model: MODEL, thinking_level: "low" }));
});

ws.on("message", (raw) => {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }
  switch (msg.type) {
    case "pong": console.log("[ws] pong"); break;
    case "session_ready": console.log("[session]", msg.session_id); break;
    case "speak":
      seen.speak++;
      console.log(`[speak ${msg.step_id}] ${msg.spoken_text.substring(0, 80)}...`);
      break;
    case "new_page":
      seen.pages++;
      console.log(`[page] ${msg.title}`);
      break;
    case "board":
      seen.board++;
      if (msg.board_uid) boardUids.push(msg.board_uid);
      console.log(`[board ${msg.board_uid}] ${msg.board_content.substring(0, 60)}...`);
      break;
    case "graph":
      seen.graph++;
      console.log(`[graph] ${msg.mermaid.substring(0, 60)}...`);
      break;
    case "highlight":
      seen.highlights++;
      console.log(`[highlight] target=${msg.target_board_id} snippet=${msg.snippet}`);
      break;
    case "ask":
      seen.asks++;
      console.log(`[ask] ${msg.question} mode=${msg.mode} options=${JSON.stringify(msg.options)}`);
      // simulate the student answering after 2s
      setTimeout(() => {
        ws.send(JSON.stringify({ type: "user_message", message: msg.options?.[0] ?? "I think it keeps things sorted" }));
        seen.askResolved = true;
      }, 2000);
      break;
    case "response_complete":
      seen.complete = true;
      clearTimeout(timer);
      verify();
      break;
    case "error":
      console.error("[error]", msg.message);
      clearTimeout(timer);
      process.exit(1);
  }
});

ws.on("error", (e) => { console.error("[ws]", e.message); process.exit(1); });

function verify() {
  const check = (name, ok) => console.log(`${ok ? "✅" : "❌"} ${name}`);
  check("spoke multiple times", seen.speak >= 3);
  check("placed board cards", seen.board >= 2);
  check("at least one graph or 3+ cards", seen.graph >= 1 || seen.board >= 3);
  check("asked the student a question", seen.asks >= 1);
  check("student answer resolved the interrupt", seen.askResolved);
  check("lecture completed", seen.complete);
  const pass = seen.speak >= 3 && seen.board >= 2 && seen.asks >= 1 && seen.askResolved && seen.complete;
  console.log(pass ? "\n🎉 WHITEBOARD E2E PASSED" : "\n💥 FAILED");
  process.exit(pass ? 0 : 1);
}
