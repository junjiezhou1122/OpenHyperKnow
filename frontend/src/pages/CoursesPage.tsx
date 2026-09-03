/** Courses list — grid of saved courses (Hyperknow Courses page). */
import { useEffect, useState } from "react";

interface CourseSummary {
  id: string;
  topic: string;
  title: string;
  description: string;
  unitCount: number;
  createdAt: number;
  progress: Record<string, string>;
}

export function CoursesPage({ onOpen, onBack }: { onOpen: (id: string) => void; onBack: () => void }) {
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/courses")
      .then((r) => r.json())
      .then((data) => setCourses(data))
      .finally(() => setLoading(false));
  }, []);

  const del = async (id: string) => {
    await fetch(`/api/courses/${id}`, { method: "DELETE" });
    setCourses((cs) => cs.filter((c) => c.id !== id));
  };

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-4">
          <button onClick={onBack} className="text-sm text-neutral-500 hover:text-neutral-800">
            ← Home
          </button>
          <span className="text-lg font-semibold">Courses</span>
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">{courses.length}</span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {loading ? (
          <div className="text-sm text-neutral-400">Loading…</div>
        ) : courses.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-300 p-16 text-center">
            <p className="text-neutral-500">No courses yet. Generate one from the home page!</p>
            <button onClick={onBack} className="mt-3 rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white">
              Generate a course
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((c) => {
              const lessons = Object.values(c.progress ?? {});
              const doneCount = lessons.filter((s) => s === "mastered").length;
              return (
                <div
                  key={c.id}
                  className="group cursor-pointer rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  onClick={() => onOpen(c.id)}
                >
                  <div className="mb-3 flex items-start justify-between">
                    <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-600">
                      {c.unitCount} units
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        del(c.id);
                      }}
                      className="text-xs text-neutral-300 opacity-0 transition group-hover:opacity-100 hover:text-red-500"
                    >
                      delete
                    </button>
                  </div>
                  <h3 className="mb-1 font-semibold leading-snug">{c.title}</h3>
                  <p className="mb-4 line-clamp-2 text-sm text-neutral-500">{c.description}</p>
                  <div className="flex items-center justify-between text-xs text-neutral-400">
                    <span>{new Date(c.createdAt).toLocaleDateString()}</span>
                    {doneCount > 0 && <span className="text-emerald-500">✓ {doneCount} mastered</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
