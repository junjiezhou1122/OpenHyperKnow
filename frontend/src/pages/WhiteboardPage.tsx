/**
 * Whiteboard page — Hyperknow's exact architecture:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ toolbar: ✕ | title pill | zoom | pages | TTS │
 *   ├───────────────────────────────┬──────────────┤
 *   │                               │ Conversation │
 *   │   Excalidraw (view mode)      │   panel      │
 *   │   + DOM overlay (synced)      │              │
 *   │                               │              │
 *   └───────────────────────────────┴──────────────┘
 *
 * - Excalidraw owns the infinite canvas: pan (drag), zoom (wheel/pinch),
 *   dotted grid, hand-drawn column titles + highlight/circle decorations.
 * - DOM overlay layer (pointer-events:none, z-10) holds React cards whose
 *   positions are recomputed from appState (scrollX/scrollY/zoom) on every
 *   Excalidraw change:  viewport = (scene + scroll) * zoom.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Excalidraw, type ExcalidrawImperativeAPI } from "@excalidraw/excalidraw";
import type { AppState } from "@excalidraw/excalidraw/dist/types/excalidraw/types";
import {
  BoardTitle,
  NoteCard,
  MermaidCard,
  ImageCard,
  AnimationCard,
  type NoteCardData,
} from "../components/board/cards";
import { WobbleFilterDefs, BOARD_BG, FONT_STACK, EXCAL_PURPLE, MARKER_HIGHLIGHT } from "../components/board/theme";

/* ---------------- protocol (mirror of backend) ---------------- */

type ServerEvent =
  | { type: "session_ready"; session_id: string }
  | { type: "speak"; step_id: number; spoken_text: string }
  | { type: "new_page"; step_id: number; page_id: string; title: string }
  | { type: "new_column"; step_id: number; title: string }
  | { type: "board"; step_id: number; board_uid?: number; board_content: string; title?: string }
  | { type: "graph"; step_id: number; mermaid: string }
  | { type: "image_gen_pending"; step_id: number; prompt_preview: string; caption?: string }
  | { type: "generated_image"; step_id: number; image_url: string; width?: number; height?: number; caption?: string }
  | { type: "animation_pending"; step_id: number; task_preview: string }
  | { type: "generated_animation"; step_id: number; html: string; task: string }
  | { type: "highlight"; step_id: number; target_board_id?: number; snippet?: string; color?: string }
  | { type: "ask"; step_id: number; question: string; mode: "choice" | "open"; options?: string[] }
  | { type: "response_complete" }
  | { type: "error"; message: string }
  | { type: "pong"; t?: number };

type BoardItem =
  | { kind: "note_card"; uid: number; sceneX: number; sceneY: number; w: number; data: NoteCardData }
  | { kind: "mermaid_graph"; uid: string; sceneX: number; sceneY: number; w: number; source: string }
  | { kind: "board_image"; uid: string; sceneX: number; sceneY: number; w: number; src: string; caption?: string; pending: boolean }
  | { kind: "board_animation"; uid: string; sceneX: number; sceneY: number; w: number; html: string; task: string; pending: boolean };

interface BoardPage {
  id: string;
  title: string;
  /** column title → items under it */
  columns: { title: string; x: number; items: BoardItem[] }[];
  nextY: number[]; // per-column stacking cursor (scene units)
}

interface Narration {
  kind: "speak" | "action" | "error";
  text: string;
}

interface WhiteboardState {
  sessionId: string | null;
  narration: Narration[];
  pages: BoardPage[];
  activePage: number;
  activeAsk: { step_id: number; question: string; mode: "choice" | "open"; options?: string[] } | null;
  status: "idle" | "teaching" | "done" | "error";
  error: string | null;
}

const COL_W = 445; // scene-unit column width (matches Hyperknow)
const COL_GAP = 60;
const CARD_GAP = 24;
const BOARD_TOP = 60; // leave room for the column title above

const emptyState = (): WhiteboardState => ({
  sessionId: null,
  narration: [],
  pages: [freshPage("page-1", "Lecture")],
  activePage: 0,
  activeAsk: null,
  status: "idle",
  error: null,
});

const freshPage = (id: string, title: string): BoardPage => ({
  id,
  title,
  columns: [],
  nextY: [],
});

type Action =
  | { type: "event"; event: ServerEvent }
  | { type: "gotoPage"; index: number };

function reducer(state: WhiteboardState, action: Action): WhiteboardState {
  switch (action.type) {
    case "gotoPage":
      return { ...state, activePage: action.index };

    case "event": {
      const e = action.event;
      switch (e.type) {
        case "session_ready":
          return { ...state, sessionId: e.session_id, status: "teaching" };

        case "speak":
          return { ...state, narration: [...state.narration, { kind: "speak", text: e.spoken_text }] };

        case "new_page": {
          const pages = [...state.pages, freshPage(e.page_id, e.title)];
          return {
            ...state,
            pages,
            activePage: pages.length - 1,
            narration: [...state.narration, { kind: "action", text: `New page: ${e.title}` }],
          };
        }

        case "new_column": {
          const pages = [...state.pages];
          const page = { ...pages[state.activePage] };
          const colIdx = page.columns.length;
          page.columns = [
            ...page.columns,
            { title: e.title, x: colIdx * (COL_W + COL_GAP), items: [] },
          ];
          page.nextY = [...page.nextY, BOARD_TOP];
          pages[state.activePage] = page;
          return {
            ...state,
            pages,
            narration: [...state.narration, { kind: "action", text: e.title }],
          };
        }

        case "board": {
          const pages = [...state.pages];
          const page = { ...pages[state.activePage] };
          const colIdx = Math.max(0, page.columns.length - 1);
          const col = page.columns[colIdx];
          if (!col) return state;
          const uid = e.board_uid ?? page.columns.reduce((n, c) => n + c.items.filter((i) => i.kind === "note_card").length, 1);
          const y = page.nextY[colIdx] ?? 0;
          const item: BoardItem = {
            kind: "note_card",
            uid,
            sceneX: col.x,
            sceneY: y,
            w: COL_W,
            data: { uid, content: e.board_content, title: colIdx === 0 ? undefined : e.title, highlights: [] },
          };
          // ⭐️ measure later — reserve approx height by content length; the CardSizer fixes it after render
          const estH = 140 + Math.min(600, e.board_content.length * 0.9);
          page.columns = page.columns.map((c, i) =>
            i === colIdx ? { ...c, items: [...c.items, item] } : c,
          );
          page.nextY = [...page.nextY];
          page.nextY[colIdx] = y + estH + CARD_GAP;
          pages[state.activePage] = page;
          return { ...state, pages };
        }

        case "graph": {
          const pages = [...state.pages];
          const page = { ...pages[state.activePage] };
          const colIdx = Math.max(0, page.columns.length - 1);
          const col = page.columns[colIdx];
          if (!col) return state;
          const y = page.nextY[colIdx] ?? 0;
          const item: BoardItem = {
            kind: "mermaid_graph",
            uid: `g-${e.step_id}`,
            sceneX: col.x,
            sceneY: y,
            w: COL_W,
            source: e.mermaid,
          };
          const estH = 300;
          page.columns = page.columns.map((c, i) => (i === colIdx ? { ...c, items: [...c.items, item] } : c));
          page.nextY = [...page.nextY];
          page.nextY[colIdx] = y + estH + CARD_GAP;
          pages[state.activePage] = page;
          return { ...state, pages };
        }

        case "generated_image": {
          const pages = [...state.pages];
          const page = { ...pages[state.activePage] };
          const colIdx = Math.max(0, page.columns.length - 1);
          const y = page.nextY[colIdx] ?? 0;
          const item: BoardItem = {
            kind: "board_image",
            uid: `img-${e.step_id}`,
            sceneX: page.columns[colIdx]?.x ?? 0,
            sceneY: y,
            w: COL_W,
            src: e.image_url,
            caption: e.caption,
            pending: false,
          };
          page.columns = page.columns.map((c, i) => (i === colIdx ? { ...c, items: [...c.items, item] } : c));
          page.nextY = [...page.nextY];
          page.nextY[colIdx] = y + 340 + CARD_GAP;
          pages[state.activePage] = page;
          return { ...state, pages };
        }

        case "generated_animation": {
          const pages = [...state.pages];
          const page = { ...pages[state.activePage] };
          const colIdx = Math.max(0, page.columns.length - 1);
          const y = page.nextY[colIdx] ?? 0;
          const item: BoardItem = {
            kind: "board_animation",
            uid: `anim-${e.step_id}`,
            sceneX: page.columns[colIdx]?.x ?? 0,
            sceneY: y,
            w: COL_W,
            html: e.html,
            task: e.task,
            pending: false,
          };
          page.columns = page.columns.map((c, i) => (i === colIdx ? { ...c, items: [...c.items, item] } : c));
          page.nextY = [...page.nextY];
          page.nextY[colIdx] = y + 380 + CARD_GAP;
          pages[state.activePage] = page;
          return { ...state, pages };
        }

        case "highlight": {
          const pages = state.pages.map((p, pi) =>
            pi === state.activePage
              ? {
                  ...p,
                  columns: p.columns.map((c) => ({
                    ...c,
                    items: c.items.map((it) =>
                      it.kind === "note_card" && it.uid === e.target_board_id
                        ? { ...it, data: { ...it.data, highlights: [...it.data.highlights, { snippet: e.snippet, color: e.color ?? "#ef4444" }] } }
                        : it,
                    ),
                  })),
                }
              : p,
          );
          return { ...state, pages };
        }

        case "ask":
          return {
            ...state,
            activeAsk: { step_id: e.step_id, question: e.question, mode: e.mode, options: e.options },
            narration: [...state.narration, { kind: "action", text: `❓ ${e.question}` }],
          };

        case "response_complete":
          return { ...state, status: "done", activeAsk: null };

        case "error":
          return { ...state, status: "error", error: e.message, narration: [...state.narration, { kind: "error", text: e.message }] };

        default:
          return state;
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Excalidraw scene helpers                                            */
/* ------------------------------------------------------------------ */

/** Column titles + hand-drawn decorations as Excalidraw scene elements. */
function buildSceneElements(pages: BoardPage[], pageIndex: number, pageOffsets: Map<string, { x: number; y: number }>) {
  const page = pages[pageIndex];
  if (!page) return [];
  const off = pageOffsets.get(page.id) ?? { x: 0, y: pageIndex * 2000 };
  const elements: any[] = [];

  page.columns.forEach((col, ci) => {
    const x = off.x + col.x;
    const y = off.y;
    const titleW = Math.min(COL_W, col.title.length * 15 + 24);
    // marker highlight bar (below the text in z-order)
    elements.push({
      type: "rectangle",
      id: `colhl-${page.id}-${ci}`,
      x: x - 4,
      y: y + 16,
      width: titleW,
      height: 14,
      strokeColor: "transparent",
      backgroundColor: "#fde68a",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 2,
      opacity: 55,
      angle: 0,
      seed: ci * 104729 + 7,
      version: 1,
      versionNonce: 2,
      isDeleted: false,
      boundElements: null,
      updated: 1,
      link: null,
      locked: false,
      groupIds: [],
      frameId: null,
      roundness: null,
    });
    // column title — full text-element schema
    elements.push({
      type: "text",
      id: `coltitle-${page.id}-${ci}`,
      x,
      y,
      width: titleW,
      height: 35,
      text: col.title,
      fontSize: 28,
      fontFamily: 1, // hand-drawn (Excalifont/Virgil)
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      originalText: col.title,
      autoResize: true,
      lineHeight: 1.25,
      angle: 0,
      strokeColor: EXCAL_PURPLE,
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      seed: ci * 7919 + 11,
      version: 1,
      versionNonce: 1,
      isDeleted: false,
      boundElements: null,
      updated: 1,
      link: null,
      locked: false,
      groupIds: [],
      frameId: null,
      roundness: null,
    });
  });
  return elements;
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

interface Viewport {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export function WhiteboardPage({
  onBack,
  initialLecture,
}: {
  onBack: () => void;
  initialLecture?: { title: string; outline?: string };
}) {
  const [state, dispatch] = useReducer(reducer, null, emptyState);
  const [viewport, setViewport] = useState<Viewport>({ scrollX: 0, scrollY: 0, zoom: 0.7 });
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [topic, setTopic] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const [answer, setAnswer] = useState("");
  const narrationEndRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const page = state.pages[state.activePage];

  /* ---- layout: stack cards per measured height ---- */
  const layout = useMemo(() => {
    // recompute stacking from measured card heights (fallback: estimate)
    const nextY = [...(page?.nextY ?? [])];
    return nextY;
  }, [page]);

  /* ---- sync overlay positions from excalidraw appState ---- */
  const onExcalidrawChange = useCallback(
    (elements: readonly any[], appState: AppState) => {
      setViewport((prev) => {
        const z = appState.zoom?.value ?? 1;
        if (prev.scrollX === appState.scrollX && prev.scrollY === appState.scrollY && prev.zoom === z) return prev;
        return { scrollX: appState.scrollX, scrollY: appState.scrollY, zoom: z };
      });
    },
    [],
  );


  /* ---- zoom % control ---- */
  const setZoom = (z: number) => {
    api?.updateScene({ appState: { zoom: { value: z } } } as any);
  };

  /* ---- ws ---- */
  const start = async (title?: string, outline?: string) => {
    const lectureTitle = title ?? topic;
    if (!lectureTitle.trim()) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/api/v1/whiteboard/ws`);
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      try {
        dispatch({ type: "event", event: JSON.parse(ev.data) });
      } catch { /* ignore */ }
    };
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "start_session",
          lecture_title: lectureTitle,
          lecture_outline: outline,
          provider: "github-copilot",
          model: "gpt-4.1",
          thinking_level: "low",
        }),
      );
    };
  };

  // ⭐️ Auto-start when arriving from a course's Learn button — no manual input needed
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (initialLecture && !autoStartedRef.current) {
      autoStartedRef.current = true;
      start(initialLecture.title, initialLecture.outline);
    }
  }, [initialLecture]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendAnswer = (text: string) => {
    wsRef.current?.send(JSON.stringify({ type: "user_message", message: text }));
    dispatch({ type: "event", event: { type: "speak", step_id: -1, spoken_text: `🧑 You: ${text}` } });
    setAnswer("");
  };

  useEffect(() => {
    narrationEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.narration.length]);

  /* ---- scene→viewport conversion ---- */
  const toViewport = (sceneX: number, sceneY: number, vp: Viewport) => ({
    left: (sceneX + vp.scrollX) * vp.zoom,
    top: (sceneY + vp.scrollY) * vp.zoom,
  });

  return (
    <div className="flex h-screen flex-col overflow-hidden" style={{ background: BOARD_BG }}>
      <WobbleFilterDefs />

      {/* Toolbar — Hyperknow style */}
      <header className="relative z-20 flex items-center gap-2 px-4 py-2">
        <button
          onClick={onBack}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-900 text-white shadow-sm"
          aria-label="Back"
        >
          ✕
        </button>
        <div className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold shadow-sm ring-1 ring-neutral-200">
          {page && (page.columns.length > 0 || page.title !== "Lecture") ? page.title : (initialLecture?.title ?? "Lecture")}
        </div>

        <div className="mx-auto flex items-center gap-1">
          <div className="flex items-center gap-1 rounded-full bg-white px-2 py-1 shadow-sm ring-1 ring-neutral-200">
            <button onClick={() => setZoom(Math.max(0.2, viewport.zoom - 0.1))} className="px-2 text-lg leading-none text-neutral-600">−</button>
            <span className="w-12 text-center text-sm tabular-nums">{Math.round(viewport.zoom * 100)}%</span>
            <button onClick={() => setZoom(Math.min(3, viewport.zoom + 0.1))} className="px-2 text-lg leading-none text-neutral-600">+</button>
          </div>

          <div className="ml-2 flex items-center gap-1 rounded-full bg-white px-2 py-1 shadow-sm ring-1 ring-neutral-200">
            <button
              onClick={() => dispatch({ type: "gotoPage", index: Math.max(0, state.activePage - 1) })}
              disabled={state.activePage === 0}
              className="px-1.5 text-neutral-600 disabled:opacity-30"
            >
              ‹
            </button>
            <span className="text-sm tabular-nums text-neutral-600">
              {state.activePage + 1} / {state.pages.length}
            </span>
            <button
              onClick={() => dispatch({ type: "gotoPage", index: Math.min(state.pages.length - 1, state.activePage + 1) })}
              disabled={state.activePage >= state.pages.length - 1}
              className="px-1.5 text-neutral-600 disabled:opacity-30"
            >
              ›
            </button>
          </div>

          <div className="ml-2 flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm shadow-sm ring-1 ring-neutral-200">
            <span>🔊</span>
            <span className="text-neutral-700">Calm · 1×</span>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {state.status === "teaching" && <span className="animate-pulse text-xs font-medium text-blue-500">● teaching</span>}
          {state.status === "done" && <span className="text-xs font-medium text-emerald-500">✓ complete</span>}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Board */}
        <main className="relative min-w-0 flex-1">
          {/* start overlay */}
          {state.status === "idle" && (
            <div className="absolute inset-0 z-30 flex items-center justify-center" style={{ background: "rgba(252,252,252,.9)" }}>
              <div className="w-96 rounded-2xl border border-neutral-200 bg-white p-6 shadow-lg">
                <h2 className="mb-1 text-lg font-bold" style={{ fontFamily: FONT_STACK }}>Start a lecture</h2>
                <p className="mb-4 text-sm text-neutral-500">The teacher will sketch and narrate on this board.</p>
                <input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && start()}
                  placeholder="e.g. How WiFi Actually Works"
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm outline-none focus:border-neutral-500"
                />
                <button
                  onClick={start}
                  disabled={!topic.trim()}
                  className="mt-3 w-full rounded-lg bg-neutral-900 py-2.5 text-sm font-medium text-white disabled:opacity-40"
                >
                  Start teaching
                </button>
              </div>
            </div>
          )}

          {/* Excalidraw canvas (view mode) */}
          <div className="excalidraw-host absolute inset-0 overflow-hidden">
            <Excalidraw
              excalidrawAPI={setApi}
              viewModeEnabled
              gridModeEnabled
              theme="light"
              initialData={{
                appState: {
                  viewBackgroundColor: BOARD_BG,
                  gridSize: 24,
                  zoom: { value: 0.7 },
                },
              }}
              UIOptions={{ canvasActions: { disableAll: true } }}
              onChange={onExcalidrawChange}
            />
          </div>

          {/* DOM overlay — synced to Excalidraw viewport */}
          <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
            {page?.columns.map((col, ci) => (
              <div key={ci}>
                {/* column title — DOM overlay, scales with zoom like Excalidraw text */}
                {col.title && (
                  <div
                    className="absolute"
                    style={{
                      left: toViewport(col.x, 0, viewport).left,
                      top: toViewport(col.x, 0, viewport).top,
                      width: col.w ?? COL_W,
                      transform: `scale(${viewport.zoom})`,
                      transformOrigin: "top left",
                      fontFamily: FONT_STACK,
                    }}
                  >
                    <BoardTitle>{col.title}</BoardTitle>
                  </div>
                )}
                {col.items.map((item) => {
                  const vp = toViewport(item.sceneX, item.sceneY, viewport);
                  const key = item.uid;
                  return (
                    <div
                      key={String(key)}
                      ref={(el) => {
                        if (el) cardRefs.current.set(String(key), el);
                        else cardRefs.current.delete(String(key));
                      }}
                      className="overlay-handwriting absolute"
                      style={{
                        left: vp.left,
                        top: vp.top,
                        width: item.w,
                        transform: `scale(${viewport.zoom})`,
                        transformOrigin: "top left",
                      }}
                    >
                      {item.kind === "note_card" && (
                        <div className="pointer-events-auto">
                          <NoteCard card={item.data} animate />
                        </div>
                      )}
                      {item.kind === "mermaid_graph" && (
                        <div className="pointer-events-auto">
                          <MermaidCard source={item.source} />
                        </div>
                      )}
                      {item.kind === "board_image" && (
                        <div className="pointer-events-auto">
                          <ImageCard src={item.src} caption={item.caption} />
                        </div>
                      )}
                      {item.kind === "board_animation" && (
                        <div className="pointer-events-auto">
                          <AnimationCard html={item.html} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </main>

        {/* Conversation panel */}
        <aside className="flex w-[420px] shrink-0 flex-col border-l border-neutral-200 bg-white">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm font-semibold">Conversation</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4">
            {state.narration.map((n, i) => (
              <div key={i} className="mb-3">
                {n.kind === "speak" ? (
                  <p className="text-[15px] leading-relaxed text-neutral-800">{n.text}</p>
                ) : n.kind === "error" ? (
                  <p className="rounded-lg bg-red-50 p-2 text-sm text-red-600">{n.text}</p>
                ) : (
                  <p className="text-xs text-neutral-400">✏️ {n.text}</p>
                )}
              </div>
            ))}
            <div ref={narrationEndRef} />
          </div>

          {/* Ask input / chat */}
          <div className="border-t border-neutral-200 p-3">
            {state.activeAsk ? (
              state.activeAsk.mode === "choice" ? (
                <div className="mb-2 flex flex-wrap gap-2">
                  {state.activeAsk.options?.map((o) => (
                    <button
                      key={o}
                      onClick={() => sendAnswer(o)}
                      className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:border-neutral-500"
                    >
                      {o}
                    </button>
                  ))}
                </div>
              ) : null
            ) : null}
            <div className="flex items-center gap-2 rounded-full border border-neutral-300 px-3 py-2">
              <button className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-200 text-sm">+</button>
              <input
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && answer.trim() && sendAnswer(answer)}
                placeholder="Ask a question..."
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
              <button
                onClick={() => answer.trim() && sendAnswer(answer)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-900 text-white"
              >
                ↑
              </button>
            </div>
          </div>
        </aside>
      </div>

      {state.status === "error" && (
        <div className="border-t border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{state.error}</div>
      )}

      {/* styles */}
      <style>{`
        @font-face { font-family: "Virgil"; src: url("/fonts/Virgil.woff2") format("woff2"); font-display: swap; }
        @font-face { font-family: "Xiaolai"; src: url("/fonts/Xiaolai.woff2") format("woff2"); font-display: swap; }
        .board-card-in { animation: cardIn .5s cubic-bezier(.2,.9,.3,1.2) both; }
        .board-card-out { opacity: 0; transform: translateY(14px) rotate(-.5deg); }
        @keyframes cardIn { from { opacity: 0; transform: translateY(14px) rotate(-.5deg); } to { opacity: 1; transform: none; } }
        .board-skeleton { border-radius: 8px; background: linear-gradient(90deg,#eee 25%,#f5f5f5 50%,#eee 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite; }
        @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        .board-md p { margin: 6px 0; }
        .board-md table.board-table { border-collapse: collapse; margin: 8px 0; width: 100%; }
        .board-md table.board-table th, .board-md table.board-table td { border: 1.3px solid #525252; padding: 4px 10px; font-size: 0.9em; }
        .board-md table.board-table th { background: #f5f5f4; }
        /* hide excalidraw's own footer/toolbar in view mode */
        .excalidraw .layer-ui__wrapper__footer { display: none !important; }
        .excalidraw .layer-ui__wrapper__top-right { display: none !important; }
        .excalidraw .layer-ui__wrapper__canvas-actions { display: none !important; }
      `}</style>
    </div>
  );
}
