import { useState } from "react";
import { HomePage } from "./pages/HomePage";
import { CoursesPage } from "./pages/CoursesPage";
import { CoursePage } from "./pages/CoursePage";
import { WhiteboardPage } from "./pages/WhiteboardPage";

type Route =
  | { name: "home" }
  | { name: "courses" }
  | { name: "course"; id: string }
  | { name: "whiteboard" };

export default function App() {
  const [route, setRoute] = useState<Route>({ name: "home" });

  if (route.name === "whiteboard") {
    return <WhiteboardPage onBack={() => setRoute({ name: "home" })} />;
  }
  if (route.name === "courses") {
    return <CoursesPage onOpen={(id) => setRoute({ name: "course", id })} onBack={() => setRoute({ name: "home" })} />;
  }
  if (route.name === "course") {
    return (
      <CoursePage
        courseId={route.id}
        onBack={() => setRoute({ name: "courses" })}
        onLearn={(lectureTitle, outline) => setRoute({ name: "whiteboard" })}
      />
    );
  }

  // Home + floating nav
  return (
    <>
      <nav className="fixed bottom-5 right-5 z-50 flex gap-2">
        <button
          onClick={() => setRoute({ name: "courses" })}
          className="rounded-full bg-white px-4 py-2.5 text-sm font-medium text-neutral-800 shadow-lg ring-1 ring-neutral-200 transition hover:bg-neutral-50"
        >
          📚 My Courses
        </button>
        <button
          onClick={() => setRoute({ name: "whiteboard" })}
          className="rounded-full bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg transition hover:bg-neutral-700"
        >
          🖊️ Whiteboard
        </button>
      </nav>
      <HomePage onNavigateCourses={() => setRoute({ name: "courses" })} />
    </>
  );
}
