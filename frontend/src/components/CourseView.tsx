import { useState } from "react";
import type { CourseStructure, Unit } from "../lib/protocol";
import { Markdown } from "./Markdown";

/** Course learning view — unit sidebar + lecture content (Hyperknow course page style). */
export function CourseView({ course, courseId, onRestart, onOpenCourses }: { course: CourseStructure; courseId?: string | null; onRestart: () => void; onOpenCourses?: () => void }) {
  const [unitIdx, setUnitIdx] = useState(0);
  const [lectureIdx, setLectureIdx] = useState(0);
  const [lessonIdx, setLessonIdx] = useState(0);
  const [showPractice, setShowPractice] = useState(false);
  const [showAssessment, setShowAssessment] = useState(false);

  const unit = course.units[unitIdx];
  const lecture = unit?.lectures[lectureIdx];
  const lesson = lecture?.lessons[lessonIdx];

  const goto = (u: number, l: number, s: number) => {
    setUnitIdx(u);
    setLectureIdx(l);
    setLessonIdx(s);
    setShowPractice(false);
    setShowAssessment(false);
  };

  const allLessons = course.units.flatMap((u, ui) => u.lectures.flatMap((l, li) => l.lessons.map((_, si) => ({ ui, li, si }))));
  const flatIdx = allLessons.findIndex((x) => x.ui === unitIdx && x.li === lectureIdx && x.si === lessonIdx);
  const next = () => flatIdx >= 0 && flatIdx < allLessons.length - 1 && goto(allLessons[flatIdx + 1].ui, allLessons[flatIdx + 1].li, allLessons[flatIdx + 1].si);
  const prev = () => flatIdx > 0 && goto(allLessons[flatIdx - 1].ui, allLessons[flatIdx - 1].li, allLessons[flatIdx - 1].si);

  return (
    <div className="flex min-h-screen bg-neutral-50">
      {courseId && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2">
          <button
            onClick={() => courseId && onOpenCourses?.()}
            className="rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white shadow-lg transition hover:bg-neutral-700"
          >
            ✓ Course saved — open course page
          </button>
        </div>
      )}
      {/* Sidebar */}
      <aside className="sticky top-0 h-screen w-80 shrink-0 overflow-y-auto border-r border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 p-4">
          <button onClick={onRestart} className="mb-2 text-xs text-neutral-400 hover:text-neutral-600">
            ← New course
          </button>
          <h1 className="text-sm font-bold leading-snug">{course.title}</h1>
        </div>
        <nav className="p-2">
          {course.units.map((u, ui) => (
            <UnitNav
              key={ui}
              index={ui}
              unit={u}
              active={ui === unitIdx}
              activeLecture={lectureIdx}
              activeLesson={lessonIdx}
              onGoto={goto}
            />
          ))}
        </nav>
      </aside>

      {/* Content */}
      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-8 py-10">
          <div className="mb-1 text-xs font-medium uppercase tracking-wider text-neutral-400">
            Unit {unitIdx + 1} of {course.units.length}
          </div>
          <h1 className="text-2xl font-bold">{lecture?.title}</h1>
          <p className="mt-1 text-sm text-neutral-500">{lecture?.description}</p>

          {lesson && (
            <>
              <h2 className="mt-6 mb-3 border-l-4 border-neutral-900 pl-3 text-lg font-semibold">{lesson.title}</h2>
              <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
                <Markdown text={lesson.content} />
              </div>

              {/* Practice */}
              <div className="mt-4">
                <button
                  onClick={() => setShowPractice((v) => !v)}
                  className="text-sm font-medium text-blue-600 hover:text-blue-800"
                >
                  {showPractice ? "Hide" : "Practice"} ({lesson.practice.length} questions)
                </button>
                {showPractice && (
                  <div className="mt-3 space-y-3">
                    {lesson.practice.map((p, i) => (
                      <PracticeCard key={i} index={i} question={p.question} answer={p.answer} />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Nav */}
          <div className="mt-8 flex items-center justify-between border-t border-neutral-200 pt-4">
            <button onClick={prev} disabled={flatIdx <= 0} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm disabled:opacity-30">
              ← Previous
            </button>
            <button
              onClick={() => setShowAssessment((v) => !v)}
              className="rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium hover:bg-neutral-200"
            >
              Unit Assessment
            </button>
            <button
              onClick={next}
              disabled={flatIdx < 0 || flatIdx >= allLessons.length - 1}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-30"
            >
              Next →
            </button>
          </div>

          {/* Assessment */}
          {showAssessment && <Assessment unit={unit} unitIdx={unitIdx} />}
        </div>
      </main>
    </div>
  );
}

function UnitNav({
  index,
  unit,
  active,
  activeLecture,
  activeLesson,
  onGoto,
}: {
  index: number;
  unit: Unit;
  active: boolean;
  activeLecture: number;
  activeLesson: number;
  onGoto: (u: number, l: number, s: number) => void;
}) {
  const [open, setOpen] = useState(active);
  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2 rounded-lg p-2 text-left text-sm ${active ? "bg-neutral-100 font-medium" : "hover:bg-neutral-50"}`}
      >
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold ${
            active ? "bg-neutral-900 text-white" : "bg-neutral-200 text-neutral-600"
          }`}
        >
          {index + 1}
        </span>
        <span className="flex-1 leading-snug">{unit.title}</span>
        <span className="text-xs text-neutral-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="ml-8 mt-0.5 space-y-0.5">
          {unit.lectures.map((l, li) => (
            <div key={li}>
              <button
                onClick={() => onGoto(index, li, 0)}
                className={`block w-full rounded p-1.5 text-left text-xs ${
                  active && li === activeLecture ? "font-medium text-neutral-900" : "text-neutral-500 hover:text-neutral-800"
                }`}
              >
                {l.title}
              </button>
              {active && li === activeLecture && (
                <div className="ml-3 space-y-0.5 border-l border-neutral-200 pl-2">
                  {l.lessons.map((s, si) => (
                    <button
                      key={si}
                      onClick={() => onGoto(index, li, si)}
                      className={`block w-full rounded p-1 text-left text-xs ${
                        si === activeLesson ? "font-medium text-neutral-900" : "text-neutral-400 hover:text-neutral-700"
                      }`}
                    >
                      {s.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PracticeCard({ index, question, answer }: { index: number; question: string; answer: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="text-sm font-medium">
        {index + 1}. {question}
      </div>
      {revealed ? (
        <div className="mt-2 rounded bg-emerald-50 p-3 text-sm text-emerald-800">
          <Markdown text={answer} />
        </div>
      ) : (
        <button onClick={() => setRevealed(true)} className="mt-2 text-xs text-neutral-400 hover:text-neutral-600">
          Show answer
        </button>
      )}
    </div>
  );
}

function Assessment({ unit, unitIdx }: { unit: Unit; unitIdx: number }) {
  const [selected, setSelected] = useState<Record<number, number>>({});
  const score = unit.assessment.reduce((acc, q, i) => acc + (selected[i] === q.correct ? 1 : 0), 0);
  const answeredAll = Object.keys(selected).length === unit.assessment.length;

  return (
    <div className="mt-4 rounded-xl border border-neutral-300 bg-white p-6 shadow-sm">
      <h3 className="mb-1 font-bold">Unit {unitIdx + 1} Assessment</h3>
      <p className="mb-4 text-xs text-neutral-500">Answer all {unit.assessment.length} questions to check your mastery.</p>
      <div className="space-y-4">
        {unit.assessment.map((q, qi) => (
          <div key={qi}>
            <div className="mb-2 text-sm font-medium">
              {qi + 1}. {q.question}
            </div>
            <div className="space-y-1.5">
              {q.options.map((opt, oi) => {
                const isPicked = selected[qi] === oi;
                const isCorrect = answeredAll && oi === q.correct;
                const isWrongPick = answeredAll && isPicked && oi !== q.correct;
                return (
                  <button
                    key={oi}
                    onClick={() => !answeredAll && setSelected((p) => ({ ...p, [qi]: oi }))}
                    className={`block w-full rounded-lg border p-2.5 text-left text-sm transition ${
                      isCorrect
                        ? "border-emerald-400 bg-emerald-50"
                        : isWrongPick
                          ? "border-red-300 bg-red-50"
                          : isPicked
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
      </div>
      {answeredAll && (
        <div className="mt-4 rounded-lg bg-neutral-900 p-4 text-center text-white">
          <span className="text-2xl font-bold">
            {score}/{unit.assessment.length}
          </span>
          <span className="ml-2 text-sm text-neutral-300">
            {score === unit.assessment.length ? "Mastered! 🎉" : score / unit.assessment.length >= 0.7 ? "Proficient" : "Review the lectures and retry"}
          </span>
        </div>
      )}
    </div>
  );
}
