/**
 * OpenHyperKnow — Course generation agent built on pi's AgentSession SDK.
 *
 * Replaces what Hyperknow does with LangGraph: a stateful multi-step
 * course-generation flow with human-in-the-loop (the 4-question profile),
 * web research, and streaming output.
 */
import { Type, type Static } from "typebox";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  type AgentSession,
  type ToolDefinition,
  type AgentToolResult,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import type { WebSocket } from "@fastify/websocket";

export type { AgentSessionEvent };

/** Event we stream to the browser over WS. Modeled after Hyperknow's protocol. */
export type ClientEvent =
  | { type: "agent_step"; step: string; status: "loading" | "completed"; title?: string }
  | { type: "content_chunk"; delta: string }
  | { type: "thinking_chunk"; delta: string }
  | { type: "tool_execution"; tool_name: string; tool_status: "in_progress" | "completed"; data?: unknown }
  | { type: "questions_step"; questions: ProfileQuestion[] }
  | { type: "course_structure_ready"; structure: CourseStructure }
  | { type: "unit_ready"; unit_index: number; unit: Unit }
  | { type: "course_generation_complete"; course: CourseStructure }
  | { type: "course_generation_error"; message: string }
  | { type: "complete" };

export interface ProfileQuestion {
  id: string;
  question: string;
  type: "multiple" | "single";
  options: { label: string; description: string }[];
}

export interface Lecture {
  title: string;
  description: string;
  lessons: { title: string; content: string; practice: { question: string; answer: string }[] }[];
}

export interface Unit {
  title: string;
  description: string;
  lectures: Lecture[];
  assessment: { question: string; options: string[]; correct: number }[];
}

export interface CourseStructure {
  title: string;
  description: string;
  tags: string[];
  units: Unit[];
}

/* ------------------------------------------------------------------ */
/* Tool definitions (TypeBox schemas)                                  */
/* ------------------------------------------------------------------ */

const SearchWebParams = Type.Object({
  queries: Type.Array(Type.String(), { description: "3-5 parallel search queries targeting university syllabi, open courseware, and textbook chapter listings" }),
});
type SearchWebParams = Static<typeof SearchWebParams>;

/** Resolve a user's profile answers. This unblocks the interrupted flow. */
const SubmitProfileParams = Type.Object({
  prior_knowledge: Type.Array(Type.String(), { description: "Concepts the user already knows" }),
  lens: Type.String({ description: "Chosen learning lens, e.g. 'Computational and Algorithmic'" }),
  mastery: Type.String({ description: "Target mastery level" }),
  scale: Type.String({ description: "Course scale: Essential / Practitioner / Deep Dive" }),
});
type SubmitProfileParams = Static<typeof SubmitProfileParams>;

/**
 * Pending profile resolution. When the agent calls ask_user_questions we
 * park the resolver here; the browser answers come back over WS and we
 * resolve the tool call — exactly Hyperknow's interrupt pattern.
 */
let pendingProfile: {
  questions: ProfileQuestion[];
  resolve: (answers: SubmitProfileParams) => void;
} | null = null;

export function resolvePendingProfile(answers: SubmitProfileParams) {
  pendingProfile?.resolve(answers);
  pendingProfile = null;
}

const AskUserParams = Type.Object({
  questions: Type.Array(
    Type.Object({
      id: Type.String(),
      question: Type.String(),
      type: Type.Union([Type.Literal("multiple"), Type.Literal("single")]),
      options: Type.Array(Type.Object({ label: Type.String(), description: Type.String() })),
    }),
    { description: "Exactly 4 questions: prior knowledge (multiple), lens, mastery, scale (single)" },
  ),
});
type AskUserParams = Static<typeof AskUserParams>;

const toolResult = (output: string): AgentToolResult<unknown> => ({
  content: [{ type: "text", text: output }],
  details: null,
});

function makeTools(ws: WebSocket | null, emit: (e: ClientEvent) => void): ToolDefinition[] {
  const searchWeb: ToolDefinition = {
    name: "search_web",
    label: "Search Web",
    description: "Run parallel web searches for university syllabi / curricula on the topic. Returns titles + URLs + excerpts.",
    parameters: SearchWebParams,
    execute: async (_id, rawParams) => {
      const params = rawParams as SearchWebParams;
      emit({ type: "tool_execution", tool_name: "search_web", tool_status: "in_progress", data: { queries: params.queries } });
      // DuckDuckGo HTML lite search — no API key needed. Swap for Tavily/Exa with a key.
      const results: { query: string; results: { title: string; url: string; snippet: string }[] }[] = [];
      for (const q of params.queries.slice(0, 5)) {
        try {
          const res = await fetch(
            `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
            { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" } },
          );
          const html = await res.text();
          const items: { title: string; url: string; snippet: string }[] = [];
          const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
          let m: RegExpExecArray | null;
          while ((m = re.exec(html)) && items.length < 5) {
            const url = m[1].startsWith("http") ? m[1] : `https://duckduckgo.com${m[1]}`;
            const title = m[2].replace(/<[^>]+>/g, "").trim();
            if (title) items.push({ title, url, snippet: "" });
          }
          results.push({ query: q, results: items });
        } catch {
          results.push({ query: q, results: [] });
        }
      }
      emit({ type: "tool_execution", tool_name: "search_web", tool_status: "completed", data: { count: results.length } });
      return toolResult(JSON.stringify(results, null, 2));
    },
  };

  const askUser: ToolDefinition = {
    name: "ask_user_questions",
    label: "Ask User",
    description: "Ask the user the 4 profile questions and wait for answers. Use exactly once, after initial research.",
    parameters: AskUserParams,
    execute: async (_id, rawParams) => {
      const params = rawParams as AskUserParams;
      emit({ type: "questions_step", questions: params.questions });
      const answers = await new Promise<SubmitProfileParams>((resolve) => {
        pendingProfile = { questions: params.questions, resolve };
      });
      return toolResult(JSON.stringify(answers));
    },
  };

  const emitOutline: ToolDefinition = {
    name: "emit_course_outline",
    label: "Emit Course Outline",
    description: "Emit the course outline (title, description, tags, and the list of unit titles with one-line descriptions). Call this once before generating unit content.",
    parameters: Type.Object({
      title: Type.String(),
      description: Type.String(),
      tags: Type.Array(Type.String()),
      units: Type.Array(Type.Object({ title: Type.String(), description: Type.String() })),
    }),
    execute: async (_id, rawParams) => {
      const params = rawParams as { title: string; description: string; tags: string[]; units: { title: string; description: string }[] };
      emit({ type: "course_structure_ready", structure: { ...params, units: [] } });
      return toolResult("Outline emitted. Now generate content for EACH unit, one emit_unit call per unit, in order.");
    },
  };

  const emitUnit: ToolDefinition = {
    name: "emit_unit",
    label: "Emit Unit",
    description: "Emit one complete unit of the course (its full lectures, lessons and assessment). Call once per unit, in order.",
    parameters: Type.Object({
      unit_index: Type.Number({ description: "0-based index of this unit in the outline" }),
      unit: Type.Object({
        title: Type.String(),
        description: Type.String(),
        lectures: Type.Array(
          Type.Object({
            title: Type.String(),
            description: Type.String(),
            lessons: Type.Array(
              Type.Object({
                title: Type.String(),
                content: Type.String({ description: "Full markdown lesson content, 300-800 words" }),
                practice: Type.Array(Type.Object({ question: Type.String(), answer: Type.String() })),
              }),
            ),
          }),
        ),
        assessment: Type.Array(
          Type.Object({ question: Type.String(), options: Type.Array(Type.String()), correct: Type.Number() }),
          { description: "3-5 multiple choice questions" },
        ),
      }),
    }),
    execute: async (_id, rawParams) => {
      const params = rawParams as { unit_index: number; unit: Unit };
      emit({ type: "unit_ready", unit_index: params.unit_index, unit: params.unit });
      return toolResult(`Unit ${params.unit_index} emitted. Continue with the next unit, or finish if this was the last one.`);
    },
  };

  return [searchWeb, askUser, emitOutline, emitUnit];
}

/* ------------------------------------------------------------------ */
/* System prompt                                                       */
/* ------------------------------------------------------------------ */

export const TEACHER_SYSTEM_PROMPT = `You are HyperKnow's course architect. Given a learning goal, you produce a complete course.

Workflow (follow strictly, in order):
1. Call search_web with 3-5 parallel queries targeting university syllabi, open courseware and standard textbooks for the topic.
2. Call ask_user_questions with exactly 4 questions:
   - Q1 (multiple): "Which of these concepts are you already familiar with?" — 4-5 options derived from the research, from basic to advanced.
   - Q2 (single): "Which primary lens would you like to use to explore this topic?" — 3-4 discipline-specific options.
   - Q3 (single): "What is your target mastery level?" — e.g. Conceptual Fluency / Applied Proficiency / Academic Rigor.
   - Q4 (single): "Which course scale fits your schedule?" — Essential Overview (3-4 units, 6-8h) / Comprehensive Practitioner (5-7 units, 12-15h) / Deep Dive Specialization (8-10 units, 20h+).
3. Call emit_course_outline once with the course blueprint: title, description, tags, and unit titles with one-line descriptions. Match the lens, mastery and scale from the answers; skip content the user already knows.
4. For EACH unit in order, call emit_unit with the full unit content (lectures, lessons with 300-800 word markdown content, practice Q/A per lesson, 3-5 MCQ assessment per unit).
5. After the last unit, give a 1-paragraph summary of the course design decisions.

Each lecture should have 2-3 lessons unless the scale is small. Quality bar for lesson content: concrete examples, common mistakes, key points. Practice: 2-3 Q/A per lesson.`;

/* ------------------------------------------------------------------ */
/* Session runner                                                      */
/* ------------------------------------------------------------------ */

export interface StartCourseGenOptions {
  topic: string;
  provider?: string;   // user-specifiable, not fixed
  model?: string;      // user-specifiable, not fixed
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high";
  ws: WebSocket;
}

/** Map pi events to Hyperknow-style WS events. */
function mapEvent(event: AgentSessionEvent, emit: (e: ClientEvent) => void) {
  switch (event.type) {
    case "message_update": {
      const e = event.assistantMessageEvent;
      if (e.type === "text_delta") emit({ type: "content_chunk", delta: e.delta });
      else if (e.type === "thinking_delta") emit({ type: "thinking_chunk", delta: e.delta });
      break;
    }
    case "tool_execution_start":
      emit({ type: "tool_execution", tool_name: event.toolName, tool_status: "in_progress" });
      break;
    case "tool_execution_end":
      emit({ type: "tool_execution", tool_name: event.toolName, tool_status: "completed" });
      break;
    default:
      break;
  }
}

export async function runCourseGeneration(opts: StartCourseGenOptions): Promise<void> {
  const { topic, provider, model, thinkingLevel = "medium", ws } = opts;
  const emit = (e: ClientEvent) => {
    if (ws.readyState === 1 /* OPEN */) ws.send(JSON.stringify(e));
  };

  emit({ type: "agent_step", step: "research", status: "loading", title: "Researching the web" });

  const modelRuntime = await ModelRuntime.create();
  const tools = makeTools(ws, emit);

  // ⭐️ System prompt goes through the resource loader, not createAgentSession
  const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: join(homedir(), ".pi", "agent"),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: TEACHER_SYSTEM_PROMPT,
  });
  // ⭐️ Required: when passing our own loader, we must reload it ourselves
  // (sdk.js only auto-reloads internally-created loaders)
  await resourceLoader.reload();

  // Resolve user-specified model (falls back to provider default)
  let resolvedModel;
  if (provider && model) {
    resolvedModel = modelRuntime.getModel(provider, model);
    if (!resolvedModel) throw new Error(`Model ${provider}/${model} not available. Run \`pi auth\` or check the model id.`);
  } else {
    const available = await modelRuntime.getAvailable(provider);
    resolvedModel = available[0];
    if (!resolvedModel) throw new Error("No authenticated LLM provider found. Configure one via `pi auth`.");
  }

  const { session } = await createAgentSession({
    modelRuntime,
    model: resolvedModel,
    thinkingLevel,
    resourceLoader,
    // disable default file tools but keep our custom tools enabled
    noTools: "builtin",
    customTools: tools,
    sessionManager: SessionManager.inMemory(),
  });

  const unsubscribe = session.subscribe((event) => mapEvent(event, emit));

  try {
    await session.prompt(`I wanna learn: ${topic}`);
    emit({ type: "complete" });
  } catch (err) {
    emit({ type: "course_generation_error", message: err instanceof Error ? err.message : String(err) });
  } finally {
    unsubscribe();
    session.dispose();
  }
}
