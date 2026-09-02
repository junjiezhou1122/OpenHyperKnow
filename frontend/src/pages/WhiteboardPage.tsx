/**
 * Whiteboard — Hyperknow-style teaching canvas.
 *
 * Left: narration stream (assistant messages + action log).
 * Right: column-based canvas with note cards, mermaid diagrams,
 * highlights, multi-page nav, and ask() prompts.
 */
import { useEffect, useRef, useReducer, useCallback, useState } from "react";

/* ---------------- protocol ---------------- */

type ServerEvent =
  | { type: "session_ready"; session_id: string }
  | { type: "speak"; step_id: number; spoken_text: string }
  | { type: "new_page"; step_id: number; page_id: string; title: string }
  | { type: "board"; step_id: number; board_uid?: number; board_content: string; title?: string }
  | { type: "graph"; step_id: number; mermaid: string }
  | { type: "highlight"; step_id: number; target_board_id?: number; snippet?: string; color?: string }
  | { type: "ask"; step_id: number; question: string; mode: "choice" | "open"; options?: string[] }
  | { type: "response_complete" }
  | { type: "error"; message: string }
  | { type: "pong"; t?: number };

interface BoardCard {
  kind: "note_card";
  uid: number;
  content: string;
  title?: string;
  highlights: { snippet?: string; color?: string }[];
}
interface BoardGraph {
  kind: "mermaid_graph";
  source: string;
}
type BoardItem = BoardCard | BoardGraph;

interface Narration {
  kind: "speak" | "action" | "ask";
  text: string;
  detail?: string;
}

interface BoardPage {
  id: string;
  title: string;
  items: BoardItem[];
}

interface WhiteboardState {
  sessionId: string | null;
  narration: Narration[];
  pages: BoardPage[];
  activePage: number;
  activeAsk: { step_id: number; question: string; mode: "choice" | "open"; options?: string[] } | null;
  status: "connecting" | "teaching" | "done" | "error";
  error: string | null;
}

const initialState = (): WhiteboardState => ({
  sessionId: null,
  narration: [],
  pages: [{ id: "page-1", title: "Lecture", items: [] }],
  activePage: 0,
  activeAsk: null,
  status: "connecting",
  error: null,
});

type Action =
  | { type: "event"; event: ServerEvent }
  | { type: "status"; status: WhiteboardState["status"] }
  | { type: "gotoPage"; index: number }
  | { type: "clearAsk" };

function reducer(state: WhiteboardState, action: Action): WhiteboardState {
  switch (action.type) {
    case "status":
      return { ...state, status: action.status };
    case "gotoPage":
      return { ...state, activePage: action.index };
    case "clearAsk":
      return { ...state, activeAsk: null };

    case "event": {
      const e = action.event;
      switch (e.type) {
        case "session_ready":
          return { ...state, sessionId: e.session_id, status: "teaching" };

        case "speak":
          return { ...state, narration: [...state.narration, { kind: "speak", text: e.spoken_text }] };

        case "new_page": {
          const pages = [...state.pages, { id: e.page_id, title: e.title, items: [] }];
          return { ...state, pages, activePage: pages.length - 1, narration: [...state.narration, { kind: "action", text: `New page: ${e.title}` }] };
        }

        case "board": {
          const pages = state.pages.map((p, i) =>
            i === state.activePage
              ? {
                  ...p,
                  items: [
                    ...p.items,
                    {
                      kind: "note_card" as const,
                      uid: e.board_uid ?? p.items.filter((it) => it.kind === "note_card").length + 1,
                      content: e.board_content,
                      title: e.title,
                      highlights: [],
                    },
                  ],
                }
              : p,
          );
          return { ...state, pages, narration: [...state.narration, { kind: "action", text: e.title ?? "Note card" }] };
        }

        case "graph": {
          const pages = state.pages.map((p, i) =>
            i === state.activePage ? { ...p, items: [...p.items, { kind: "mermaid_graph" as const, source: e.mermaid }] } : p,
          );
          return { ...state, pages, narration: [...state.narration, { kind: "action", text: "Diagram" }] };
        }

        case "highlight": {
          const pages = state.pages.map((p, i) =>
            i === state.activePage
              ? {
                  ...p,
                  items: p.items.map((item) =>
                    item.kind === "note_card" && item.uid === e.target_board_id
                      ? { ...item, highlights: [...item.highlights, { snippet: e.snippet, color: e.color ?? "#ef4444" }] }
                      : item,
                  ),
                }
              : p,
          );
          return { ...state, pages };
        }

        case "ask":
          return {
            ...state,
            activeAsk: { step_id: e.step_id, question: e.question, mode: e.mode, options: e.options },
            narration: [...state.narration, { kind: "ask", text: e.question, detail: e.options?.join(" · ") }],
          };

        case "response_complete":
          return { ...state, status: "done", activeAsk: null };

        case "error":
          return { ...state, status: "error", error: e.message };

        default:
          return state;
      }
    }
  }
}

/* ---------------- component ---------------- */

export function WhiteboardPage({ onBack }: { onBack: () => void }) {
  const [state, dispatch] = useReducer(reducer, null, initialState);
  const wsRef = useRef<WebSocket | null>(null);
  const [answer, setAnswer] = useState("");
  const narrationEndRef = useRef<HTMLDivElement>(null);
  const [topic, setTopic] = useState("");
  const [started, setStarted] = useState(false);

  useEffect(() => {
    narrationEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.narration.length]);

  const connect = useCallback((): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/api/v1/whiteboard/ws`);
      wsRef.current = ws;
      ws.onopen = () => resolve(ws);
      ws.onerror = () => dispatch({ type: "status", status: "error" });
      ws.onmessage = (ev) => {
        try {
          dispatch({ type: "event", event: JSON.parse(ev.data) });
        } catch { /* ignore */ }
      };
    });
  }, []);

  const start = async () => {
    if (!topic.trim()) return;
    setStarted(true);
    const ws = await connect();
    ws.send(JSON.stringify({ type: "start_session", lecture_title: topic, provider: "github-copilot", model: "gpt-4.1", thinking_level: "low" }));
  };

  const sendAnswer = (text: string) => {
    wsRef.current?.send(JSON.stringify({ type: "user_message", message: text }));
    dispatch({ type: "event", event: { type: "speak", step_id: -1, spoken_text: `🧑 You: ${text}` } });
    dispatch({ type: "clearAsk" });
    setAnswer("");
  };

  const page = state.pages[state.activePage] ?? state.pages[0];

  return (
    <div className="flex h-screen flex-col bg-neutral-100">
      {/* Toolbar */}
      <header className="flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-2">
        <button onClick={onBack} className="text-sm text-neutral-500 hover:text-neutral-800">
          ← Back
        </button>
        <span className="font-semibold">Whiteboard</span>
        <div className="ml-auto flex items-center gap-2">
          {/* page nav */}
          <button
            onClick={() => dispatch({ type: "gotoPage", index: Math.max(0, state.activePage - 1) })}
            disabled={state.activePage === 0}
            className="rounded border border-neutral-200 px-2 py-1 text-sm disabled:opacity-30"
          >
            ‹
          </button>
          <span className="text-xs text-neutral-500">
            {state.activePage + 1} / {state.pages.length} · {page?.title}
          </span>
          <button
            onClick={() => dispatch({ type: "gotoPage", index: Math.min(state.pages.length - 1, state.activePage + 1) })}
            disabled={state.activePage >= state.pages.length - 1}
            className="rounded border border-neutral-200 px-2 py-1 text-sm disabled:opacity-30"
          >
            ›
          </button>
          {state.status === "teaching" && <span className="animate-pulse text-xs text-blue-500">● teaching</span>}
          {state.status === "done" && <span className="text-xs text-emerald-500">✓ complete</span>}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Narration sidebar */}
        <aside className="flex w-96 shrink-0 flex-col overflow-y-auto border-r border-neutral-200 bg-white p-4">
          {!started ? (
            <div className="m-auto text-center">
              <p className="mb-3 text-sm text-neutral-500">What should the teacher explain?</p>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && start()}
                placeholder="e.g. Binary Search Trees"
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
              <button onClick={start} disabled={!topic.trim()} className="mt-2 w-full rounded-lg bg-neutral-900 py-2 text-sm text-white disabled:opacity-40">
                Start lecture
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {state.narration.map((n, i) => (
                <div key={i} className={n.kind === "speak" ? "" : n.kind === "ask" ? "rounded-lg bg-amber-50 border border-amber-200 p-2" : "text-xs text-neutral-400"}>
                  {n.kind === "speak" ? (
                    <p className="text-sm leading-relaxed text-neutral-800">{n.text}</p>
                  ) : n.kind === "ask" ? (
                    <p className="text-sm font-medium text-amber-800">❓ {n.text}</p>
                  ) : (
                    <p>✏️ {n.text}</p>
                  )}
                </div>
              ))}
              <div ref={narrationEndRef} />
            </div>
          )}
        </aside>

        {/* Canvas */}
        <main className="flex-1 overflow-auto bg-[radial-gradient(circle,_#e5e5e5_1px,_transparent_1px)] [background-size:24px_24px] p-8">
          <div className="mx-auto max-w-4xl space-y-5">
            {page?.items.map((item, i) =>
              item.kind === "note_card" ? (
                <NoteCard key={i} card={item} />
              ) : (
                <MermaidCard key={i} source={item.source} />
              ),
            )}
            {page?.items.length === 0 && started && (
              <div className="py-24 text-center text-sm text-neutral-400">
                {state.status === "teaching" ? "The teacher is sketching…" : "Board is empty"}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Ask bar */}
      {state.activeAsk && (
        <div className="border-t border-amber-200 bg-amber-50 p-4">
          <div className="mx-auto max-w-3xl">
            <p className="mb-2 text-sm font-medium text-amber-900">❓ {state.activeAsk.question}</p>
            {state.activeAsk.mode === "choice" && state.activeAsk.options ? (
              <div className="flex flex-wrap gap-2">
                {state.activeAsk.options.map((o) => (
                  <button key={o} onClick={() => sendAnswer(o)} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm hover:border-amber-500">
                    {o}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && answer.trim() && sendAnswer(answer)}
                  placeholder="Type your answer..."
                  className="flex-1 rounded-lg border border-amber-300 px-3 py-2 text-sm"
                />
                <button onClick={() => answer.trim() && sendAnswer(answer)} className="rounded-lg bg-amber-500 px-4 py-2 text-sm text-white">
                  Send
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {state.status === "error" && (
        <div className="border-t border-red-200 bg-red-50 p-3 text-sm text-red-700">{state.error}</div>
      )}
    </div>
  );
}

/* ---------------- board elements ---------------- */

function NoteCard({ card }: { card: BoardCard }) {
  const [revealed, setRevealed] = useState(false);
  // entrance animation
  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), 30);
    return () => clearTimeout(t);
  }, []);

  // simple highlight rendering: wrap matched snippet in a mark
  let content = card.content;
  for (const h of card.highlights) {
    if (h.snippet && content.includes(h.snippet)) {
      content = content.replaceAll(
        h.snippet,
        `<mark style="background:${h.color}22; color:${h.color}; border-bottom: 2px solid ${h.color}; padding: 0 2px; border-radius: 3px;">${h.snippet}</mark>`,
      );
    }
  }

  return (
    <div
      className={`transition-all duration-500 ${revealed ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`}
      style={{ fontFamily: "'Kalam', 'Comic Sans MS', cursive" }}
    >
      <div className="relative rounded-lg border-2 border-neutral-800/70 bg-[#fffdf5] p-5 shadow-[3px_4px_0_rgba(0,0,0,0.08)]">
        {/* highlight decorations indicator */}
        {card.highlights.length > 0 && (
          <div className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-xs text-white">
            ◎
          </div>
        )}
        <div
          className="prose prose-sm max-w-none [&_code]:text-xs [&_h1]:text-lg [&_h2]:text-base [&_h3]:font-bold [&_li]:my-0.5 [&_p]:my-2 [&_strong]:font-bold"
          dangerouslySetInnerHTML={{ __html: mdToHtml(content) }}
        />
      </div>
    </div>
  );
}

function MermaidCard({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, theme: "neutral", fontFamily: "'Kalam', cursive" });
        const id = `mermaid-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, source);
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
          const svgEl = ref.current.querySelector("svg");
          if (svgEl) {
            svgEl.style.maxWidth = "100%";
            svgEl.style.height = "auto";
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "render failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  return (
    <div
      className="rounded-lg border-2 border-dashed border-neutral-400 bg-white/80 p-4"
      style={{ fontFamily: "'Kalam', 'Comic Sans MS', cursive" }}
    >
      {error ? (
        <pre className="overflow-x-auto text-xs text-neutral-500">{source}</pre>
      ) : (
        <div ref={ref} className="flex justify-center" />
      )}
    </div>
  );
}

/* minimal markdown → html for card content (bold, code, lists) */
function mdToHtml(md: string): string {
  let html = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, '<code class="rounded bg-black/5 px-1 text-xs">$1</code>');
  // line-based lists and paragraphs
  const lines = html.split("\n");
  let out = "";
  let inList = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(\d+\.|-|\*)\s+/.test(trimmed)) {
      if (!inList) {
        out += '<ul class="my-1 list-disc pl-5">';
        inList = true;
      }
      out += `<li>${trimmed.replace(/^(\d+\.|-|\*)\s+/, "")}</li>`;
    } else {
      if (inList) {
        out += "</ul>";
        inList = false;
      }
      if (trimmed) out += `<p>${trimmed}</p>`;
    }
  }
  if (inList) out += "</ul>";
  return out;
}
