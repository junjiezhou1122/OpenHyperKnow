import { useEffect, useRef, useState } from "react";
import { useCourseGenSocket } from "../hooks/useCourseGenSocket";
import { PHASES, PHASE_TITLES, type ProfileQuestion } from "../lib/protocol";
import { CourseView } from "../components/CourseView";
import { Markdown } from "../components/Markdown";

const PROVIDERS = [
  { id: "github-copilot", label: "GitHub Copilot", models: ["gpt-4.1", "gpt-4.1-mini", "claude-haiku-4.5"] },
  { id: "minimax-cn", label: "MiniMax", models: ["MiniMax-M2.7", "MiniMax-M2.7-highspeed"] },
  { id: "openai-codex", label: "Codex", models: ["gpt-5.4", "gpt-5.4-mini"] },
];

export function HomePage() {
  const { gen, conn, startGeneration, submitAnswers, stop } = useCourseGenSocket();
  const [topic, setTopic] = useState("");
  const [provider, setProvider] = useState(PROVIDERS[0].id);
  const [model, setModel] = useState(PROVIDERS[0].models[0]);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const textEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    textEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [gen.text, gen.phase, gen.units.size]);

  const start = () => {
    if (!topic.trim() || conn === "connecting") return;
    startGeneration(topic, { provider, model, thinking_level: "medium" });
  };

  const answerQuestion = (q: ProfileQuestion, label: string) => {
    setAnswers((prev) => {
      if (q.type === "multiple") {
        const cur = prev[q.id] ?? [];
        return { ...prev, [q.id]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label] };
      }
      return { ...prev, [q.id]: [label] };
    });
  };

  const allAnswered =
    gen.questions?.every((q) => (answers[q.id]?.length ?? 0) > 0 && (q.type === "multiple" || answers[q.id]?.length === 1)) ?? false;

  const submitTheAnswers = () => {
    if (!gen.questions) return;
    submitAnswers({
      prior_knowledge: answers[gen.questions[0].id] ?? [],
      lens: answers[gen.questions[1].id]?.[0] ?? "",
      mastery: answers[gen.questions[2].id]?.[0] ?? "",
      scale: answers[gen.questions[3].id]?.[0] ?? "",
    });
    setAnswers({});
  };

  if (gen.course) {
    return <CourseView course={gen.course} onRestart={() => location.reload()} />;
  }

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      {/* Header */}
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-900 text-sm font-bold text-white">OK</div>
            <span className="text-lg font-semibold tracking-tight">OpenHyperKnow</span>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                const p = PROVIDERS.find((x) => x.id === e.target.value);
                if (p) setModel(p.models[0]);
              }}
              disabled={gen.done === false && !!gen.phase}
              className="rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-xs"
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={gen.done === false && !!gen.phase}
              className="rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-xs"
            >
              {PROVIDERS.find((p) => p.id === provider)?.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        {/* Topic input */}
        <div className="mb-8 text-center">
          <h1 className="mb-2 text-3xl font-bold tracking-tight">Turn any learning goal into a 1:1 AI course</h1>
          <p className="text-neutral-500">From instant assist to course crafting, learn anything from scratch.</p>
        </div>

        {!gen.phase && gen.units.size === 0 && !gen.error && (
          <div className="mx-auto flex max-w-xl gap-2">
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && start()}
              placeholder="I wanna learn..."
              className="flex-1 rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-neutral-500"
            />
            <button
              onClick={start}
              disabled={!topic.trim() || conn === "connecting"}
              className="rounded-xl bg-neutral-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-40"
            >
              Generate
            </button>
          </div>
        )}

        {/* Phase progress (Hyperknow-style) */}
        {gen.phase && (
          <div className="mb-6 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-neutral-400">Generating course</span>
              <button onClick={stop} className="text-xs text-neutral-400 hover:text-neutral-600">
                Stop
              </button>
            </div>
            <div className="space-y-2">
              {PHASES.filter((p) => p !== "documents").map((p) => {
                const done = gen.phasesDone.has(p);
                const active = gen.phase === p;
                if (!done && !active) return null;
                return (
                  <div key={p} className="flex items-center gap-3 text-sm">
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                        done ? "bg-emerald-500 text-white" : "animate-pulse bg-blue-500 text-white"
                      }`}
                    >
                      {done ? "✓" : "…"}
                    </span>
                    <span className={done ? "text-neutral-400" : "font-medium text-neutral-800"}>{PHASE_TITLES[p]}</span>
                    {gen.activeTool && active && <span className="text-xs text-neutral-400">· {gen.activeTool}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Profile questions */}
        {gen.questions && (
          <div className="mb-6 space-y-4 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
            {gen.questions.map((q, qi) => (
              <div key={q.id}>
                <div className="mb-2 flex items-baseline gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded bg-neutral-900 text-[10px] font-bold text-white">
                    {qi + 1}
                  </span>
                  <h3 className="font-medium">{q.question}</h3>
                  <span className="ml-auto rounded bg-neutral-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400">
                    {q.type === "multiple" ? "Multiple Choice" : "Single Choice"}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {q.options.map((o) => {
                    const selected = answers[q.id]?.includes(o.label);
                    return (
                      <button
                        key={o.label}
                        onClick={() => answerQuestion(q, o.label)}
                        className={`rounded-lg border p-3 text-left transition ${
                          selected
                            ? "border-neutral-900 bg-neutral-900/[0.03] ring-1 ring-neutral-900"
                            : "border-neutral-200 hover:border-neutral-400"
                        }`}
                      >
                        <div className="text-sm font-medium">{o.label}</div>
                        <div className="mt-0.5 text-xs text-neutral-500">{o.description}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <button
              onClick={submitTheAnswers}
              disabled={!allAnswered}
              className="w-full rounded-lg bg-neutral-900 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-40"
            >
              Submit Answers
            </button>
          </div>
        )}

        {/* Outline preview */}
        {gen.outline && (
          <div className="mb-6 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold">{gen.outline.title}</h2>
            <p className="mt-1 text-sm text-neutral-600">{gen.outline.description}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {gen.outline.tags.map((t) => (
                <span key={t} className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs text-neutral-600">
                  #{t}
                </span>
              ))}
            </div>
            <div className="mt-4 space-y-2">
              {gen.outline.unitTitles.map((u, i) => {
                const arrived = gen.units.has(i);
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-3 rounded-lg border p-3 text-sm transition ${
                      arrived ? "border-emerald-200 bg-emerald-50/50" : "border-dashed border-neutral-200 text-neutral-400"
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold ${
                        arrived ? "bg-emerald-500 text-white" : "bg-neutral-100 text-neutral-400"
                      }`}
                    >
                      {arrived ? "✓" : i + 1}
                    </span>
                    <div>
                      <div className={arrived ? "font-medium text-neutral-900" : ""}>{u.title}</div>
                      <div className="text-xs text-neutral-500">{u.description}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Streaming assistant text */}
        {gen.text && !gen.done && (
          <div className="mb-6 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <Markdown text={gen.text} />
            <div ref={textEndRef} />
          </div>
        )}

        {gen.error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {gen.error}
            <button onClick={() => location.reload()} className="ml-3 underline">
              Start over
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
