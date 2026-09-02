/**
 * OpenHyperKnow — Whiteboard agent.
 *
 * Reproduces Hyperknow's interactive teaching session:
 * the agent narrates (TTS text) while placing note cards, images,
 * mermaid graphs, HTML animations and highlights on a multi-page canvas.
 * Every element carries a step_id; the client acks via action_step_complete.
 */
import { Type } from "typebox";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  type ToolDefinition,
  type AgentToolResult,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import type { WebSocket } from "@fastify/websocket";

export type { AgentSessionEvent };

export type ClientEvent =
  | { type: "session_ready"; session_id: string }
  | { type: "speak"; step_id: number; spoken_text: string }
  | { type: "tts_segment"; step_id: number; audio_url?: string; skipped?: boolean; speed?: number }
  | { type: "new_page"; step_id: number; page_id: string; title: string }
  | { type: "new_column"; step_id: number }
  | { type: "board"; step_id: number; board_uid?: number; board_content: string; title?: string; page_id: string; reveal_gate?: boolean }
  | { type: "graph"; step_id: number; mermaid: string; page_id: string }
  | { type: "image_gen_pending"; step_id: number; prompt_preview: string; caption?: string }
  | { type: "generated_image"; step_id: number; image_url: string; width?: number; height?: number; caption?: string }
  | { type: "animation_pending"; step_id: number; task_preview: string }
  | { type: "generated_animation"; step_id: number; html: string; task: string }
  | { type: "highlight"; step_id: number; target_board_id?: number; snippet?: string; color?: string }
  | { type: "ask"; step_id: number; question: string; options?: string[]; mode: "choice" | "open" }
  | { type: "done"; step_id: number }
  | { type: "response_complete" }
  | { type: "error"; message: string }
  | { type: "pong"; ts: number };

const toolResult = (output: string): AgentToolResult<unknown> => ({
  content: [{ type: "text", text: output }],
  details: null,
});

export const WHITEBOARD_SYSTEM_PROMPT = `You are a teacher on an infinite whiteboard. You teach one lecture through sequential "steps" streamed to the student's board.

Available step tools (use them ONE AT A TIME, in teaching order; each returns after the student's board rendered the element):

- speak: narrate one paragraph (1-3 sentences of spoken text).
- new_page: switch to a fresh page with a title (use 3-6 pages per lecture).
- board: place a handwritten note card with KEY CONTENT (a definition, formula, table, key insight — markdown, 30-120 words). Cards are the visual anchors of the lesson.
- graph: place a mermaid diagram (flowchart / sequence / class). Use for relationships, flows, taxonomies.
- highlight: visually emphasize a previous board card by its board_uid, quoting the snippet.
- ask: pause and ask the student a question (choice mode with 2-4 options, or open). Use once mid-lecture to re-engage.
- done: finish the lecture.

Teaching flow per page: speak → board (1-2 cards) → speak → maybe graph/image → speak...
Start by introducing the topic (speak), then place the first card.
Images/animations are NOT available in this environment — never promise visuals you cannot produce.

Rules:
- Never batch more than one tool call per message.
- Narration must be conversational, like a professor talking while sketching.
- Place 3-6 board cards total across the lecture.
- End with a speak that summarizes, then done.`;

/** Registry so the WS handler can resolve pending asks per connection. */
const pendingAsks = new WeakMap<WebSocket, (answer: string) => void>();

export function registerAskResolver(ws: WebSocket, resolve: (answer: string) => void) {
  pendingAsks.set(ws, resolve);
}

export function resolveAsk(ws: WebSocket, answer: string) {
  const fn = pendingAsks.get(ws);
  if (fn) {
    pendingAsks.delete(ws);
    fn(answer);
  }
}

export interface WhiteboardRunOptions {
  lectureTitle: string;
  lectureOutline?: string;
  provider?: string;
  model?: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high";
  ws: WebSocket;
}

export async function runWhiteboardSession(opts: WhiteboardRunOptions): Promise<void> {
  const { lectureTitle, lectureOutline, provider, model, thinkingLevel = "medium", ws } = opts;
  const sessionId = crypto.randomUUID();

  const emit = (e: ClientEvent) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(e));
  };

  emit({ type: "session_ready", session_id: sessionId });

  let stepCounter = 1;
  let uidCounter = 1;
  const nextStep = () => stepCounter++;

  const emitStep = (e: Omit<ClientEvent, "step_id"> & { type: string }) => {
    emit(e as ClientEvent);
  };

  /* ------------------------- tools ------------------------- */

  const speak: ToolDefinition = {
    name: "speak",
    label: "Speak",
    description: "Narrate a paragraph out loud (1-3 conversational sentences).",
    parameters: Type.Object({ spoken_text: Type.String({ description: "The paragraph to speak" }) }),
    execute: async (_id, raw) => {
      const p = raw as { spoken_text: string };
      const step = nextStep();
      emit({ type: "speak", step_id: step, spoken_text: p.spoken_text });
      emit({ type: "tts_segment", step_id: step, skipped: true, speed: 1 });
      return toolResult("spoken");
    },
  };

  const newPage: ToolDefinition = {
    name: "new_page",
    label: "New Page",
    description: "Start a new whiteboard page with a title.",
    parameters: Type.Object({ title: Type.String() }),
    execute: async (_id, raw) => {
      const p = raw as { title: string };
      const step = nextStep();
      const pageId = `page-${stepCounter}`;
      emit({ type: "new_page", step_id: step, page_id: pageId, title: p.title });
      return toolResult(`page ${pageId} "${p.title}" ready`);
    },
  };

  const board: ToolDefinition = {
    name: "board",
    label: "Board Card",
    description: "Place a handwritten note card on the current page (key definition / formula / insight in markdown).",
    parameters: Type.Object({
      title: Type.String({ description: "Card title" }),
      board_content: Type.String({ description: "Card body in markdown (30-120 words)" }),
      keypoint: Type.Boolean({ description: "true if this is a core takeaway" }),
    }),
    execute: async (_id, raw) => {
      const p = raw as { title: string; board_content: string; keypoint?: boolean };
      const step = nextStep();
      const uid = uidCounter++;
      emitStep({
        type: "board",
        step_id: step,
        board_uid: uid,
        board_content: p.keypoint ? `**${p.title}**\n\n${p.board_content}` : p.board_content,
        title: p.title,
        page_id: "current",
      } as any);
      return toolResult(`card placed with board_uid=${uid}. Reference it in highlight by this number.`);
    },
  };

  const graph: ToolDefinition = {
    name: "graph",
    label: "Diagram",
    description: "Place a mermaid diagram on the current page.",
    parameters: Type.Object({
      mermaid: Type.String({ description: "Mermaid diagram source, e.g. graph TD; A-->B" }),
      caption: Type.String({ description: "One-line explanation" }),
    }),
    execute: async (_id, raw) => {
      const p = raw as { mermaid: string; caption?: string };
      const step = nextStep();
      emit({ type: "graph", step_id: step, mermaid: p.mermaid, page_id: "current" });
      return toolResult("diagram placed");
    },
  };

  const highlight: ToolDefinition = {
    name: "highlight",
    label: "Highlight",
    description: "Emphasize a previously placed card by board_uid.",
    parameters: Type.Object({
      target_board_id: Type.Number(),
      snippet: Type.String({ description: "The key phrase to circle" }),
    }),
    execute: async (_id, raw) => {
      const p = raw as { target_board_id: number; snippet: string };
      const step = nextStep();
      emit({ type: "highlight", step_id: step, target_board_id: p.target_board_id, snippet: p.snippet, color: "#ef4444" });
      return toolResult("highlighted");
    },
  };

  const ask: ToolDefinition = {
    name: "ask",
    label: "Ask Student",
    description: "Ask the student a question to re-engage. choice mode shows 2-4 options; open mode expects free text.",
    parameters: Type.Object({
      question: Type.String(),
      mode: Type.Union([Type.Literal("choice"), Type.Literal("open")]),
      options: Type.Optional(Type.Array(Type.String(), { description: "2-4 options when mode=choice" })),
    }),
    execute: async (_id, raw) => {
      const p = raw as { question: string; mode: "choice" | "open"; options?: string[] };
      const step = nextStep();
      emit({
        type: "ask",
        step_id: step,
        question: p.question,
        mode: p.mode,
        options: p.mode === "choice" ? (p.options ?? []).slice(0, 4) : undefined,
      });
      // ⭐️ interrupt: wait for the student's answer over WS
      const answer = await new Promise<string>((resolve) => {
        registerAskResolver(ws, resolve);
      });
      return toolResult(`student answered: "${answer}". Acknowledge briefly in your next speak, then continue.`);
    },
  };

  const done: ToolDefinition = {
    name: "done",
    label: "Finish",
    description: "Finish the lecture.",
    parameters: Type.Object({}),
    execute: async () => {
      emit({ type: "response_complete" });
      return toolResult("lecture finished");
    },
  };

  /* ------------------------- session ------------------------- */

  const modelRuntime = await ModelRuntime.create();
  let resolvedModel;
  if (provider && model) {
    resolvedModel = modelRuntime.getModel(provider, model);
    if (!resolvedModel) throw new Error(`Model ${provider}/${model} not available`);
  } else {
    const available = await modelRuntime.getAvailable(provider);
    resolvedModel = available[0];
    if (!resolvedModel) throw new Error("No authenticated LLM provider found");
  }

  const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: join(homedir(), ".pi", "agent"),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: WHITEBOARD_SYSTEM_PROMPT,
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    modelRuntime,
    model: resolvedModel,
    thinkingLevel,
    resourceLoader,
    noTools: "builtin",
    customTools: [speak, newPage, board, graph, highlight, ask, done],
    sessionManager: SessionManager.inMemory(),
  });

  // stream thinking chunks as narration status (optional UI flavor)
  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (event.type === "auto_retry_start") {
      emit({ type: "error", message: event.errorMessage });
    }
  });

  try {
    const outline = lectureOutline ? `\n\nLecture outline for context:\n${lectureOutline}` : "";
    await session.prompt(`Teach the lecture "${lectureTitle}" on the whiteboard.${outline}`);
    emit({ type: "response_complete" });
  } catch (err) {
    emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
  } finally {
    unsubscribe();
    session.dispose();
  }
}

