import { useState } from "react";
import { HomePage } from "./pages/HomePage";
import { WhiteboardPage } from "./pages/WhiteboardPage";

type Route = "home" | "whiteboard";

export default function App() {
  const [route, setRoute] = useState<Route>("home");

  if (route === "whiteboard") {
    return <WhiteboardPage onBack={() => setRoute("home")} />;
  }
  return (
    <>
      <nav className="fixed bottom-5 right-5 z-50 flex gap-2">
        <button
          onClick={() => setRoute("whiteboard")}
          className="rounded-full bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg transition hover:bg-neutral-700"
        >
          🖊️ Whiteboard
        </button>
      </nav>
      <HomePage />
    </>
  );
}
