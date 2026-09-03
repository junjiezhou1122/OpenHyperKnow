/**
 * Course page — Hyperknow's 3-column layout:
 *   app nav | course panel (cover, tags, unit list) | content (unit → lectures →
 *   Learn/Practice buttons per session, progress legend + dots)
 */
import { useEffect, useState } from "react";
import type { CourseStructure } from "../lib/protocol";
import { Markdown } from "../components/Markdown";

type LessonStatus = "mastered" | "proficient" | "familiar" | "attempted" | "notStarted";

const STATUS_META: Record<LessonStatus, { label: string; color: string; icon: string }> = {
  mastered: { label: "Mastered", color: "#10b981", icon: "✓" },
  proficient: { label: "Proficient", color: "#3b82f6", icon: "◐" },
  familiar: { label: "Familiar", color: "#8b5cf6", icon: "◔" },
  attempted: { label: "Attempted", color: "#f59e0b", icon: "○" },
  notStarted: { label: "Not started", color: "#e5e5e5", icon: "" },
};

interface Props {
  courseId: string;
  onBack: () => void;
  onLearn: (lectureTitle: string, outline: string) => void;
}

export function CoursePage({ courseId, onBack, onLearn }: Props) {
  const [data, setData] = useState<{ course: CourseStructure; progress: Record<string, string> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/courses/${courseId}`)
      .then((r) => r.json())
      .then((d) => setData({ course: d.course, progress: d.progress ?? {} }))
      .catch(() => setError("Failed to load course"));
  }, [courseId]);

  if (error) return <div className="p-10 text-center text-red-500">{error}</div>;
  if (!data) return <div className="p-10 text-center text-neutral-400">Loading course…</div>;

  const { course, progress } = data;
  const allLessons = course.units.flatMap((u, ui) =>
    u.lectures.flatMap((l, li) => l.lessons.map((_, si) => `${ui}:${li}:${si}`)),
  );
  const doneCount = allLessons.filter((k) => progress[k] === "mastered").length;
  const pct = allLessons.length ? Math.round((doneCount / allLessons.length) * 100) : 0;

  const saveProgress = (key: string, status: LessonStatus) => {
    fetch(`/api/courses/${courseId}/progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, status }),
    });
    setData((d) => (d ? { ...d, progress: { ...d.progress, [key]: status } } : d));
  };

  return (
    <div className="flex min-h-screen bg-neutral-50">
      {/* Course panel (2nd column) */}
      <aside className="sticky top-0 h-screen w-80 shrink-0 overflow-y-auto border-r border-neutral-200 bg-white">
        <div className="p-4">
          <button onClick={onBack} className="mb-3 text-sm text-neutral-500 hover:text-neutral-800">
            ← All courses
          </button>
          <div className="mb-4 flex h-36 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-100 via-purple-50 to-amber-50 text-4xl">
            📚
          </div>
          <h1 className="text-base font-bold leading-snug">{course.title}</h1>
          <p className="mt-2 text-xs leading-relaxed text-neutral-500">{course.description}</p>
          <div className="mt-3 flex flex-wrap gap-1">
            {course.tags.map((t) => (
              <span key={t} className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-600">
                #{t}
              </span>
            ))}
          </div>

          {/* Progress ring */}
          <div className="mt-4 rounded-xl bg-neutral-50 p-3">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-neutral-500">Progress</span>
              <span className="font-semibold">{pct}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>

          {/* Unit list */}
          <nav className="mt-4 space-y-1">
            {course.units.map((u, ui) => (
              <a
                key={ui}
                href={`#unit-${ui}`}
                className="flex items-center gap-2 rounded-lg p-2 text-sm hover:bg-neutral-50"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded bg-neutral-200 text-[10px] font-bold text-neutral-600">
                  {ui + 1}
                </span>
                <span className="truncate text-neutral-700">{u.title}</span>
              </a>
            ))}
          </nav>
        </div>
      </aside>

      {/* Content (3rd column) */}
      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-3xl px-8 py-10">
          {/* Progress legend — Hyperknow style */}
          <div className="mb-8 flex flex-wrap items-center gap-4">
            {Object.entries(STATUS_META).map(([k, m]) => (
              <span key={k} className="flex items-center gap-1.5 text-xs text-neutral-500">
                <span
                  className="flex h-4 w-4 items-center justify-center rounded-full border-2 text-[9px] text-white"
                  style={{ borderColor: m.color, background: k === "mastered" ? m.color : "transparent", color: k === "mastered" ? "#fff" : m.color }}
                >
                  {m.icon}
                </span>
                {m.label}
              </span>
            ))}
          </div>

          {course.units.map((unit, ui) => (
            <section key={ui} id={`unit-${ui}`} className="mb-12">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-indigo-500">
                Unit {ui + 1}
              </div>
              <h2 className="mb-1 text-2xl font-bold">{unit.title}</h2>
              <p className="mb-6 text-sm text-neutral-500">{unit.description}</p>

              {unit.lectures.map((lecture, li) => {
                const key = `${ui}:${li}`;
                const isDone = lecture.lessons.every((_, si) => progress[`${ui}:${li}:${si}`] === "mastered");
                return (
                  <div key={li} className="mb-4 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-xs font-semibold text-neutral-400">Lecture {li + 1}</span>
                      {isDone && <span className="text-xs text-emerald-500">✓</span>}
                    </div>
                    <h3 className="mb-1 text-lg font-semibold">{lecture.title}</h3>
                    <p className="mb-4 text-sm text-neutral-500">{lecture.description}</p>

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() =>
                          onLearn(
                            lecture.title,
                            unit.lectures.map((l) => l.title).join("\n"),
                          )
                        }
                        className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
                      >
                        ▶ Learn
                      </button>
                      <a
                        href={`#practice-${ui}-${li}`}
                        className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-600 transition hover:bg-indigo-100"
                      >
                        ✎ Practice
                      </a>
                    </div>

                    {/* Lessons with status */}
                    <div className="mt-4 space-y-2 border-t border-neutral-100 pt-4">
                      {lecture.lessons.map((lesson, si) => {
                        const lkey = `${ui}:${li}:${si}`;
                        const st = (progress[lkey] ?? "notStarted") as LessonStatus;
                        return (
                          <div key={si} className="flex items-center gap-3 text-sm">
                            <button
                              onClick={() => saveProgress(lkey, st === "mastered" ? "notStarted" : "mastered")}
                              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 text-[9px] text-white"
                              style={{
                                borderColor: STATUS_META[st].color,
                                background: st === "mastered" ? STATUS_META[st].color : "transparent",
                              }}
                              title="Toggle mastered"
                            >
                              {st === "mastered" ? "✓" : ""}
                            </button>
                            <span className={st === "mastered" ? "text-neutral-400 line-through" : "text-neutral-700"}>
                              {lesson.title}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Practice content (inline expandable) */}
                    <details id={`practice-${ui}-${li}`} className="mt-3">
                      <summary className="cursor-pointer text-sm text-indigo-600">Practice questions</summary>
                      <div className="mt-3 space-y-3">
                        {lecture.lessons.flatMap((l, x) =>
                          l.practice.map((p, pi) => (
                            <PracticeItem key={`${x}-${pi}`} n={pi + 1} q={p.question} a={p.answer} />
                          )),
                        )}
                      </div>
                      {/* Assessment */}
                      <div className="mt-4 rounded-xl border border-neutral-300 p-4">
                        <div className="mb-2 text-sm font-bold">Unit {ui + 1} Assessment</div>
                        <Assessment
                          questions={unit.assessment}
                          onDone={(score, total) => {
                            if (score / total >= 0.7) {
                              lecture.lessons.forEach((_, si) => saveProgress(`${ui}:${li}:${si}`, "mastered"));
                            }
                          }}
                        />
                      </div>
                    </details>
                  </div>
                );
              })}
            </section>
          ))}

          <div className="pb-20" />
          <div className="prose prose-sm hidden">
            <Markdown text="" />
          </div>
        </div>
      </main>
    </div>
  );
}

function PracticeItem({ n, q, a }: { n: number; q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-neutral-200 p-3">
      <div className="text-sm font-medium">
        {n}. {q}
      </div>
      {open ? (
        <div className="mt-2 rounded bg-emerald-50 p-2 text-sm text-emerald-800">{a}</div>
      ) : (
        <button onClick={() => setOpen(true)} className="mt-1 text-xs text-neutral-400 hover:text-neutral-600">
          Show answer
        </button>
      )}
    </div>
  );
}

function Assessment({
  questions,
  onDone,
}: {
  questions: { question: string; options: string[]; correct: number }[];
  onDone: (score: number, total: number) => void;
}) {
  const [picked, setPicked] = useState<Record<number, number>>({});
  const answered = Object.keys(picked).length === questions.length && questions.length > 0;
  const score = questions.reduce((acc, q, i) => acc + (picked[i] === q.correct ? 1 : 0), 0);
  useEffect(() => {
    if (answered) onDone(score, questions.length);
  }, [answered]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3">
      {questions.map((q, qi) => (
        <div key={qi}>
          <div className="mb-1.5 text-sm font-medium">
            {qi + 1}. {q.question}
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            {q.options.map((opt, oi) => {
              const correct = answered && oi === q.correct;
              const wrong = answered && picked[qi] === oi && oi !== q.correct;
              return (
                <button
                  key={oi}
                  onClick={() => !answered && setPicked((p) => ({ ...p, [qi]: oi }))}
                  className={`rounded-lg border p-2 text-left text-sm transition ${
                    correct
                      ? "border-emerald-400 bg-emerald-50"
                      : wrong
                        ? "border-red-300 bg-red-50"
                        : picked[qi] === oi
                          ? "border-neutral-900 ring-1 ring-neutral-900"
                          : "border-neutral-200 hover:border-neutral-400"
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {answered && (
        <div className="rounded-lg bg-neutral-900 p-3 text-center text-white">
          <span className="text-xl font-bold">
            {score}/{questions.length}
          </span>
          <span className="ml-2 text-sm text-neutral-300">
            {score === questions.length ? "Mastered! 🎉" : score / questions.length >= 0.7 ? "Proficient" : "Keep practicing"}
          </span>
        </div>
      )}
    </div>
  );
}
