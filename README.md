# OpenHyperKnow

Open-source AI learning platform — a faithful clone of [Hyperknow](https://hyperknow.io) built on **[pi](https://github.com/badlogic/pi-mono)**'s AgentSession SDK instead of LangChain.

Turn any learning goal into a 1:1 AI course: web research → profile questions → adaptive course → lessons → practice → assessments.

## Features

- 🎯 **Course Generation** — enter a topic, the agent researches university syllabi, asks 4 profile questions (prior knowledge / lens / mastery / scale), then streams a full course unit-by-unit
- 📚 **Adaptive titles** — course title/description adapt to your profile answers
- 📖 **Course reader** — unit → lecture → lesson navigation, markdown + KaTeX rendering
- ✍️ **Practice** — Q/A reveal cards per lesson
- 🏆 **Assessments** — MCQ per unit with instant scoring (Mastered / Proficient / Review)
- 🔌 **Multi-provider LLM** — pick any provider/model pi supports (GitHub Copilot, MiniMax, Codex, Anthropic, OpenAI, Ollama, ...) — nothing is hardcoded

## Architecture

```
OpenHyperKnow/
├── backend/        Node.js + Fastify + WebSocket + pi AgentSession SDK
│   └── src/agents/teacher.ts   ← replaces LangGraph: tools + interrupt + streaming
└── frontend/       React 19 + Vite + Tailwind v4
    └── src/hooks/useCourseGenSocket.ts  ← Hyperknow-style WS protocol + reducer
```

The agent workflow is **not** a framework graph — it's a pi `AgentSession` with 4 custom tools:

| Tool | Purpose |
|------|---------|
| `search_web` | parallel DuckDuckGo research (swap for Tavily/Exa) |
| `ask_user_questions` | **interrupt**: parks a promise; the browser answers over WS and resolves it |
| `emit_course_outline` | streams the blueprint to the UI |
| `emit_unit` | streams one unit at a time (progressive rendering) |

## Run

```bash
# backend
cd backend && npm install && npm run dev   # :3001

# frontend
cd frontend && npm install && npm run dev  # :5173 (proxies /api → :3001)
```

Authenticate any provider once via `pi auth` or by exporting an API key (e.g. `GITHUB_COPILOT_TOKEN`).

## E2E test

```bash
cd backend
node test/e2e-course-gen.mjs github-copilot gpt-4.1 "control theory"
```

## License

MIT
