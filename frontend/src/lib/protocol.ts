/**
 * Shared protocol types — mirrors backend/src/agents/teacher.ts ClientEvent
 * and Hyperknow's WS message protocol.
 */

/* ---------------- Course generation (server → client) ---------------- */

export interface ProfileQuestionOption {
  label: string;
  description: string;
}

export interface ProfileQuestion {
  id: string;
  question: string;
  type: "multiple" | "single";
  options: ProfileQuestionOption[];
}

export interface Lesson {
  title: string;
  content: string;
  practice: { question: string; answer: string }[];
}

export interface Lecture {
  title: string;
  description: string;
  lessons: Lesson[];
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

export type Phase = "documents" | "research" | "initial" | "crafting" | "refining";

export interface CourseBlueprint {
  title: string;
  description: string;
  tags: string[];
  sessions: number;
  unitTitles: { title: string; description: string }[];
}

export type ServerEvent =
  | { type: "agent_step"; step: string; status: "loading" | "completed"; title?: string }
  | { type: "content_chunk"; delta: string }
  | { type: "thinking_chunk"; delta: string }
  | { type: "tool_execution"; tool_name: string; tool_status: "in_progress" | "completed"; data?: unknown }
  | { type: "questions_step"; questions: ProfileQuestion[] }
  | { type: "course_structure_ready"; structure: Pick<CourseStructure, "title" | "description" | "tags"> & { units: { title: string; description: string }[] } }
  | { type: "blueprint_ready"; blueprint: CourseBlueprint }
  | { type: "course_generation_complete"; course: CourseStructure; courseId?: string }
  | { type: "unit_ready"; unit_index: number; unit: Unit }
  | { type: "course_generation_error"; message: string }
  | { type: "complete" }
  | { type: "pong"; ts: number };

/* ---------------- Client → server ---------------- */

export type ClientCommand =
  | { type: "ping" }
  | {
      type: "start_course_generation";
      query: string;
      provider?: string;
      model?: string;
      thinking_level?: string;
    }
  | {
      type: "course_generation_answers";
      answers: { prior_knowledge: string[]; lens: string; mastery: string; scale: string };
    }
  | { type: "stop_course_generation" };

/* ---------------- App state ---------------- */

export interface CourseGenState {
  /** 5-phase progress (Hyperknow style) */
  phase: Phase | null;
  phasesDone: Set<Phase>;
  /** Streaming assistant text */
  text: string;
  /** Current tool indicator */
  activeTool: string | null;
  /** Profile questions waiting for answers */
  questions: ProfileQuestion[] | null;
  /** Blueprint awaiting confirmation (Hyperknow checkpoint 3) */
  blueprint: CourseBlueprint | null;
  /** Outline once confirmed */
  outline: CourseGenStateOutline | null;
  /** Units received so far, keyed by index */
  units: Map<number, Unit>;
  /** Final assembled course */
  course: CourseStructure | null;
  /** Saved course id */
  courseId: string | null;
  /** Error */
  error: string | null;
  /** Generation finished */
  done: boolean;
}

export interface CourseGenStateOutline {
  title: string;
  description: string;
  tags: string[];
  unitTitles: { title: string; description: string }[];
}

export const PHASES: Phase[] = ["documents", "research", "initial", "crafting", "refining"];

export const PHASE_TITLES: Record<Phase, string> = {
  documents: "Looking through your documents",
  research: "Researching the web",
  initial: "Sketching Initial Thoughts",
  crafting: "Crafting Course",
  refining: "Refining Course",
};

export const emptyCourseGenState = (): CourseGenState => ({
  phase: null,
  phasesDone: new Set(),
  text: "",
  activeTool: null,
  questions: null,
  blueprint: null,
  outline: null,
  units: new Map(),
  course: null,
  courseId: null,
  error: null,
  done: false,
});

/** The streaming reducer — Hyperknow's sn/on/an handlers as a pure function. */
export function courseGenReducer(state: CourseGenState, msg: ServerEvent): CourseGenState {
  switch (msg.type) {
    case "agent_step":
      return state;

    case "content_chunk":
      return { ...state, text: state.text + msg.delta };

    case "thinking_chunk":
      return state; // could render thinking separately

    case "tool_execution":
      return {
        ...state,
        activeTool: msg.tool_status === "in_progress" ? msg.tool_name : null,
        // first research tool call marks the research phase
        phase: msg.tool_name === "search_web" && msg.tool_status === "in_progress" && !state.phasesDone.has("research") ? "research" : state.phase,
      };

    case "questions_step":
      return {
        ...state,
        questions: msg.questions,
        phase: "initial",
        phasesDone: new Set([...state.phasesDone, "research"]),
      };

    case "blueprint_ready":
      return {
        ...state,
        blueprint: {
          title: msg.blueprint.title,
          description: msg.blueprint.description,
          tags: msg.blueprint.tags,
          sessions: msg.blueprint.sessions,
          unitTitles: msg.blueprint.units,
        },
        questions: null,
        phase: "crafting",
        phasesDone: new Set([...state.phasesDone, "initial"]),
      };

    case "course_structure_ready":
      return {
        ...state,
        outline: {
          title: msg.structure.title,
          description: msg.structure.description,
          tags: msg.structure.tags,
          unitTitles: msg.structure.units,
        },
        blueprint: null,
        phase: "crafting",
        phasesDone: new Set([...state.phasesDone, "initial"]),
      };

    case "unit_ready": {
      const units = new Map(state.units);
      units.set(msg.unit_index, msg.unit);
      const allArrived = state.outline ? units.size >= state.outline.unitTitles.length : false;
      if (allArrived) {
        return { ...state, units, phase: "refining", phasesDone: new Set([...state.phasesDone, "crafting"]) };
      }
      return { ...state, units };
    }

    case "course_generation_complete":
      return {
        ...state,
        course: msg.course,
        courseId: msg.courseId ?? null,
        phase: null,
        phasesDone: new Set(PHASES),
        done: true,
      };

    case "course_generation_error":
      return { ...state, error: msg.message, done: true };

    case "complete":
      return { ...state, done: true };

    default:
      return state;
  }
}
