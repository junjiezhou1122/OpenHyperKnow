# OpenHyperKnow - Implementation Plan

## 🎯 Goal
Perfect clone of Hyperknow (https://hyperknow.io) using **pi (TypeScript)** instead of LangChain.

## 📋 Tech Stack
- **Backend**: Node.js + Fastify + pi AgentSession SDK (RPC mode)
- **Frontend**: React 19 + Vite + TypeScript + Tailwind v4
- **Database**: Supabase (Postgres + Auth + Storage)
- **Whiteboard**: rough.js + Mermaid + iframe srcDoc
- **TTS**: Browser native Web Speech API
- **LLM**: Multi-provider via pi (anthropic/openai/google/local)

## 🗂 Project Structure
```
OpenHyperKnow/
├── backend/
│   ├── src/
│   │   ├── server.ts              # Fastify HTTP + WebSocket
│   │   ├── agents/
│   │   │   ├── teacher.ts         # ⭐️ pi session wrapper
│   │   │   ├── tools/
│   │   │   │   ├── search.ts      # Tavily/Exa
│   │   │   │   ├── save-course.ts # DB persistence
│   │   │   │   ├── ask-user.ts    # ⭐️ Interrupt pattern
│   │   │   │   └── tts.ts         # TTS generation
│   │   │   ├── system-prompts/
│   │   │   │   ├── teacher.md     # Course gen system prompt
│   │   │   │   └── tutor.md       # Whiteboard system prompt
│   │   │   └── types.ts
│   │   ├── ws/
│   │   │   ├── course-gen.ts      # Course gen WS handler
│   │   │   └── whiteboard.ts      # Whiteboard WS handler
│   │   ├── db/
│   │   │   ├── supabase.ts         # DB client
│   │   │   └── schema.sql
│   │   └── config.ts
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Home.tsx
│   │   │   ├── Chat.tsx               # ⭐️ Course generation flow
│   │   │   ├── Course.tsx             # Reading + Practice
│   │   │   ├── Whiteboard.tsx         # ⭐️ Main whiteboard
│   │   │   └── Marketplace.tsx
│   │   ├── components/
│   │   │   ├── Chat/
│   │   │   │   ├── MessageStream.tsx
│   │   │   │   ├── BlockRenderer.tsx  # ⭐️ Type dispatch
│   │   │   │   ├── blocks/
│   │   │   │   │   ├── TextBlock.tsx
│   │   │   │   │   ├── PlanBlock.tsx
│   │   │   │   │   ├── CodeBlock.tsx
│   │   │   │   │   ├── QuizBlock.tsx
│   │   │   │   │   ├── FlashcardBlock.tsx
│   │   │   │   │   ├── CheatsheetBlock.tsx
│   │   │   │   │   ├── VideoBlock.tsx
│   │   │   │   │   ├── HTMLAnimation.tsx # ⭐️ iframe srcDoc
│   │   │   │   │   └── InlineDiagram.tsx
│   │   │   │   ├── CourseProgress.tsx  # ⭐️ 5-phase progress
│   │   │   │   └── QuestionPrompt.tsx  # 4-question form
│   │   │   ├── Whiteboard/
│   │   │   │   ├── Page.tsx
│   │   │   │   ├── NoteCard.tsx        # ⭐️ rough.js + reveal
│   │   │   │   ├── BoardImage.tsx
│   │   │   │   ├── BoardAnimation.tsx # ⭐️ iframe sandbox
│   │   │   │   ├── MermaidGraph.tsx
│   │   │   │   ├── Highlight.tsx
│   │   │   │   └── Circle.tsx
│   │   │   ├── Learning/
│   │   │   │   ├── UnitSidebar.tsx
│   │   │   │   ├── LectureView.tsx
│   │   │   │   └── ProgressPath.tsx
│   │   │   └── Common/
│   │   │       ├── Sidebar.tsx
│   │   │       ├── Header.tsx
│   │   │       └── VoiceControls.tsx
│   │   ├── hooks/
│   │   │   ├── useWebSocket.ts         # Heartbeat + reconnect
│   │   │   ├── useChatStream.ts        # Course gen reducer
│   │   │   ├── useWhiteboardStream.ts  # Whiteboard reducer
│   │   │   ├── useTTS.ts               # Speech synthesis
│   │   │   └── useInterject.ts         # ⭐️ Mic + interrupt
│   │   ├── lib/
│   │   │   ├── api.ts
│   │   │   └── types.ts                # All message types
│   │   └── index.css
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
├── docker-compose.yml
├── .env.example
└── README.md
```

## 🛠 Implementation Phases

### Phase 1: Project skeleton + Backend Foundation (Day 1)
- Backend: Fastify + WebSocket + pi SDK
- Basic WS protocol (ping/pong, init)
- Health check endpoint

### Phase 2: Course Generation Backend (Day 2-3)
- pi AgentSession wrapper with system prompt
- 4 tools: search_web, save_unit, ask_user, generate_assessment
- Course generation WS handler with streaming
- Course schema validation

### Phase 3: Frontend Chat + Course Gen UI (Day 4-5)
- React + Vite setup
- WebSocket hook with reconnect
- MessageStream component
- BlockRenderer with type dispatch
- 4-question form for profile collection
- 5-phase progress bar

### Phase 4: Course Learning View (Day 6)
- Course reading page
- Practice mode
- Progress tracking
- Unit/lecture navigation

### Phase 5: Whiteboard Backend (Day 7-8)
- Whiteboard WS handler
- Scene planning with pi
- TTS generation per scene
- Element streaming (note_card, image, animation, mermaid)

### Phase 6: Whiteboard Frontend (Day 9-10)
- Page navigation
- NoteCard with rough.js + reveal animation
- BoardAnimation with iframe srcDoc
- Mermaid integration
- Image with skeleton + caption

### Phase 7: Interject + Canvas Sync (Day 11)
- Mic recording with MediaRecorder
- Interject message protocol
- sync_whiteboard_state sync

### Phase 8: Marketplace + Polish (Day 12)
- Marketplace list view
- Course preview
- Auth (Supabase)
- i18n

## ✅ Success Criteria
- [ ] Course generation: "I wanna learn X" → 4 questions → 5-unit course
- [ ] Whiteboard: AI narrates + draws, user can interrupt
- [ ] All Hyperknow features functional (even if simplified)
- [ ] Pi replaces LangChain completely
- [ ] Multi-provider LLM support
- [ ] Public GitHub repo at github.com/junjiezhou1122/OpenHyperKnow
