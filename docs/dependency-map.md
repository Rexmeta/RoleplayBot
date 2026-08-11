# Domain Dependency Map

> **Document purpose:** Architecture-audit input for future Platformization, Actor abstraction, Interaction/Trace, and AI Agent Evaluation work. No source files are modified by producing this document.
>
> **Audit date:** 2026-08-11 (initial) · **Updated:** 2026-08-11 (added missing voice, simulation, scenario, persona, avatar, auth, and cross-cutting service modules; documented undocumented route files; added §5.3 Cross-Cutting Supporting Services)
> **Test baseline:** 74 test files passed (75 total; 1 heap-OOM worker crash on `useRealtimeVoiceVadSensitivity.test.ts` — pre-existing environment issue), 1778 tests passed, 15 skipped. Type-check (`npx tsc --noEmit`) reports pre-existing errors across `server/routes/analytics.ts`, `server/routes/conversations.ts`, `server/routes/routerHelpers.ts`, `server/services/aiUsageTracker.ts`, `server/routes/systemAdmin.ts`, `client/src/components/admin/ScenarioManager.tsx`, `client/src/components/report/SimulationReplayPanel.tsx`, `client/src/hooks/chat/useChatSession.ts`, `client/src/pages/home.tsx`, `client/src/pages/system-admin.tsx`, and `server/routes.ts`. All failures are pre-existing; this task made no source-code changes.

---

## Table of Contents

1. [Purpose & Scope](#1-purpose--scope)
2. [Architecture Legend](#2-architecture-legend)
3. [System Context](#3-system-context)
4. [Domain Map](#4-domain-map)
5. [Supporting / Cross-Cutting Systems](#5-supporting--cross-cutting-systems) (5.1 Storage, 5.2 AI/Model Providers, 5.3 Cross-Cutting Supporting Services, 5.4 Media)
6. [Actor Abstraction Candidates](#6-actor-abstraction-candidates)
7. [Runtime Data Flows](#7-runtime-data-flows)
8. [Cross-Domain Dependency Matrix](#8-cross-domain-dependency-matrix)
9. [Dependency Direction & Contract Boundaries](#9-dependency-direction--contract-boundaries)
10. [Snapshot Boundaries](#10-snapshot-boundaries)
11. [Coupling Hotspots](#11-coupling-hotspots)
12. [External Agent Boundary](#12-external-agent-boundary)
13. [Future Platformization Map](#13-future-platformization-map)
14. [Test Coverage Map](#14-test-coverage-map)
15. [Open Architectural Questions](#15-open-architectural-questions)

---

## 1. Purpose & Scope

### Why this document exists

The platform currently supports Human-only roleplay (a human learner practicing against an AI-driven NPC persona). The roadmap extends this toward Human → AI Agent → Robot / Simulator interactions — a significantly wider Actor space. Before those transitions begin, a clear picture of current domain boundaries, data flows, coupling hotspots, and hardcoded actor assumptions is required as input to Platformization planning.

### What this document covers

- The **nine core domains**: Persona, Scenario, Session, Evaluation, Emotion, Voice, Avatar, Auth, Simulation.
- The **API Boundary** — a cross-cutting layer, not a domain.
- Three **cross-cutting systems**: Storage, AI/Model Providers, Media.
- Actor abstraction candidates, runtime data flows, dependency direction, snapshot boundaries, coupling hotspots, the external agent boundary, future platformization targets, test coverage depth, and open architectural questions.

### What is explicitly out of scope

- Refactoring, extracting, or implementing any new abstraction.
- Implementing Actor, Interaction, Trace, Simulation extraction, provider changes, versioning, or new schemas.
- Resolving the architectural questions enumerated in §15.
- Billing, store, HR analytics, and settings modules beyond brief references where they touch the target domains.

---

## 2. Architecture Legend

```
[Schema]      — shared/schema/* Drizzle table definition + Zod types
[Storage]     — server/storage/* domain storage mixin
[Service]     — server/services/* domain service / provider adapter
[Route]       — server/routes/* Express router
[Client]      — client/src/** React page / hook / library
[Provider]    — server/services/providers/* provider adapter (expected SDK boundary)
[SDK]         — external library used by a provider adapter (expected boundary)
[WS]          — WebSocket connection (realtime path)
[SSE]         — Server-Sent Events (streaming path)

─── →         — compile-time import / dependency
→→→           — runtime call / data flow
≈≈≈           — WebSocket frame
~~~           — SSE chunk
[T] transient — lives in process memory only; not persisted
[P] persisted — written to a database table
[SOT]         — source of truth for this field at this layer
```

---

## 3. System Context

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Browser Client (React/Vite, TypeScript)                                        │
│  ┌──────────────┐  ┌────────────────┐  ┌─────────────────────────────────────┐ │
│  │  Pages       │  │  Hooks         │  │  Libraries                          │ │
│  │  home.tsx    │  │  useChatSession│  │  queryClient · mediaUrl             │ │
│  │  Conversation│  │  useRealtimeVo.│  │  avatar/* · scenario-system         │ │
│  │  FeedbackView│  │  useSimulation │  │                                     │ │
│  │  Analytics   │  │  useAuth       │  │                                     │ │
│  └──────┬───────┘  └───────┬────────┘  └──────────────────┬──────────────────┘ │
│         │                  │                               │                    │
└─────────┼──────────────────┼───────────────────────────────┼────────────────────┘
          │ HTTPS REST        │ WebSocket /api/realtime-voice │ HTTPS REST
          ▼                  ▼                               ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Express Server (Node.js)                                                       │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │  API Boundary (cross-cutting)                                            │  │
│  │  Auth Middleware (JWT session) · Agent API Key Middleware (HMAC pepper)  │  │
│  │  server/routes.ts · server/routes/* · server/openapi/agentApi.ts        │  │
│  └──────────────────────────────┬───────────────────────────────────────────┘  │
│                                 │                                               │
│  ┌──────────┐  ┌─────────────┐  │  ┌──────────────┐  ┌──────────────────────┐ │
│  │ Session  │  │ Evaluation  │  │  │ Simulation   │  │ Realtime Voice       │ │
│  │ Storage  │  │ Engine      │  │  │ Engine       │  │ Service (WS bridge)  │ │
│  └────┬─────┘  └─────┬───────┘  │  └──────┬───────┘  └──────────┬───────────┘ │
│       │              │           │         │                      │             │
│  ┌────▼──────────────▼───────────▼─────────▼──────────────────────▼──────────┐ │
│  │  Storage composite (IStorage = PostgreSQLStorage | MemStorage)            │ │
│  │  server/storage/index.ts  ←  mixins per domain                            │ │
│  └──────────────────────────────┬────────────────────────────────────────────┘ │
│                                 │ Drizzle ORM                                   │
└─────────────────────────────────┼───────────────────────────────────────────────┘
                                  │
          ┌───────────────────────┼────────────────────────┐
          ▼                       ▼                        ▼
   PostgreSQL (Neon)       Replit Object Storage      Google Cloud Storage
   (NEON_DATABASE_URL)     (DEFAULT_OBJECT_STORAGE)   (GCS_BUCKET_NAME)

External dependencies:
  Google Gemini API  (@google/genai, gemini-2.5-flash, gemini-live-2.5-flash-preview)
  OpenAI API         (openai, gpt-4o, openai-realtime-preview)
  Custom LLM API     (OpenAI-compatible REST, configurable URL)
  Redis              (REDIS_URL, optional rate-limiting for Agent API)
  ElevenLabs TTS     (ELEVENLABS_API_KEY)
  Custom TTS         (CUSTOM_TTS_URL, CUSTOM_TTS_API_KEY)
```

---

## 4. Domain Map

> Each core domain section covers: responsibility, schema tables, storage module, service files, routes/endpoints, client entry points, inbound dependencies, outbound dependencies, extension risk, and future abstraction candidate.

---

### 4.1 Persona Domain

**Responsibility:** Represents the NPC character the human learner interacts with. Two subtypes exist in parallel: **MBTI personas** (system-managed, loaded from JSON files and mirrored in `mbti_personas`) and **user-created personas** (stored in `user_personas`). Persona also carries avatar media references (images and video clips) and voice configuration.

**Schema tables**

| Table | Key columns | Notes |
|---|---|---|
| `mbti_personas` | `id`, `mbti`, `gender`, `personalityTraits[]`, `communicationStyle`, `images` (JSONB), `videos` (JSONB w/ clips) | Source of truth for MBTI persona avatar media and video clip slots |
| `user_personas` | `id`, `creatorId`, `name`, `description`, `avatarUrl`, `expressions` (JSONB), `personality` (JSONB), `gender` | User-created personas; avatar URL is storage key, not signed URL |
| `user_persona_likes` | `userId`, `personaId` | Many-to-many likes |
| `persona_user_scenes` | `id`, `creatorId`, `title`, `setting`, `mood`, `openingLine` | User-created scene contexts |

**Storage module:** `server/storage/personas.ts` — `IPersonasStorage`, `PersonasMixin`, `MemPersonasStorage`

Key methods: `getUserPersonas`, `getUserPersona`, `createUserPersona`, `updateUserPersona`, `deleteUserPersona`, `getUserPersonasByCreator`, `likeUserPersona`, `incrementPersonaChatCount`, `getUserPersonaScenes`, `createUserPersonaScene`, `updateUserPersonaScene`.

**Service files**

- `server/utils/mbtiLoader.ts` — `loadMBTIPersona`, `enrichPersonaWithMBTI`, `transformImagePathsByGender`; reads `personas/<type>.json` from filesystem; validates allowed 16 MBTI types; blocks path traversal.
- `server/utils/globalMBTICache.ts` — `GlobalMBTICache` singleton; preloads all MBTI JSON files into process memory; used by `mbtiLoader` to avoid repeated disk reads.
- `server/storage/scenarios.ts` — `ScenariosMixin.getAllMbtiPersonas`, `getMbtiPersona`, `createMbtiPersona`, `updateMbtiPersona`, `deleteMbtiPersona`; MBTI persona CRUD lives in the Scenario storage mixin (historical coupling).
- `server/services/fileManager.ts` — `FileManagerService`; wraps scenario/persona CRUD; resolves MBTI base images; provides path-safe file access.
- `server/services/personaSceneGenerator.ts` — `generatePersonaScene`, `generateSceneOpeningLine`; uses Gemini (`@google/genai`) to generate and validate scene opening lines from a user idea and persona description; imports `GoogleGenAI` and `zod`.
- `server/routes/userPersonaImage.ts` — standalone router (not factory-pattern); `POST /api/user-personas/:id/generate-expression/:emotion`; calls Gemini image generation API (`@google/genai`) to produce expression images for user-created personas; writes results via `mediaStorage`.

**Routes / endpoints**

| Verb | Path | Auth | Category |
|---|---|---|---|
| GET | `/api/mbti-personas` | JWT | Internal |
| GET | `/api/mbti-personas/:id` | JWT | Internal |
| PUT | `/api/admin/personas/:id` | JWT + admin | Admin |
| POST | `/api/admin/personas/:id/generate-clip` | JWT + admin | Admin |
| GET/POST/PUT/DELETE | `/api/user-personas/*` | JWT | Internal |
| GET/POST/PUT/DELETE | `/api/persona-scenes/*` | JWT | Internal |
| POST | `/api/persona-scenes/generate` | JWT | Internal |
| POST | `/api/user-personas/:id/generate-expression/:emotion` | JWT | Internal |
| GET/POST | `/api/v1/agent/personas` | API Key | External/Agent |

**Client entry points**

- `client/src/pages/home.tsx` — persona selection, persona-scene listing
- `client/src/hooks/chat/useChatSession.ts` — resolves active persona during conversation
- `client/src/hooks/chat/useAvatarRenderer.ts` — reads persona avatar media
- `client/src/components/ChatWindow.tsx` — persona identity display
- `client/src/lib/scenario-system.ts` — `ScenarioPersona` client type

**Inbound dependencies:** Scenario (embeds persona references in JSONB), Session (records active persona per run), Voice (loads persona for NPC prompt), Evaluation (persona context in evaluation criteria), Agent API (persona listing endpoint)

**Outbound dependencies:** Media (avatar images and video clips stored/served via `mediaStorage` / `gcsStorage`); MBTI filesystem JSON (persona trait data)

**Extension risk:** High. MBTI persona CRUD lives in `ScenariosMixin` (not `PersonasMixin`). The `videos.clips` JSONB shape in `mbti_personas` is the canonical avatar media registry; it is enriched at read time but the raw storage key is persisted. Adding new clip types requires schema evolution of this JSONB. Scenario embeds persona data as a JSONB snapshot (`personas: Array<{…personaRef…}>`), so persona changes do not automatically propagate.

**Future abstraction candidate:** `PersonaActor` — the NPC as a versioned, typed Actor with a declared capability set (voice, video, emotion axes). Separating `PersonaIdentity` from `PersonaMedia` and `PersonaBehavior` would allow non-human actors (AI Agent, Robot) to share the same capability interface.

---

### 4.2 Scenario Domain

**Responsibility:** Defines the training exercise — context, objectives, NPC personas, flow graph, evaluation harness, simulation harness, difficulty profile, and termination rules. A scenario is the template; a `ScenarioRun` is a single attempt.

**Schema tables**

| Table | Key columns | Notes |
|---|---|---|
| `scenarios` | `id`, `title`, `description`, `personas` (JSONB array), `flowGraph` (JSONB), `evaluationHarness` (JSONB), `simulationHarness` (JSONB), `terminationRules` (JSONB), `playerConstraints` (JSONB), `evaluationCriteriaSetId`, `useVideoAvatar`, `isDeleted` | Central scenario template |
| `scenario_versions` | `id`, `scenarioId`, `version`, `status`, `contentSnapshot` (JSONB), `evaluationHarnessSnapshot` (JSONB), `publishedAt` | Versioning; content and evaluation harness snapshot at publish time |
| `scenario_runs` | `id`, `userId`, `scenarioId`, `scenarioVersionId`, `scenarioSnapshot` (JSONB), `evaluationHarnessSnapshot` (JSONB), `attemptNumber`, `status`, `totalScore`, `mode`, `conversationOrder`, `personaSelections`, `strategyChoices`, `sequenceAnalysis` | Per-attempt run record |

**Storage module:** `server/storage/scenarios.ts` — `IScenariosStorage`, `ScenariosMixin`, `MemScenariosStorage`

Key methods: `getAllScenarios`, `getScenario`, `createScenario`, `updateScenario`, `softDeleteScenario`, `publishScenarioVersion`, `listScenarioVersions`, `getLatestPublishedVersion`, `archiveScenarioVersion`, `rollbackScenarioVersion`, `getAllMbtiPersonas`, `getMbtiPersona`, `createMbtiPersona`, `updateMbtiPersona`, `deleteMbtiPersona`.

**Service files**

- `server/services/fileManager.ts` — scenario CRUD wrapper; filesystem fallback for legacy `scenarios/*.json`
- `server/services/simulation/harnessReader.ts` — `readScenarioHarness`, `applyHarnessToSession`, `initSessionHarness`; reads scenario's `EvaluationHarness`, `FlowGraph`, `TerminationRules`, `NpcBehaviorHarness` at session start
- `server/services/simulation/simulationPrompt.ts` — builds the simulation state block injected into AI prompts using scenario context
- `server/services/voice/systemPromptBuilder.ts` — builds multi-persona / single-persona system instructions using scenario data
- `server/services/aiScenarioGenerator.ts` — `generateScenarioWithAI`, `fillScenarioFieldsWithAI`, `generateEvaluationHarnessWithAI`, `generatePlayerConstraintsWithAI`, `generateNpcBehaviorHarnessWithAI`, `enhanceScenarioWithAI`; uses Gemini (`@google/genai` via `getModelForFeature`) to generate and enrich full scenario templates from admin prompts; admin-facing only.
- `server/services/scenarios/overrideResolver.ts` — `applyScenarioOverride`, `applyEvalWeightsOverride`, `buildOverridePromptBlock`; applies operator-defined scenario overrides (terminology substitutions, forbidden phrases, evaluation weight adjustments) and injects them as prompt blocks. Imports `ScenarioOverrideData` from `@shared/schema`.
- `server/services/scenarios/scenarioValidator.ts` — server-facing re-export barrel for shared scenario validation; re-exports `validateScenario` and validation types from `shared/scenarioValidator`; provides a stable import path for server-side consumers.

**Routes / endpoints**

| Verb | Path | Auth | Category |
|---|---|---|---|
| GET | `/api/scenarios` | JWT | Internal |
| GET | `/api/scenarios/:id` | JWT | Internal |
| POST/PUT/DELETE | `/api/admin/scenarios/*` | JWT + admin | Admin |
| GET/POST | `/api/admin/scenarios/:id/versions` | JWT + admin | Admin |
| POST | `/api/admin/scenarios/:id/override` | JWT + admin | Admin |
| GET | `/api/v1/agent/scenarios` | API Key | External/Agent |
| GET | `/api/v1/agent/scenarios/:id` | API Key | External/Agent |
| GET | `/api/scenario-runs` | JWT | Internal |
| GET/POST | `/api/scenario-runs/:id/*` | JWT | Internal |

**Client entry points**

- `client/src/pages/home.tsx` — scenario listing, filtering, selection
- `client/src/lib/scenario-system.ts` — `ComplexScenario`, `UserPersonaScenario`, difficulty/role helpers
- `client/src/hooks/chat/useChatSession.ts` — holds active scenario during conversation
- `client/src/hooks/useSimulationState.ts` — reads `scenario.simulationHarness`

**Inbound dependencies:** Session (creates ScenarioRun), Simulation (reads SimulationHarness, FlowGraph, TerminationRules), Evaluation (reads EvaluationHarness, EvaluationCriteriaSetId), Voice (builds system prompt from scenario context), Agent API (exposes scenario listing and uses ScenarioRun)

**Outbound dependencies:** Persona (reads persona definitions for enrichment), Evaluation (references `evaluationCriteriaSetId`), Media (scenario intro video URL), AI/Provider (model config in harness)

**Extension risk:** Critical. The `scenarios.personas` JSONB column is both a snapshot and a live configuration — it is not clearly immutable at run time. Provider model selections embedded in `simulationHarness` and `evaluationHarness` create coupling from Scenario to AI/Model Providers. MBTI persona CRUD living in `ScenariosMixin` crosses domain boundaries.

**Future abstraction candidate:** Scenario as a versioned, immutable `ScenarioTemplate`; `ScenarioRun` as the per-Actor attempt record. The `FlowGraph` and `TerminationRules` should become first-class simulation contracts, not inlined JSONB.

---

### 4.3 Session Domain

**Responsibility:** Tracks a single learner attempt — tying together the user, scenario, persona sequence, conversation turns, and simulation state. The session is the unit of evaluation, the persistence boundary for conversation messages, and the container for simulation events.

**Schema tables**

| Table | Key columns | Notes |
|---|---|---|
| `sessions` | `sid`, `sess` (JSONB), `expire` | Express session store (HTTP session only) |
| `scenario_runs` | `id`, `userId`, `scenarioId`, `scenarioVersionId`, `scenarioSnapshot`, `evaluationHarnessSnapshot`, `attemptNumber`, `status`, `totalScore`, `mode`, `conversationOrder`, `personaSelections` | Scenario attempt record [SOT for attempt metadata] |
| `persona_runs` | `id`, `scenarioRunId`, `conversationId`, `personaId`, `personaName`, `personaSnapshot`, `mbtiType`, `phase`, `status`, `turnCount`, `score`, `simulationState`, `terminationReason`, `activePersonaIndex`, `personaSwitchLog`, `feedbackStatus` | Per-persona sub-run; holds simulation state JSONB |
| `chat_messages` | `id`, `personaRunId`, `turnIndex`, `sender`, `message`, `emotion`, `emotionReason`, `userAffect`, `interrupted` | Individual conversation turns [SOT for turn content] |
| `simulation_events` | `id`, `personaRunId`, `scenarioRunId`, `turnIndex`, `eventType`, `toolName`, `args`, `result`, `stateBefore`, `stateAfter`, `stateVersionBefore`, `stateVersionAfter`, `includeInReport` | Simulation state change audit log |

**Storage module:** `server/storage/sessions.ts` — `ISessionsStorage`, `SessionsMixin`, `MemSessionsStorage`

Key methods: `createScenarioRun`, `getScenarioRun`, `updateScenarioRun`, `getUserScenarioRuns`, `createPersonaRun`, `getPersonaRun`, `updatePersonaRun`, `getPersonaRunsByScenarioRun`, `upsertChatMessage`, `getChatMessagesByPersonaRun`, `saveSimulationState`, `getSimulationState`, `createSimulationEvent`, `getSimulationEventsByPersonaRun`, `getEmotionStatsByPersona`.

**Service files**

- `server/services/realtimeVoiceService.ts` — creates and updates `persona_runs` and `chat_messages` during realtime voice sessions; reads `personaRuns` directly via `db` (bypassing storage interface; see §11)
- `server/services/simulation/simulationEngine.ts` — reads/writes `simulationState` JSONB on `persona_runs` via storage
- `server/services/simulation/engine/evaluateUserResponse.ts` — reads `chat_messages` to score user turns

**Routes / endpoints**

| Verb | Path | Auth | Category |
|---|---|---|---|
| POST | `/api/scenario-runs` | JWT | Internal |
| GET | `/api/scenario-runs/:id` | JWT | Internal |
| PATCH | `/api/scenario-runs/:id` | JWT | Internal |
| POST | `/api/scenario-runs/:id/persona-runs` | JWT | Internal |
| GET | `/api/scenario-runs/:id/persona-runs` | JWT | Internal |
| PATCH | `/api/persona-runs/:id` | JWT | Internal |
| GET | `/api/conversations/:id/messages` | JWT | Internal |
| POST | `/api/v1/agent/sessions` | API Key | External/Agent |
| GET | `/api/v1/agent/sessions/:id` | API Key | External/Agent |
| POST | `/api/v1/agent/sessions/:id/message` | API Key | External/Agent |
| DELETE | `/api/v1/agent/sessions/:id` | API Key | External/Agent |

**Client entry points**

- `client/src/hooks/chat/useChatSession.ts` — manages session lifecycle; creates/ends ScenarioRun and PersonaRun; persists messages
- `client/src/hooks/useSimulationState.ts` — polls simulation state from PersonaRun
- `client/src/hooks/useRealtimeVoice.ts` — opens WebSocket with `conversationId`, `personaRunId`

**Inbound dependencies:** Auth (userId from session token), Scenario (scenarioId, scenarioSnapshot), Persona (personaId, personaSnapshot), Voice (persists chat messages via service), Agent API (creates AgentSession linked to PersonaRun)

**Outbound dependencies:** Evaluation (PersonaRun is the evaluation input), Simulation (reads/writes SimulationState on PersonaRun), Feedback (Feedback FK → PersonaRun)

**Extension risk:** Critical. `persona_runs.simulationState` is a mutable JSONB blob — it is the live NPC affective state during a session and is also the persistence boundary. There is no versioned replay capability for simulation state beyond `simulation_events`. The `sessions` table serves only as an HTTP session store and plays no role in scenario session logic. The sentinel pattern `__user_persona__%` (storage/sessions.ts offset 18) for distinguishing user-created personas from MBTI personas is a fragile implicit contract.

**Future abstraction candidate:** Session as a first-class `Interaction` container, with typed turn events rather than appended JSONB arrays. Separating `ScenarioRun` (attempt metadata) from `Interaction` (the live turn-event stream) would enable replay, branching, and cross-actor session support.

---

### 4.4 Evaluation Domain

**Responsibility:** Scores and explains the learner's communication across configurable dimensions. Operates in two modes: per-turn scoring (during simulation) and end-of-session holistic feedback. Custom `evaluationCriteriaSets` with `evaluationDimensions`, rubrics, and few-shot examples allow operator-defined criteria.

**Schema tables**

| Table | Key columns | Notes |
|---|---|---|
| `evaluation_criteria_sets` | `id`, `name`, `isDefault`, `categoryId`, `status`, `version`, `parentSetId` | Evaluation criteria registry; versioned via `version` integer and `parentSetId` FK |
| `evaluation_dimensions` | `id`, `criteriaSetId`, `key`, `name`, `weight`, `scoringRubric` (JSONB), `evaluationPrompt` | Per-dimension rubric and scoring instruction |
| `few_shot_examples` | `id`, `dimensionId`, `transcript`, `score`, `rationale` | Few-shot training examples per dimension |
| `criteria_set_few_shot_examples` | `id`, `criteriaSetId`, `transcript`, `dimensionScores` (JSONB) | Set-level few-shot examples |
| `feedbacks` | `id`, `conversationId`, `personaRunId`, `overallScore`, `scores` (JSONB), `detailedFeedback` (JSONB), `rubricSnapshot` (JSONB), `conversationSnapshot` (JSONB), `evaluationPromptSnapshot` (JSONB), `modelSnapshot` (JSONB), `criteriaSetVersion`, `scoreAdjustments` (JSONB), `metricSnapshot` (JSONB) | Evaluation result; snapshots criteria, prompt, model, and conversation at time of evaluation |

**Storage module:** `server/storage/conversations.ts` — feedback CRUD; `server/storage/sessions.ts` — emotion stats and simulation event reads used by evaluation

Key methods (in conversations mixin): `getFeedback`, `getFeedbackByPersonaRun`, `createFeedback`, `updateFeedback`; (in sessions mixin): `getEmotionStatsByPersona`, `getSimulationEventsByPersonaRun`.

**Service files**

- `server/services/evaluationEngine.ts` — pure scoring helpers: `isVoiceMode`, `filterVoiceNoise`, `calcEffectiveRatio`, `analyzeNonVerbalPatterns`, `analyzeBargeIn`, `calculateCompletionPenalty`, `getScoreCap`, `calculateWeightedOverallScore`, `getDefaultScores`. No provider SDK; no storage calls; all inputs passed in.
- `server/services/simulation/engine/evaluateUserResponse.ts` — per-turn LLM-backed evaluation; calls Gemini via `@google/genai` directly with `getModelForFeature('evaluation')`; falls back to rule-based scoring on timeout (8 s); returns `TurnScore` + NPC emotion patch.
- `server/services/aiServiceFactory.ts` — `generateFeedback`, `generateStrategyReflectionFeedback`; dispatches to provider based on settings.
- `server/services/providers/optimizedGeminiProvider.ts` — end-of-session holistic feedback with few-shot examples from storage.

**Routes / endpoints**

| Verb | Path | Auth | Category |
|---|---|---|---|
| GET | `/api/evaluation-criteria` | JWT | Internal |
| POST | `/api/evaluation-criteria` | JWT + operator | Internal |
| GET | `/api/evaluation-criteria/:id` | JWT | Internal |
| PUT | `/api/evaluation-criteria/:id` | JWT + operator | Internal |
| POST | `/api/evaluation-criteria/:id/approve` | JWT + admin | Admin |
| GET | `/api/evaluation-criteria/:id/dimensions` | JWT | Internal |
| POST/PUT/DELETE | `/api/evaluation-criteria/:id/dimensions/*` | JWT + operator | Admin |
| GET | `/api/few-shot-examples/*` | JWT + operator | Admin |
| GET | `/api/feedback/:id` | JWT | Internal |
| POST | `/api/v1/agent/sessions/:id/feedback` | API Key | External/Agent |

**Client entry points**

- `client/src/pages/FeedbackView.tsx` — displays evaluation results (scores, dimension breakdowns, development plan)
- `client/src/pages/Analytics.tsx` — aggregated score trends
- `client/src/hooks/useSimulationState.ts` — reads `recentTurnScores` from simulation state

**Inbound dependencies:** Session (PersonaRun FK on Feedback; conversation turns as evaluation input), Scenario (EvaluationHarness embedded in scenario), Simulation (per-turn scores fed back into simulation state), Agent API (exposes evaluation results and per-turn scores)

**Outbound dependencies:** AI/Model Providers (LLM calls for rubric scoring), Storage (criteria sets, few-shot examples, feedback persistence)

**Extension risk:** High. Per-turn evaluation (`evaluateUserResponse.ts`) imports `@google/genai` directly rather than going through the provider abstraction (`AIServiceFactory`). This is provider leakage (see §11). The `feedbacks` table stores a `conversationSnapshot` of all messages — this is a denormalized copy, not a reference, so evaluation replay requires trusting the snapshot rather than the live message table. Score dimension keys (`clarity`, `empathy`, `logic`, `ownership`, `actionPlan`) are string literals scattered across schema, routes, and evaluation engine with no single typed registry.

**Future abstraction candidate:** `EvaluationTrace` — a versioned, immutable record linking a specific `Interaction` snapshot, the `EvaluationCriteriaSet` version used, and the resulting scores. Enables reproducible re-evaluation and cross-actor comparison.

---

### 4.5 Emotion Domain

**Responsibility:** Tracks and communicates the NPC's emotional state and the user's affect state during conversation and voice sessions. Emotion flows in two directions: NPC emotion is generated by the AI and consumed by Avatar; user affect is analyzed from speech and consumed by Simulation.

**Schema tables**

| Table | Key columns | Notes |
|---|---|---|
| `chat_messages` | `emotion`, `emotionReason`, `userAffect` (JSONB) | NPC emotion label + reason; user affect per message turn |
| `persona_runs` | `simulationState` (JSONB) — contains `npcAffectiveState` | Live multi-axis NPC affective state (not emotion label) |
| `simulation_events` | `stateBefore`, `stateAfter` | Delta records of affective state changes |

*Emotion has no dedicated schema file; it is a cross-cutting field embedded in Session and Simulation tables.*

**Storage module:** Indirect; accessed via `SessionsMixin` (`upsertChatMessage`, `saveSimulationState`, `getEmotionStatsByPersona`)

**Service files**

- `server/services/voice/emotionAnalyzer.ts` — `analyzeUserEmotion`, `analyzeEmotion`; imports `@google/genai` directly; produces `UserAffectState` (structured JSON: valence, arousal, intent) and a simple NPC emotion label (string); uses `gemini-2.5-flash-lite` for speed. Neutral fallback on error.
- `server/services/simulation/simulationRules.ts` — `inferEmotionPatch`; maps `EvaluationResult` to NPC affective state delta (intensity, trust, rapport, confusion, interest, cooperativeness).
- `server/services/simulation/simulationEngine.ts` — `applySimulationPatch`; applies affective delta to `NpcAffectiveState`, enforcing 0–100 clamp per axis.
- `server/services/voice/geminiMessageHandler.ts` and `openaiRealtimeAdapter.ts` — parse NPC emotion from provider stream, forward to client, trigger emotion analysis of user speech.

**Routes / endpoints**

*No dedicated emotion routes.* Emotion data flows through:
- WebSocket frames on `/api/realtime-voice` (emotion embedded in voice turn events)
- REST response bodies on `/api/scenario-runs/:id/messages` and simulation state endpoints
- `/api/simulation/evaluate` (per-turn evaluation includes emotion update)

**Client entry points**

- `client/src/hooks/chat/useEmotionState.ts` — maintains current NPC emotion label; triggers Avatar state machine transitions
- `client/src/hooks/useRealtimeVoice.ts` — receives emotion events from WebSocket
- `client/src/lib/avatar/VideoAvatarRenderer.ts` — `toVideoEmotionBucket` maps emotion label → positive/neutral/negative clip slot

**Inbound dependencies:** Voice (emotion analyzed from speech), Simulation (emotion delta applied to NPC affective state), Session (emotion persisted per chat message)

**Outbound dependencies:** Avatar (emotion drives clip selection), Simulation (UserAffectState feeds per-turn evaluation), Client (emotion label forwarded via WebSocket)

**Extension risk:** Medium. Emotion exists at two granularities that are not reconciled: a simple three-value bucket (positive/neutral/negative for avatar video clips) and a multi-axis `NpcAffectiveState` (affective.intensity/valence, cognitive.confusion/load, relational.trust/rapport, motivational.interest/cooperativeness). The mapping from multi-axis state to avatar emotion bucket is currently done in `VideoAvatarRenderer.ts` on the client, with no server-side canonical mapping. `emotionAnalyzer.ts` imports `@google/genai` directly (provider leakage; see §11).

**Future abstraction candidate:** A typed `EmotionEvent` in the interaction event stream, with a defined mapping layer between multi-axis NPC affective state and avatar display state.

---

### 4.6 Voice Domain

**Responsibility:** Manages real-time bidirectional voice conversations — capturing user speech, forwarding it to a provider (Gemini Live or OpenAI Realtime), streaming NPC audio back to the browser, analyzing user affect from transcripts, and emitting simulation events per turn. The voice service bridges the browser WebSocket to the provider WebSocket.

**Schema tables**

| Table | Key columns | Notes |
|---|---|---|
| `chat_messages` | `sender`, `message`, `emotion`, `userAffect`, `interrupted`, `turnIndex` | Persisted voice turns (AI transcript as `sender: 'ai'`, user transcript as `sender: 'user'`) |
| `persona_runs` | `simulationState`, `turnCount`, `status` | Updated at end of each voice turn |
| `system_settings` | `category='ai'`, `key='model_realtime'` | Selects Gemini Live vs OpenAI Realtime |
| `system_settings` | `category='voice_audio'` | AGC parameters served to client |

**Storage module:** Via `server/storage/sessions.ts` (`upsertChatMessage`, `saveSimulationState`); voice service also reads `personaRuns` directly via `db` (Drizzle raw query, bypassing `IStorage`).

**Service files**

- `server/services/realtimeVoiceService.ts` — main orchestrator; reads `model_realtime` setting to select provider; manages session map; handles client WebSocket upgrade and delegates to sub-handlers.
- `server/services/voice/types.ts` — `RealtimeSession` interface; session carries client WS, provider WS, IDs, transcript buffers, turn counter, pending message queue.
- `server/services/voice/emotionAnalyzer.ts` — user affect analysis (see §4.5).
- `server/services/voice/systemPromptBuilder.ts` — builds system instructions from scenario context, persona MBTI data, simulation state, and difficulty.
- `server/services/voice/geminiMessageHandler.ts` — handles Gemini Live WebSocket events; routes audio, transcription, tool calls, emotion analysis, barge-in detection.
- `server/services/voice/openaiRealtimeAdapter.ts` — handles OpenAI Realtime WebSocket events; same responsibilities.
- `server/services/voice/sessionManager.ts` — session lifecycle helpers; cleanup scheduler; usage tracking; status reporting.

- `server/services/voice/geminiReconnector.ts` — exponential-backoff reconnection for Gemini Live; manages retry delays and session re-establishment.
- `server/services/voice/openaiReconnector.ts` — reconnection for OpenAI Realtime; mirrors `geminiReconnector.ts` for the OpenAI provider path.
- `server/services/voice/clientMessageHandler.ts` — handles all incoming client WebSocket messages (audio chunks, VAD events, control signals); dispatches to provider handlers.
- `server/services/voice/textFilter.ts` — `stripSimulationToolCallText`, `filterThinkingText`, `isStageDirectionText`, `isThinkingText`, `isAINarrativeLine`, `computeReasoningScore`; strips hallucinated simulation tool-call text, stage directions, AI narrative lines, and reasoning/thinking blocks from voice transcripts before they reach the client or are persisted. No external imports.

Sub-directory `server/services/voice/prompts/` — locale-keyed prompt content extracted from `systemPromptBuilder.ts`:

- `server/services/voice/prompts/languageInstructions.ts` — `LANGUAGE_INSTRUCTIONS` record keyed by `LangCode` (`'ko' | 'en' | 'ja' | 'zh'`); per-language prohibition, requirement, and greeting instruction strings used in system prompts. Also exports `USER_PERSONA_LANG_PROHIBITION`.
- `server/services/voice/prompts/sectionText.ts` — `SECTION_TEXT` record keyed by `LangCode`; locale-specific label strings for all system-prompt sections (identity, user info, scenario background, etc.). Imports `LangCode` from `languageInstructions.ts`.
- `server/services/voice/prompts/userPersonaPrompt.ts` — `buildUserPersonaInstructions(userPersonaData, userName, userLanguage)`; builds the user-persona instruction block for user-created persona voice sessions. Imports `USER_PERSONA_LANG_PROHIBITION` from `languageInstructions.ts`.

**Routes / endpoints**

| Verb | Path | Auth | Category |
|---|---|---|---|
| GET (WS upgrade) | `/api/realtime-voice` | JWT token (query param) | Realtime |
| GET | `/api/settings/voice-audio` | JWT | Internal |
| GET | `/api/auth/realtime-token` | JWT | Internal |

**Client entry points**

- `client/src/hooks/useRealtimeVoice.ts` — slim orchestrator; manages WebSocket connection, recording state, reconnection, persona-switch events
- `client/src/hooks/useAudioPlayback.ts` — AudioContext, PCM16 decoding, AGC, output device selection
- `client/src/hooks/useVoiceActivityDetection.ts` — VAD; RMS-based barge-in detection; sends VAD events over existing socket

**Inbound dependencies:** Auth (voice token verification), Session (personaRunId, conversationId for persistence), Scenario (scenario context for system prompt), Persona (persona MBTI data for voice and character instructions), Simulation (simulation state injected into prompts; updated per turn)

**Outbound dependencies:** AI/Model Providers (Gemini Live or OpenAI Realtime WebSocket); Emotion (user affect analysis); Avatar (emotion events forwarded to client to drive avatar); Storage (chat message and simulation state persistence)

**Extension risk:** Critical. `realtimeVoiceService.ts` reads `personaRuns` directly via `db` (Drizzle ORM), bypassing the `IStorage` interface. This tightly couples the voice orchestrator to the PostgreSQL storage implementation. The `userId`, `userPersonaId`, `conversationId`, and `personaRunId` are hardcoded as session identity fields — adding a Robot or AI-agent Actor requires modifying this service's session identity model.

**Future abstraction candidate:** A `VoiceSession` as an Actor-agnostic realtime interaction channel, with the Actor identity decoupled from the channel setup. The provider selection logic should move fully into `AIServiceFactory`.

---

### 4.7 Avatar Domain

**Responsibility:** Renders the NPC's visual representation — either a static/expression image or a looping behavior×emotion video clip. The avatar state machine drives transitions between rendering states based on emotion and voice activity events.

**Schema tables**

*Avatar has no dedicated schema tables.* Avatar media references live in:
- `mbti_personas.images` (JSONB) — expression image paths per gender
- `mbti_personas.videos` (JSONB) — video clip slots per behavior × emotion × gender

**Storage module:** Indirect; Avatar reads persona data via the Persona domain and media URLs via `server/services/mediaStorage.ts`.

**Service files**

- `server/services/mediaStorage.ts` — `MediaStorageService`; serves/stores persona images and video clips; resolves storage backend (GCS, Replit Object Storage, dual, none).
- `server/services/gcsStorage.ts` — GCS-specific operations; `streamGCSObject`, `transformToSignedUrl`, `listGCSFiles`, etc.
- `server/services/gemini-video-generator.ts` — `generateAvatarVideoClip`, `generateVideoFromImage`; calls Gemini Veo via `@google/genai` (`getModelForFeature('video')`) to generate MP4 avatar clips from reference images; normalizes letterbox aspect ratios via `sharp` and `ffmpeg`; tracks video usage via `aiUsageTracker`; saves output via `mediaStorage`. Provider leakage: imports `GoogleGenAI` directly (not through `AIServiceFactory` adapter).
- `server/services/videoAvatarAccess.ts` — `isVideoAvatarManagementAllowed`, `requireVideoAvatarManagementAccess`, `hasVideoAvatarConfiguration`, `parseBooleanSetting`; enforces feature-flag and role-based access control for video-avatar management endpoints; reads `VIDEO_AVATAR_ACCESS_SETTING` from `system_settings` via storage.

**Routes / endpoints**

| Verb | Path | Auth | Category |
|---|---|---|---|
| GET | `/api/media/objects` | Public (signed key) | Internal |
| POST | `/api/admin/personas/:id/generate-clip` | JWT + admin | Admin |
| GET | `/api/admin/personas/:id/clips` | JWT + admin | Admin |

**Client entry points**

- `client/src/lib/avatar/AvatarRenderer.ts` — `AvatarRenderer` interface (abstract)
- `client/src/lib/avatar/VideoAvatarRenderer.ts` — video clip renderer; `toVideoEmotionBucket`, `toVideoBehavior`, `toVideoClipSlot`; uses `toMediaUrl` to resolve storage keys to serving URLs; preloads clips
- `client/src/lib/avatar/AvatarRendererFactory.ts` — selects image vs video renderer based on persona config (`useVideoAvatar` flag on scenario)
- `client/src/lib/avatar/avatarStateMachine.ts` — pure reducer; `transition(state, event)` → new state
- `client/src/hooks/useAvatarStateMachine.ts` — React wrapper for avatar state machine
- `client/src/hooks/chat/useAvatarRenderer.ts` — coordinates renderer lifecycle; resolves persona avatar info including clips

**Inbound dependencies:** Persona (persona images/videos JSONB is the media registry), Emotion (emotion label drives clip slot selection), Voice (speaking/listening behavior drives clip slot selection)

**Outbound dependencies:** Media (`toMediaUrl` → `/api/media/objects?key=…`); no direct provider SDK access from client

**Extension risk:** Medium. The `VideoAvatarRenderer` on the client converts emotion labels to three buckets (`positive`, `neutral`, `negative`). This mapping (`toVideoEmotionBucket`) is implemented in client code and is not coordinated with the server-side multi-axis affective state. The `useVideoAvatar` flag on `scenarios` couples avatar type selection to the scenario rather than to the persona. Clip slot normalization (`normalizeVideoClips` in `shared/schema/personas.ts`) is schema-layer logic.

**Future abstraction candidate:** An `AvatarCapability` interface on `PersonaActor` that declares supported render modes (image/video/3D) and emotion axes, decoupling avatar selection from scenario configuration.

---

### 4.8 Auth Domain

**Responsibility:** Authenticates human users (JWT/session cookie), manages organizations/companies/categories, handles role-based access control, and provides API-key authentication for external agents. User anonymization/retention logic lives here.

**Schema tables**

| Table | Key columns | Notes |
|---|---|---|
| `users` | `id`, `email`, `password` (hashed), `name`, `role`, `tier`, `companyId`, `organizationId`, `assignedCompanyId`, `assignedCategoryId`, `isAnonymized`, `isActive` | Core user record |
| `companies` | `id`, `name`, `code`, `isActive` | Top-level org unit |
| `organizations` | `id`, `companyId`, `name`, `code`, `isActive` | Sub-unit |
| `categories` | `id`, `organizationId`, `name`, `order` | Training category assignment |
| `operator_assignments` | `userId`, `companyId`, `organizationId` | Operator-to-org mapping |
| `user_bookmarks` | `userId`, `scenarioId` | User bookmark references |
| `sessions` | `sid`, `sess`, `expire` | Express session store |
| `agent_api_keys` | `id`, `name`, `keyHash`, `keyPrefix`, `ownerUserId`, `organizationId`, `scopes`, `allowedIps`, `rateLimitPerMinute`, `isActive` | Agent API credentials |
| `agent_key_scenarios` | `agentKeyId`, `scenarioId` | Per-key scenario access control |
| `audit_logs` | `actorUserId`, `organizationId`, `action`, `targetType`, `targetId`, `metadata` | Audit trail for agent API actions |

**Storage module:** `server/storage/users.ts` — `IUsersStorage`, `UsersMixin`, `MemUsersStorage`

Key methods: `getUser`, `getUserByEmail`, `createUser`, `updateUser`, `upsertUser`, `updateLastLogin`, `adminUpdateUser`, `anonymizeUser`, `getAnonymizationCandidates`.

**Service files**

- `server/auth.ts` — Passport.js local strategy; session serialization; `/api/auth/*` routes (`/login`, `/logout`, `/register`, `/user`)
- `server/middleware/authMiddleware.ts` — `requireAuth`, `requireAdmin`, `requireOperator` middleware functions
- `server/middleware/agentApiKeyMiddleware.ts` — `agentApiKeyAuth` middleware; verifies Bearer token, hashes against `agent_api_keys`, checks scopes/IP/expiry; enriches `req.agentKey`
- `server/utils/agentApiKey.ts` — `generateAgentApiKey`, `hashApiKey`, `verifyApiKeyHash`, `extractKeyPrefix`, `computeExpiryDate`; uses HMAC-SHA256 with `AGENT_API_KEY_PEPPER` secret; key format `rpb_<env>_<8hex>_<32hex>`
- `server/services/anonymizationScheduler.ts` — periodic background job; reads `privacy.data_retention_days` from `system_settings`; calls `storage.getAnonymizationCandidates` and `storage.anonymizeUser`; writes `audit_logs` entries via `db` directly; runs on a configurable interval and emits warnings before anonymization.

**Routes / endpoints**

| Verb | Path | Auth | Category |
|---|---|---|---|
| POST | `/api/auth/login` | None | Internal |
| POST | `/api/auth/logout` | JWT | Internal |
| GET | `/api/auth/user` | JWT | Internal |
| GET | `/api/auth/realtime-token` | JWT | Internal |
| POST | `/api/admin/agent-keys` | JWT + admin | Admin |
| GET | `/api/admin/agent-keys` | JWT + admin | Admin |
| DELETE | `/api/admin/agent-keys/:id` | JWT + admin | Admin |
| GET | `/api/admin/organizations/*` | JWT + admin | Admin |

**Client entry points**

- `client/src/hooks/useAuth.ts` — `useAuth` context; provides `User` (id, name, role)
- `client/src/components/auth/AuthProvider.tsx` — fetches `/api/auth/user` on mount; wraps app in auth context

**Inbound dependencies:** All domains (Auth userId is used as FK in ScenarioRun, Conversation, AgentApiKey, Feedback, EvaluationCriteriaSet, etc.)

**Outbound dependencies:** Session (issues tokens and manages cookie-based sessions); Agent API (issues and validates API keys)

**Extension risk:** Medium. The `userId` FK is present as a required field in `scenario_runs`, `conversations`, and `feedbacks`, meaning anonymous or agent-initiated sessions require nullable or sentinel `userId` values. Agent sessions currently set `userId = null` on `scenario_runs` (from `agentApi.ts`). The agent identity is stored in `agent_sessions` (via `agentKeyId`, `externalUserId`) but the core run tables use `userId` (human), not agent identity.

**Future abstraction candidate:** An `ActorIdentity` type that subsumes both `userId` (human) and `agentKeyId`/`externalUserId` (AI agent), allowing any Actor type to create and own sessions.

---

### 4.9 Simulation Domain

**Responsibility:** Drives the NPC's behavior during a scenario — tracking stage transitions, applying affective state deltas, triggering incidents, evaluating user responses per turn, and enforcing termination conditions. Simulation is the stateful game-engine layer that makes roleplay scenarios dynamic.

**Schema tables**

| Table | Key columns | Notes |
|---|---|---|
| `persona_runs` | `simulationState` (JSONB) — `SimulationState` | Live NPC affective + stage state; mutable JSONB blob [SOT during active session] |
| `simulation_events` | `eventType`, `toolName`, `args`, `result`, `stateBefore`, `stateAfter`, `stateVersionBefore`, `stateVersionAfter`, `includeInReport` | Immutable event log; basis for simulation replay |
| `persona_runs` | `terminationReason`, `personaSwitchLog` | Termination outcome; persona switch history |

**Storage module:** `server/storage/sessions.ts` — `saveSimulationState`, `getSimulationState`, `createSimulationEvent`, `getSimulationEventsByPersonaRun`

**Service files**

- `server/services/simulation/simulationEngine.ts` — `applySimulationPatch`, `evaluateFlowGraph`, `checkTermination`, `checkIncidentCooldown`; reads/writes `SimulationState`; no provider SDK imports.
- `server/services/simulation/simulationTypes.ts` — `SimulationState`, `NpcAffectiveState`, `ScenarioStage`, `Incident`, `TurnScore`, `SimulationPatch`, `TerminationResult` type definitions.
- `server/services/simulation/simulationRules.ts` — `inferEmotionPatch`; maps evaluation result to affective delta; applies `NpcBehaviorHarness` trust/escalation triggers.
- `server/services/simulation/simulationPrompt.ts` — `buildSimulationStateBlock`; serializes `SimulationState` into a structured text block for injection into AI prompts.
- `server/services/simulation/simulationToolHandler.ts` — handles AI tool calls during voice sessions (`npcAffectiveStateDelta`, `triggerIncident`, `updateScenarioState`); applies patches and logs events.
- `server/services/simulation/simulationHarness.ts` — `normalizeSimulationHarness`, `resolveHarness`, `resolveCooldownsForType`, `ALL_INCIDENT_TYPES`, `DEFAULT_SIMULATION_HARNESS`; normalizes legacy harness field names (e.g. `emotionModel` → affective-layer names), provides defaults, and resolves per-incident-type cooldowns. Imports `SimulationHarness` from `@shared/schema/scenarios`.
- `server/services/simulation/simulationTools.ts` — `SIMULATION_TOOLS`, `SWITCH_PERSONA_TOOL`, `getSimulationToolsConfig`, `getSimulationToolsWithPersonaSwitch`; defines Gemini/OpenAI function-tool declarations for AI-driven simulation state mutations (NPC affective deltas, incidents, persona switches). No external imports — pure tool schema definitions.
- `server/services/simulation/validateGeminiTools.ts` — `validateGeminiToolDeclarations`, `assertValidGeminiTools`, `ValidationError`; recursively validates Gemini function declaration schemas against supported types at startup and runtime; throws on unsupported schema shapes. No external imports.
- `server/services/simulation/incidentTemplates.ts` — `renderIncidentMessage`; stores per-incident-type message templates and renders them with runtime data (stage, pressure, persona context). Imports `IncidentType` from local `simulationTypes`.
- `server/services/simulation/personaSwitchEvaluator.ts` — `evaluatePersonaSwitchRules`, `PersonaSwitchResult`; evaluates persona-switch rule conditions (operator/condition clauses) against current `SimulationState` and `TurnScore`; returns a switch decision with target persona index. Imports rule types from `@shared/schema/scenarios`.
- `server/services/simulation/evaluateUserResponse.ts` *(top-level re-export shim)* — backward-compatibility barrel; re-exports `evaluateUserResponse`, `EvaluationInput`, `EvaluationResult` from `./engine/evaluateUserResponse`. Consumers that have not yet updated their import path use this file.
- `server/services/simulation/engine/index.ts` — public barrel for the simulation engine sub-directory; re-exports stage-transition inference/resolution, incident inference/probability evaluation, and user-response evaluation with its input/result types from the three engine sub-modules.
- `server/services/simulation/engine/evaluateUserResponse.ts` — per-turn LLM evaluation (see §4.4).
- `server/services/simulation/engine/inferStageTransition.ts` — `inferStageTransition`, `resolveStageTransition`; rule-based + `FlowGraph`-based stage transitions.
- `server/services/simulation/engine/triggerIncident.ts` — `inferIncidentCandidate`, `evaluateIncidentProbability`; constructs incident candidates from pressure/stage/difficulty.
- `server/services/simulation/harnessReader.ts` — `readScenarioHarness`, `applyHarnessToSession`; initializes session harness from scenario JSONB.

**Routes / endpoints**

| Verb | Path | Auth | Category |
|---|---|---|---|
| GET | `/api/simulation/state/:personaRunId` | JWT | Internal |
| POST | `/api/simulation/reset/:personaRunId` | JWT | Internal |
| POST | `/api/simulation/evaluate` | JWT | Internal |
| GET | `/api/simulation/has-data/:personaRunId` | JWT | Internal |
| GET | `/api/simulation/events/:personaRunId` | JWT | Internal |

**Client entry points**

- `client/src/hooks/useSimulationState.ts` — polls simulation state; tracks turn scores, NPC affective state, stage, pressure level
- `client/src/components/SimulationPanel.tsx` — displays live simulation metrics; renders NPC emotion bars

**Inbound dependencies:** Scenario (reads `SimulationHarness`, `EvaluationHarness`, `FlowGraph`, `TerminationRules`, `NpcBehaviorHarness` from scenario JSONB), Session (simulationState stored on PersonaRun), Voice (simulation tool calls invoked from voice message handler), Evaluation (per-turn scores are simulation inputs)

**Outbound dependencies:** Emotion (affective state delta drives NPC emotion label), AI/Model Providers (per-turn evaluation uses Gemini directly), Storage (simulation state + event persistence)

**Extension risk:** High. The simulation engine operates exclusively on a single NPC Actor (the `personaRunId`). Multi-NPC simultaneous interaction is not modeled. The per-turn evaluation inside simulation (`evaluateUserResponse.ts`) imports `@google/genai` directly (provider leakage). The `SimulationState` JSONB on `persona_runs` is the authoritative live state and also the persistence boundary — there is no event-sourced reconstruction from `simulation_events`.

**Future abstraction candidate:** A `SimulationActor` that implements `ActorBehavior` (stage machine, affective model, incident policy) independently of the Voice channel and the specific human/AI-agent Actor on the other side.

---

### API Boundary

**Cross-cutting boundary layer — not a domain**

The API Boundary is the HTTP/WebSocket surface that mediates between external clients (browser, AI agent systems) and the domain services. It enforces authentication, authorization, rate limiting, input validation, and response shaping. It is implemented in `server/routes.ts` (registration), `server/routes/*` (domain routers), `server/auth.ts` (Passport middleware), `server/middleware/*` (auth guards), and `server/openapi/agentApi.ts` (contract).

**Classification of endpoints**

| Category | Auth mechanism | Examples |
|---|---|---|
| Internal | JWT session cookie | `/api/conversations/*`, `/api/scenario-runs/*`, `/api/evaluation-criteria/*`, `/api/bookmarks/*`, `/api/subscriptions/*` |
| Admin | JWT + `role=admin` or `role=operator` | `/api/admin/scenarios/*`, `/api/admin/agent-keys/*`, `/api/admin/languages/*`, `/api/admin/packs/*` |
| Realtime | JWT token in query param → WebSocket | `/api/realtime-voice` |
| Agent (External) | Bearer API key (HMAC-SHA256) | `/api/v1/agent/*` |
| Public | None | `/api/media/objects` (signed key in param), `/api/languages` (public language list) |

**Additional route files not covered in domain sections above:**

| Route file | Mount prefix | Auth | Notes |
|---|---|---|---|
| `server/routes/bookmarks.ts` | `/api/bookmarks` | JWT | User bookmark CRUD (GET/POST/DELETE) against `user_bookmarks` table via storage |
| `server/routes/freeChat.ts` | `/` (root; router defines full paths `/api/free-chat/*`) | JWT + admin role check inside handler | Admin-only free-chat mode; starts an unstructured conversation with an MBTI persona without a scenario; persona must have `freeChatAvailable=true` |
| `server/routes/hrAnalytics.ts` | `/` (root; router defines full paths `/api/analytics/hr/*`) | JWT + operator/admin role gate | HR analytics endpoints (team competency, member feedbacks, skill gap, growth trend, at-risk, benchmark targets, CSV/JSON export); reads `hrBenchmarkTargets` directly via `db`; plan-gated behind `hr_analytics` feature flag |
| `server/routes/imageGeneration.ts` | `/api/image` | ⚠️ **UNAUTHENTICATED — no middleware at all** | Generates and saves scenario images, persona base images, persona expressions, and single expressions via Gemini image model; persists results via `mediaStorage`. All six mutation endpoints (`POST /api/image/generate-scenario-image`, `/generate-preview`, `/generate-persona-base`, `/generate-persona-expressions`, `/generate-persona-single-expression`, `/optimize-existing-images`) are reachable without a session token. This is a **serious unauthenticated mutation surface** — any caller can trigger AI image generation and overwrite stored media assets. Authentication must be added at the router level. Imports `GoogleGenAI` directly (provider leakage). |
| `server/routes/translations.ts` | `/` (root; router defines full paths `/api/languages`, `/api/scenarios/:id/translations/*`, etc.) | Public (GET) + JWT + operator (PUT/POST/DELETE) | Scenario and persona i18n: locale listing, translation CRUD, AI-powered `generate-translation` and `auto-translate`; uses `getAIServiceForFeature` for AI translation |
| `server/routes/store.ts` | `/api/store` | Public (optAuth for catalog) + JWT + system admin (admin ops) | Pack catalog and entitlements: `GET /api/store/packs` (public), `POST /api/store/packs/:id/checkout` (Stripe), `GET /api/store/my-library`, admin pack/entitlement CRUD, revenue summary; uses `stripeClient` |
| `server/routes/subscriptions.ts` | `/api/subscriptions` | JWT | User and org subscription management: plan listing, current subscription, system-admin plan assignment; reads `plans` and `subscriptions` via storage |
| `server/routes/userPersonaImage.ts` | `/api/user-personas` | JWT | Three endpoints on user-created personas: `POST /api/user-personas/:id/generate-image` (full avatar), `POST /:id/generate-expressions` (all expressions batch), `POST /:id/generate-expression/:emotion` (single expression); all use `isAuthenticated`; calls Gemini image model directly (provider leakage) |

**Key coupling observations**

- `server/routes/agentApi.ts` directly queries Drizzle tables (`agentKeyScenarios`, `agentSessions`, `agentUsageDaily`, `personaRuns`, `auditLogs`) rather than going through the storage interface — this is a Storage bypass that creates a hidden coupling between the API Boundary and the PostgreSQL schema.
- `server/routes.ts` line 287 contains a Swagger UI option (`customJsStr`) that does not match the installed type definitions — a pre-existing type error visible in the type-check output.
- The WebSocket upgrade block in `server/routes.ts` passes the raw HTTP upgrade request directly to `realtimeVoiceService.handleUpgrade`, coupling the route registration file to the voice orchestrator implementation.

---

## 5. Supporting / Cross-Cutting Systems

### 5.1 Storage

**Responsibility:** Abstracts all database and in-memory persistence behind a single `IStorage` interface. The composite is assembled in `server/storage/index.ts` by mixing in domain-specific storage classes.

**Architecture**

```
IStorage (interface, server/storage/index.ts)
  = IPersonasStorage
  + IScenariosStorage
  + ISessionsStorage
  + IConversationsStorage
  + IUsersStorage
  + IAnalyticsStorage
  + ITranslationsStorage
  + ISettingsStorage
  + IAiUsageStorage
  + IBillingStorage   (brief reference only)
  + IStoreStorage     (brief reference only)

PostgreSQLStorage implements all mixins via:
  PersonasMixin (server/storage/personas.ts)
  ScenariosMixin (server/storage/scenarios.ts)
  SessionsMixin (server/storage/sessions.ts)
  ConversationsMixin (server/storage/conversations.ts)
  UsersMixin (server/storage/users.ts)
  + inline implementations for analytics, translations, settings, billing, store

MemStorage provides in-memory stubs for all domains
  (enabled when USE_MEM_STORAGE=true)
```

**Key constraint:** `IStorage` provides **logical isolation** (each domain's methods are namespaced), not **runtime isolation** (all domains share a single PostgreSQL connection pool via `server/storage/db.ts`). A single `db` export from `server/storage/db.ts` is imported directly by `realtimeVoiceService.ts`, `server/routes/agentApi.ts`, `server/services/feedbackGenerationTracker.ts`, `server/services/anonymizationScheduler.ts`, and `server/routes/hrAnalytics.ts`, bypassing `IStorage`.

**Schema:** `server/storage/db.ts` — exports `db` (Drizzle client), `pool` (node-postgres pool), `checkDatabaseConnection`.

### 5.2 AI / Model Providers

**Responsibility:** Abstracts LLM and multimodal AI calls behind `AIServiceInterface`. Three provider adapters exist, selected at runtime by `AIServiceFactory` based on `system_settings`.

**Interface definition** (`server/services/aiService.ts`):
- Defines the shared `AIServiceInterface` contract implemented by all three provider adapters.
- Exports `AIServiceConfig`, `ScenarioPersona`, `RoleplayScenario`, `EvaluationCriteriaWithDimensions`, `StrategyContext`, `StrategyReflectionEvaluation`, `StrategyEvaluationInput`, `SupportedLanguage`, `LANGUAGE_INSTRUCTIONS`, and `emotionEmojis`.
- Imports schema types from `@shared/schema`; no SDK dependencies.

**Provider adapters** (inside `server/services/providers/`):

| Adapter | SDK | Models | Notes |
|---|---|---|---|
| `OptimizedGeminiProvider` | `@google/genai` | `gemini-2.5-flash`, `gemini-2.5-flash-image`, `veo-3.1-*` | Primary; handles roleplay, feedback, image, video generation; reads few-shot examples from storage |
| `OpenAIProvider` | `openai` | `gpt-4o`, `gpt-4o-mini` | Secondary; reads MBTI personas from storage for persona creation |
| `CustomProvider` | `fetch` | Configurable (OpenAI-compatible API) | Tertiary; no SDK; calls configured `baseUrl` |

**Factory** (`server/services/aiServiceFactory.ts`):
- `getAIServiceForFeature(feature)` — maps feature keys (`roleplay`, `evaluation`, `feedback`, `image`, `video`, `avatar`) to provider + model from `system_settings` or env vars.
- `generateAIResponse`, `generateFeedback`, `generateStreamingAIResponse` — thin wrappers.
- Fallback hierarchy: Claude → Gemini (Claude is not a separate adapter; falls back to Gemini when selected).

**Provider leakage (out-of-adapter SDK usage):**
- `server/services/voice/emotionAnalyzer.ts` — imports `@google/genai` directly.
- `server/services/simulation/engine/evaluateUserResponse.ts` — imports `@google/genai` directly.
- `server/services/realtimeVoiceService.ts` — imports `@google/genai` (`GoogleGenAI`, `Modality`, `ActivityHandling`) for Gemini Live session setup.

These are provider leakages: SDK use outside the designated `providers/` adapter boundary.

**Realtime voice boundary note (architectural notation only; not implemented):** Realtime
voice may need a capability-specific boundary separate from ordinary request/response
model providers:

```
AI Provider Boundary
├── Request/Response Model Provider
├── Streaming Model Provider
└── Realtime Voice Provider
```

The Gemini Live leakage remains a current architectural risk, but its future abstraction
should be evaluated independently because realtime voice involves stateful streaming,
session lifecycle, audio transport, tool calls, interruptions, and reconnect behavior.


### 5.3 Cross-Cutting Supporting Services

These services do not belong to a single core domain — they are shared utilities consumed across multiple domains and route layers.

| Service | Responsibility | Key exports | Consumers |
|---|---|---|---|
| `server/services/conversationContextBuilder.ts` | Centralizes roleplay context construction: normalizes profile names, prepares conversation history, detects role hierarchy, builds speech/difficulty/MBTI guidance blocks, parses join-mode speaker segments. | `normalizeProfileName`, `prepareConversationHistory`, `buildHierarchySpeechGuide`, `buildDifficultyGuidelines`, `buildMBTIContextGuides`, `parseJoinModeSpeakerSegments` | Provider adapters (`OptimizedGeminiProvider`, `OpenAIProvider`), voice `systemPromptBuilder.ts` |
| `server/services/conversationDifficultyPolicy.ts` | Provides difficulty-level policy for text and realtime voice modes: guidelines, soft-closing instructions, validation, defaults, async lookup, and cache invalidation. | `getDifficultyGuidelines`, `getDifficultyGuidelinesAsync`, `getRealtimeVoiceGuidelines`, `getTextModeGuidelines`, `getSoftClosingInstruction`, `validateDifficultyLevel`, `invalidateDifficultyCache` | Provider adapters, voice system prompt builder, scenario routes |
| `server/services/feedbackGenerationTracker.ts` | Tracks in-flight feedback generation status in process memory and persists status to `persona_runs`; provides DB fallback for stale/process-independent checks. Imports `db` directly (bypasses `IStorage`). | `markGenerating`, `isGenerating`, `unmarkGenerating`, `markGenerationError`, `getGenerationError`, `isGeneratingWithDbFallback` | Feedback routes, agent API route |
| `server/services/webhookDelivery.ts` | Dispatches agent lifecycle webhooks: encrypts/decrypts secrets (AES-256-GCM), signs requests (HMAC-SHA256), persists `agent_webhook_deliveries` rows, retries with exponential backoff, supports manual retry and test delivery. | `dispatchWebhook`, `manualRetryDelivery`, `fireTestWebhook`, `encryptWebhookSecret`, `decryptWebhookSecret`, `WebhookEventType`, `WebhookEventData` | `server/routes/agentApi.ts` (fires on session end); `server/routes/adminAgentKeys.ts` (manual retry/test) |

### 5.4 Media

**Responsibility:** Stores and serves binary media assets — persona images, video avatar clips, scenario intro videos, and user uploads. Two backends are supported, selectable via environment variables.

**Storage backends:**

| Backend | Env config | Usage |
|---|---|---|
| Google Cloud Storage (GCS) | `GCS_BUCKET_NAME`, `GCS_SERVICE_ACCOUNT_KEY` | Production primary |
| Replit Object Storage | `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | Development / fallback |
| Dual | Both set | Read from Replit first, fall back to GCS |
| None | Neither set | Error on any media operation |

**Key files:**

- `server/services/mediaStorage.ts` — `MediaStorageService`; path-safety checks (blocks `..`, `/`, `\` in IDs); `savePersonaImage`, `saveUserPersonaImage`, `saveScenarioVideo`, `uploadFile`, `getObject`, `deleteFile`; uses `sharp` for image resize/thumbnail.
- `server/services/gcsStorage.ts` — GCS bucket operations; `streamGCSObject`, `transformToSignedUrl`, `listGCSFiles`; normalizes media prefixes (`scenarios/`, `personas/`, `uploads/`, `videos/`).
- `client/src/lib/mediaUrl.ts` — `toMediaUrl(key)` → `/api/media/objects?key=<normalized-key>`; client-side URL resolver; does not call the server at import time.

**Media identity vs. URL distinction:**
- Storage keys (raw GCS object paths like `personas/<id>/<gender>/<emotion>.webp`) are persisted in database JSONB fields.
- Serving URLs (`/api/media/objects?key=…` or signed GCS URLs) are generated at read time by `mediaStorage.ts` or `gcsStorage.ts`.
- `toMediaUrl` on the client converts a raw storage key to the serving path; it does not validate key existence.
- The `mbti_personas.videos.clips` JSONB stores raw storage keys (GCS object paths), not signed URLs. The admin route for avatar clip generation auto-saves the raw key returned by the video generator. The client-side `VideoAvatarRenderer` calls `toMediaUrl` at render time to obtain the serving URL.

---
## 6. Actor Abstraction Candidates

The platform currently models exactly two participant roles in a conversation: a **User** (human learner) and a **Persona** (AI-driven NPC). The simulation and agent API introduce a third role (external AI agent), and the roadmap implies a fourth (Robot / Simulator). None of these are typed as first-class Actors in the current codebase.

> **Notation note (not implemented):** The future Actor roles below are architectural notation only — no Actor schema, interface, or abstraction exists in the current codebase. `PersonaActor`/`NPCActor` represents the roleplay counterpart controlled by the platform, while `AgentActor` represents an externally supplied AI system being evaluated. These are distinct roles and must not be conflated.

| Current concept | Current code representation | Future Actor role | Where identity/behavior is hard-coded |
|---|---|---|---|
| **User (human learner)** | `users.id` (UUID); `req.user` from Passport session; `userId` FK on `scenario_runs`, `conversations`, `feedbacks` | `HumanActor` | `scenario_runs.userId` is nullable only for agent sessions; `sender: 'user'` string literal in `chat_messages`, `evaluationEngine.ts`, all providers; VAD and audio input assumed to exist only for human actors |
| **Persona (NPC)** | `mbti_personas.id` or `user_personas.id`; `personaId` FK on `persona_runs`, `conversations`, `agent_sessions`; JSONB snapshot in `persona_runs.personaSnapshot` | `PersonaActor` / `NPCActor` *(notation only)* | `sender: 'ai'` string literal in `chat_messages` and providers; emotion analysis direction assumed to be user-toward-NPC; persona selection and avatar rendering assume a single active NPC |
| **External AI Agent** | `agent_sessions.externalUserId` (string, caller-supplied); `agentKeyId` (FK to `agent_api_keys`); no typed agent identity record | `AgentActor` *(notation only)* | `scenario_runs.userId = null` is the current sentinel for agent sessions; no agent version, model, or configuration fields exist in `agent_sessions`; `agentSessions.externalUserId` is opaque string with no validation |
| **Simulator (test harness)** | Not a distinct concept; simulation engine operates on `personaRunId` which implicitly belongs to a human or agent session | `SimulationActor` *(notation only)* | Simulation engine assumes a single NPC persona per `personaRunId`; multi-actor simulation not modeled |
| **Robot** | Absent — no current implementation | `RobotActor` *(notation only)* | Not present; do not invent a current Robot implementation |

**Hardcoded actor assumption inventory (key locations):**

| File | Symbol / line reference | Assumption |
|---|---|---|
| `server/services/providers/optimizedGeminiProvider.ts` | `sender === 'user'` (roleplay history mapping) | Human learner always in `user` Gemini role |
| `server/services/providers/openaiProvider.ts` | `sender === 'user'` → OpenAI `user` role | Same assumption for OpenAI |
| `server/services/evaluationEngine.ts` | `sender === 'user'` filter in `filterVoiceNoise`, `analyzeNonVerbalPatterns`, `analyzeBargeIn` | Evaluation input always from human |
| `server/services/realtimeVoiceService.ts` | persists `sender: 'ai'` / `sender: 'user'` in `upsertChatMessage` | Binary sender labels; no multi-actor support |
| `server/storage/sessions.ts` | `sender='ai'` in `getEmotionStatsByPersona` query | Emotion stats only computed for AI-side turns |
| `shared/schema/agentApi.ts` | `agentSessions.externalUserId` (varchar, no FK, no validated type) | Agent identity is a free-form string |
| `client/src/hooks/useRealtimeVoice.ts` | URL query params: `conversationId`, `scenarioId`, `personaId` (line ~412) | Voice channel assumes exactly one scenario + one persona per session |
| `server/services/voice/systemPromptBuilder.ts` | Role distinction: "user/player" vs "NPC/persona" in prompt sections | System prompt assumes binary human vs. NPC structure |

---
## 7. Runtime Data Flows

### 7.1 Roleplay (Text Mode)

```
Input:
  User types message → POST /api/conversations/:id/messages
  [body: { message: string, scenarioId, personaId, conversationId }]

State (transient):
  [T] Express request context (req.user, scenario, persona objects loaded from storage)
  [T] Conversation history (chat messages loaded from DB for context window)

Event:
  AIServiceFactory.generateAIResponse(scenario, persona, messages, mode)
  → Provider selected from system_settings ('roleplay' feature)
  → OptimizedGeminiProvider / OpenAIProvider / CustomProvider invoked

Transformation:
  Provider builds conversation history, system prompt (persona traits, scenario context)
  → LLM call (Gemini / OpenAI / Custom)
  → Response parsed: { reply, emotion, emotionReason }

Output:
  → chat_messages upserted (sender='ai', emotion, emotionReason) [P]
  → Response JSON: { reply, emotion, emotionReason, turnIndex }

Persistence:
  chat_messages [P SOT for turn content]
  conversations.messages JSONB [P denormalized copy — legacy field still updated]
  persona_runs.turnCount incremented [P]
  ai_usage_logs [P usage tracking]
```

### 7.2 Realtime Voice → Emotion → Avatar

```
Input:
  User speaks → Browser AudioContext captures PCM16
  useVoiceActivityDetection → VAD event (barge-in threshold)
  useRealtimeVoice → WebSocket send { type: 'audio_chunk', data: base64PCM }

State (transient, server side):
  [T] RealtimeSession { clientWs, providerWs, userId, personaRunId, transcriptBuffer,
                        turnCounter, pendingMessages }
  [T] Simulation state (in memory between DB saves)

Event (server, via WS ≈≈≈):
  clientMessageHandler receives audio_chunk
  → forwarded to Gemini Live / OpenAI Realtime over provider WS

  Provider streams back:
    audio delta → forwarded to client ≈≈≈ { type: 'audio_delta', data: base64PCM }
    transcript delta → buffered in session
    tool call (npcAffectiveStateDelta / triggerIncident) → simulationToolHandler
    turn complete signal → triggers post-turn processing

Post-turn transformation:
  1. EmotionAnalyzer.analyzeUserEmotion(userTranscript)  [Gemini Flash Lite call]
     → UserAffectState { valence, arousal, intent }
  2. EvaluateUserResponse(userTranscript, chatHistory, simulationState)  [Gemini Flash call]
     → TurnScore { clarity, empathy, logic, ownership, actionPlan }
     → NpcEmotionPatch
  3. SimulationEngine.applySimulationPatch(state, patch)
     → updated NpcAffectiveState (0-100 axes clamped)
  4. InferStageTransition(state, flowGraph, turnScore)
     → stage advance or hold
  5. CheckTermination(state, terminationRules) → TerminationResult

Output (server → client ≈≈≈):
  { type: 'transcript_user', text: string }
  { type: 'transcript_ai', text: string, emotion: string, emotionReason: string }
  { type: 'simulation_state_update', state: SimulationState }
  { type: 'turn_score', score: TurnScore }
  { type: 'emotion_update', emotion: VideoAvatarEmotion }

Client:
  useRealtimeVoice receives transcript_ai + emotion_update
  → useEmotionState updates currentEmotion [T]
  → avatarStateMachine.transition(state, { type: 'EMOTION_CHANGE', emotion })
  → VideoAvatarRenderer.selectClip(behavior, emotionBucket)
  → HTML <video> src swapped to preloaded clip

Persistence:
  chat_messages upserted (sender='user' + sender='ai') [P SOT for turn content]
  persona_runs.simulationState updated (JSONB blob) [P SOT during session]
  simulation_events created for tool calls [P audit log]
  ai_usage_logs [P usage tracking]
```

### 7.3 Evaluation (End-of-Session Feedback)

```
Input:
  Client → POST /api/scenario-runs/:id/feedback  (or Agent API session end)
  personaRunId identifies the session

State (transient at evaluation time):
  [T] Chat messages loaded from chat_messages (ordered by turnIndex)
  [T] EvaluationCriteriaSet with dimensions + rubrics + few-shot examples (from DB)
  [T] SimulationEvents (for metric computation)
  [T] SystemSettings: model for 'feedback' feature

Event:
  generateFeedback(messages, criteria, scenario, persona, language)
  → AIServiceFactory selects provider ('feedback' feature)
  → OptimizedGeminiProvider.generateFeedback
       reads storage.getActiveFewShotExamplesByDimension
       constructs evaluation prompt with rubrics, few-shot examples, conversation
       LLM call → structured JSON EvaluationScore[]

Transformation:
  EvaluationEngine helpers applied:
    filterVoiceNoise (removes non-verbal tokens)
    analyzeBargeIn (barge-in penalty)
    analyzeNonVerbalPatterns (non-verbal penalty)
    calculateCompletionPenalty (turn ratio check)
    getScoreCap (evidence-cap enforcement)
    calculateWeightedOverallScore (dimension weights → 0-100)
  ScoreAdjustments computed
  DetailedFeedback assembled (strengths, improvements, nextSteps, developmentPlan)
  MetricSnapshot computed from simulation events

Output:
  feedbacks record created [P]:
    scores (JSONB)
    detailedFeedback (JSONB)
    rubricSnapshot (JSONB — criteria set state at eval time)
    conversationSnapshot (JSONB — all messages at eval time)
    evaluationPromptSnapshot (JSONB — prompt used)
    modelSnapshot (JSONB — model config used)
    metricSnapshot (JSONB — derived simulation metrics)
    criteriaSetVersion (integer)
    scoreAdjustments (JSONB)

Persistence:
  feedbacks [P SOT for evaluation result]
  persona_runs.feedbackStatus updated [P]
  scenario_runs.totalScore updated [P]
  Agent API: webhook fired if configured (agent_webhook_deliveries) [P]
```

### 7.4 Simulation (Per-Turn, During Voice Session)

```
Input:
  AI generates tool call during Gemini Live / OpenAI Realtime turn:
    { name: 'npcAffectiveStateDelta', args: { axis: string, delta: number } }
    { name: 'triggerIncident', args: { type: string, severity: number } }
    { name: 'updateScenarioState', args: { stage: string } }
  OR
  Auto-evaluation trigger at end of AI turn (evaluateUserResponse)

State (transient):
  [T] SimulationState in RealtimeSession memory (loaded from DB at session start)
  [T] Scenario harness (FlowGraph, TerminationRules, DifficultyProfile)

Event:
  simulationToolHandler.handleToolCall(toolName, args, state, harness)
  → SimulationEngine.applySimulationPatch(state, patch)

Transformation:
  Affective delta clamped to 0-100 per axis
  NpcBehaviorHarness trigger keywords checked against last user turn
  FlowGraph exit conditions evaluated per axis
  TerminationRules checked (success / failure / timeout)
  IncidentCooldown checked before triggering new incident

Output:
  Updated SimulationState { stage, pressureLevel, npcAffectiveState, currentScore,
                            recentTurnScores, summary }
  SimulationEvent created for each tool call

Persistence:
  persona_runs.simulationState (JSONB) saved every N turns [P — mutable SOT]
  simulation_events row created per tool call [P — immutable audit]
  Termination: persona_runs.status='completed', terminationReason set [P]
```

---

## 8. Cross-Domain Dependency Matrix

> The nine **core domains** and the **cross-cutting / boundary systems** are presented in separate matrices below. API Boundary, Storage, AI/Model Providers, and Media are cross-cutting systems that serve all core domains; they are not core domains themselves (see §1 Purpose & Scope and §5 Supporting / Cross-Cutting Systems).

`→` = direct import / storage call; `→→` = runtime data flow only (no compile-time import)
### 8a. Core Domain Dependency Matrix

Rows and columns are the nine core domains only: Persona, Scenario, Session, Evaluation, Emotion, Voice, Avatar, Auth, Simulation.

| From ↓ \ To → | Persona | Scenario | Session | Evaluation | Emotion | Voice | Avatar | Auth | Simulation |
|---|---|---|---|---|---|---|---|---|---|
| **Persona** | — | — | — | — | — | — | → (media) | — | — |
| **Scenario** | → (embeds persona JSONB) | — | — | → (criteriaSetId) | — | — | — | — | → (harness JSONB) |
| **Session** | → (personaId FK) | → (scenarioId FK, snapshot) | — | →→ (eval input) | →→ (stores emotion) | →→ (stores messages) | — | → (userId FK) | → (simulationState on PersonaRun) |
| **Evaluation** | — | → (harness, criteriaSetId) | → (messages, PersonaRun) | — | — | — | — | — | → (per-turn TurnScore) |
| **Emotion** | — | — | → (stores emotion in chatMessages) | — | — | → (emotionAnalyzer called from voice) | →→ (drives avatar state) | — | → (NpcAffectiveState) |
| **Voice** | → (persona data for prompt) | → (scenario context for prompt) | → (personaRunId, creates messages) | — | → (calls emotionAnalyzer) | — | — | → (userId for session) | → (simulationToolHandler, state update) |
| **Avatar** | → (reads persona media JSONB) | — | — | — | → (reads emotion label) | → (speaking/listening behavior) | — | — | — |
| **Auth** | — | — | — | — | — | — | — | — | — |
| **Simulation** | — | → (harness, flowGraph) | → (simulationState on PersonaRun) | → (per-turn evaluateUserResponse) | → (NpcAffectiveState delta) | → (tool calls from voice handler) | — | — | — |

### 8b. Cross-Cutting / Boundary Dependency Matrix

These systems cut across all core domains. API Boundary is a cross-cutting boundary layer, not a domain (see §4 API Boundary section and §1 Purpose & Scope). Storage, AI/Model Providers, and Media are the three cross-cutting supporting systems (see §5).

| System | Persona | Scenario | Session | Evaluation | Emotion | Voice | Avatar | Auth | Simulation |
|---|---|---|---|---|---|---|---|---|---|
| **API Boundary** | → | → | → | → | — | → | — | → | → |
| **Storage System** | → | → | → | → | — | → | → | → | → |
| **AI/Model Providers** | — | → (model config from harness) | — | → (rubrics, few-shot) | → (emotion analysis) | → (Gemini Live / OpenAI Realtime) | — | — | → (per-turn eval) |
| **Media System** | → (images/clips) | → (intro video) | — | — | — | — | → (clip serving) | — | — |

---

## 9. Dependency Direction & Contract Boundaries

Expected layering (top to bottom, each layer should only import downward):

```
Client → API Boundary → Application/Service → Domain Logic → Storage → Schema
                                          ↘
                                    Provider Abstraction → Provider SDK
```

| Edge | Expected? | Observed? | Severity | Evidence |
|---|---|---|---|---|
| Client → API Boundary (REST/WS) | ✅ | ✅ | — | `apiRequest` in `queryClient.ts`; WS in `useRealtimeVoice.ts` |
| API Boundary → Service | ✅ | ✅ | — | Routes call `aiServiceFactory`, `simulationEngine`, `evaluationEngine` |
| API Boundary → Storage | ✅ (limited) | ✅ | — | Routes call `storage.*` for CRUD |
| API Boundary → DB (direct) | ❌ | ✅ | **Critical** | `server/routes/agentApi.ts` imports `db` from `server/storage/db.ts` and executes raw Drizzle queries, bypassing `IStorage` |
| Service → Storage | ✅ | ✅ | — | Most services use `storage.*` |
| Service → DB (direct) | ❌ | ✅ | **High** | `server/services/realtimeVoiceService.ts` imports `db` and queries `personaRuns` directly (`db.select().from(personaRuns).where(…)`) |
| Service → Provider Abstraction → SDK | ✅ | ✅ (partially) | — | `aiServiceFactory` dispatches to `OptimizedGeminiProvider`, `OpenAIProvider`, `CustomProvider` |
| Service → Provider SDK (direct, leakage) | ❌ | ✅ | **High** | `server/services/voice/emotionAnalyzer.ts` — imports `@google/genai`, constructs `GoogleGenAI`, calls `generativeModel.generateContent` directly (no `AIServiceFactory` involvement) |
| Service → Provider SDK (direct, leakage) | ❌ | ✅ | **High** | `server/services/simulation/engine/evaluateUserResponse.ts` — imports `@google/genai`, constructs `GoogleGenAI`, calls `geminiModel.generateContent` directly |
| Service → Provider SDK (direct, expected adapter use) | ✅ within adapter | ✅ | — | Inside `providers/optimizedGeminiProvider.ts`, `providers/openaiProvider.ts`: SDK use is within the designated adapter boundary; this is expected, not leakage |
| Service → Provider SDK (direct, Gemini Live setup) | ❌ | ✅ | **High** | `server/services/realtimeVoiceService.ts` — imports `@google/genai` (`GoogleGenAI`, `Modality`, `ActivityHandling`) for Gemini Live WebSocket session setup; not routed through an adapter |
| Storage → Schema | ✅ | ✅ | — | All storage mixins import from `shared/schema` |
| Schema → Schema (cross-domain) | ⚠️ | ✅ | Medium | `shared/schema/scenarios.ts` imports `categories`, `users`, `organizations` from `users.ts`; `shared/schema/conversations.ts` imports `scenarioRuns` from `scenarios.ts`; `shared/schema/feedback.ts` imports `personaRuns` from `conversations.ts` — schema is coupled by FK references |
| Client → Provider SDK | ❌ | ✅ (minor) | Medium | `client/src/hooks/useRealtimeVoice.ts` uses native browser WebSocket (`new WebSocket(url)`) to connect to the server, not a provider SDK directly; no Gemini/OpenAI SDK in client bundle — this is acceptable |
| Client → Shared Types / API Contract | ❌ | ✅ (pre-existing) | Medium | `client/src/hooks/chat/useChatSession.ts` — type error in pre-existing `tsc` output at line 104: `userAffect` property type mismatch between the client's `ConversationMessage` usage and `shared/schema/types.ts`. This is a shared type / API contract boundary issue — the client does not access the database directly. The violation is a client-side type that diverges from the shared schema contract. |
| Provider Abstraction → Storage | ⚠️ (limited) | ✅ | Medium | `OptimizedGeminiProvider` calls `storage.getActiveFewShotExamplesByDimension` and `OpenAIProvider` calls MBTI persona storage methods — providers depend on storage for context loading; acceptable but increases provider coupling |

---
## 10. Snapshot Boundaries

A snapshot is a copy of state captured at a specific point in time for audit, reproducibility, or isolation. The following boundaries have been identified:

| Snapshot type | Storage location | Immutable? | Versioned? | Runtime-enforced? | Role |
|---|---|---|---|---|---|
| **Scenario content** | `scenario_versions.contentSnapshot` (JSONB) | ✅ Yes (row is not updated after publish) | ✅ Yes (integer `version`; `publishedBy`; `publishedAt`) | ❌ No — `scenario_runs.scenarioSnapshot` is a second copy created at run time; no FK to `scenario_versions` | Versioning audit record; `scenario_runs` copy is authoritative for what the learner actually experienced |
| **Evaluation harness (scenario)** | `scenario_versions.evaluationHarnessSnapshot` (JSONB) | ✅ Yes | ✅ Yes | ❌ No | Companion to scenario content snapshot |
| **Evaluation harness (run)** | `scenario_runs.evaluationHarnessSnapshot` (JSONB) | ✅ Yes (set at run start, never updated) | ❌ Not versioned independently — copied from scenario at run time | ❌ No runtime enforcement that run snapshot matches version snapshot | Denormalized copy; used as actual harness for the run |
| **Persona snapshot** | `persona_runs.personaSnapshot` (JSONB); `conversations.personaSnapshot` (JSONB) | ✅ Set at run/conversation start | ❌ No version identifier | ❌ No | Denormalized copy for reproducibility; not guaranteed to match the live `mbti_personas` or `user_personas` record |
| **Evaluation rubric snapshot** | `feedbacks.rubricSnapshot` (JSONB) | ✅ Yes (feedback is never updated after creation except status) | ❌ Uses `criteriaSetVersion` integer, not FK to criteria set row | ❌ No | Audit record; the only way to reproduce the exact scoring at evaluation time |
| **Conversation snapshot** | `feedbacks.conversationSnapshot` (JSONB) | ✅ Yes | N/A | ❌ No | Denormalized copy of `chat_messages` rows at evaluation time; not a reference; de-syncs if messages were mutated after evaluation |
| **Evaluation prompt snapshot** | `feedbacks.evaluationPromptSnapshot` (JSONB) | ✅ Yes | N/A | ❌ No | Audit record of the exact LLM prompt submitted |
| **Model configuration snapshot** | `feedbacks.modelSnapshot` (JSONB) | ✅ Yes | N/A | ❌ No | Audit record of model name/version used for evaluation |
| **Prompt (system instructions)** | Not persisted — built at runtime from scenario + persona + simulation state | N/A | N/A | N/A | Transient; no snapshot; not reproducible from stored data alone |
| **Model configuration (system settings)** | `system_settings` table — mutable key-value store | ❌ No | ❌ No version history | ❌ No | Live configuration; changes affect all future sessions immediately; past session model selections are only recoverable from `feedbacks.modelSnapshot` |

**Key observation:** No snapshot is verified as reproducible. Stored JSONB copies are audit records, not verifiable reproductions. The `scenario_runs.scenarioSnapshot` has no FK to `scenario_versions`, so it cannot be confirmed to match a published version. The `feedbacks.conversationSnapshot` is a point-in-time copy that diverges if `chat_messages` are mutated post-evaluation.

---

## 11. Coupling Hotspots

### Critical

**C1 — `agentApi.ts` direct DB access**
- **Classification:** Critical
- **Evidence:** `server/routes/agentApi.ts` — `import { db } from '../storage/db'` followed by `db.select().from(agentKeyScenarios)…`, `db.insert(agentSessions)…`, `db.update(agentUsageDaily)…`, `db.insert(auditLogs)…`, `db.select().from(agentIdempotencyKeys)…`. Multiple Drizzle raw queries throughout the file bypass `IStorage`, creating a hidden compile-time dependency between the API Boundary layer and the PostgreSQL schema tables directly.
- **Risk:** Any schema change to the affected tables that is not reflected in `agentApi.ts` produces a runtime error with no compile-time warning from the storage interface.

**C2 — `realtimeVoiceService.ts` direct DB access**
- **Classification:** Critical
- **Evidence:** `server/services/realtimeVoiceService.ts` — `import { db } from '../storage/db'` and `db.select().from(personaRuns).where(…)` (used to load persona run on voice session reconnect). This is the only service-layer file (outside `agentApi.ts`) that reads the database directly rather than through `storage.*`.
- **Risk:** Voice service is tightly coupled to the `persona_runs` table schema. A MemStorage swap (for testing) will not affect this read path, creating inconsistent behavior between PostgreSQL and in-memory modes.

### High

**H1 — `emotionAnalyzer.ts` provider leakage**
- **Classification:** High
- **Evidence:** `server/services/voice/emotionAnalyzer.ts` — `import { GoogleGenAI } from '@google/genai'`; constructs a Gemini model (`getModelForFeature('emotion')` → model string) and calls `model.generateContent(…)` directly. Not routed through `AIServiceFactory` or any adapter interface.
- **Risk:** Switching the emotion analysis provider requires modifying this file; the `AIServiceInterface` cannot be swapped in for testing without additional mocking.

**H2 — `evaluateUserResponse.ts` provider leakage**
- **Classification:** High
- **Evidence:** `server/services/simulation/engine/evaluateUserResponse.ts` — `import { GoogleGenAI } from '@google/genai'`; constructs Gemini model with `getModelForFeature('evaluation')` and calls `model.generateContent(…)` directly with 8-second timeout and rule-based fallback. This is the per-turn LLM evaluator inside the simulation engine.
- **Risk:** Same as H1; also, the 8-second timeout and fallback logic are not governed by `AIServiceFactory`'s unified retry/fallback policy.

**H3 — `realtimeVoiceService.ts` provider leakage (Gemini Live)**
- **Classification:** High
- **Evidence:** `server/services/realtimeVoiceService.ts` — `import { GoogleGenAI, Modality, ActivityHandling } from '@google/genai'`; creates a Gemini Live session directly: `const ai = new GoogleGenAI({…}); const session = await ai.live.connect({…})`. No adapter wraps this.
- **Risk:** Switching from Gemini Live to another real-time provider requires modifying `realtimeVoiceService.ts` and its sub-handlers rather than swapping an adapter. This is the largest provider coupling in the codebase.

**H4 — `scenarios.personas` JSONB is both snapshot and live config**
- **Classification:** High
- **Evidence:** `shared/schema/scenarios.ts` — `scenarios.personas` column is a JSONB array containing full persona profile objects (`id`, `name`, `department`, `position`, `stance`, `goal`, `tradeoff`, `voiceId`, `npcBehaviorHarness`). This same column is read at session start to construct NPC prompts and at snapshot time for `persona_runs.personaSnapshot`. No version identifier or immutability guarantee on the column.
- **Risk:** Editing a scenario's persona JSONB retroactively changes the configuration for all future sessions without audit trail. Past `personaSnapshot` records may diverge from the current `scenarios.personas` in ways that are not detectable.

**H5 — `sender` string literal as Actor identity**
- **Classification:** High
- **Evidence:** `shared/schema/types.ts` — `ConversationMessage.sender: "user" | "ai"` (line 3); used in `chat_messages.sender`, `evaluationEngine.ts` (`sender === 'user'` filter), `optimizedGeminiProvider.ts` (`sender === 'user'` → Gemini `user` role), `openaiProvider.ts` (`sender === 'user'` → OpenAI `user` role), `sessionsMixin` (`sender='ai'` in SQL where clause for emotion stats).
- **Risk:** Adding a third actor (AI Agent as learner, Robot) requires a new `sender` value and updates across all filtering logic in the evaluation engine, providers, and analytics queries.

### Medium

**M1 — MBTI persona CRUD in ScenariosMixin**
- `server/storage/scenarios.ts` contains `getAllMbtiPersonas`, `getMbtiPersona`, `createMbtiPersona`, `updateMbtiPersona`, `deleteMbtiPersona`. These methods belong conceptually to the Persona domain but live in the Scenario storage mixin.

**M2 — OpenAIProvider reads MBTI persona storage**
- `server/services/providers/openaiProvider.ts` — calls `storage.getAllMbtiPersonas()`, `storage.getMbtiPersona()`, `storage.createMbtiPersona()`, `storage.updateMbtiPersona()`, `storage.deleteMbtiPersona()`. A provider adapter performing CRUD on persona data crosses the expected provider boundary.

**M3 — `scenarios.evaluationCriteriaSetId` is a nullable string (no FK)**
- `shared/schema/scenarios.ts` — `evaluationCriteriaSetId: varchar(…)` with no foreign key constraint to `evaluation_criteria_sets.id`. Referential integrity is enforced only at the application layer.

**M4 — Client-side emotion-to-avatar bucket mapping**
- `client/src/lib/avatar/VideoAvatarRenderer.ts` — `toVideoEmotionBucket(emotion: string): VideoAvatarEmotion` maps free-form emotion label strings to the three-bucket video slot system. This mapping is purely client-side; no server-side canonical mapping exists.

**M5 — Schema FK chains across files**
- `shared/schema/conversations.ts` imports `scenarioRuns` from `scenarios.ts`; `shared/schema/feedback.ts` imports `personaRuns` from `conversations.ts`. These cross-file FK chains make schema migrations order-dependent and tie schema files to each other at compile time.

**M6 — `use_mem_storage` inconsistency**
- `realtimeVoiceService.ts` and `agentApi.ts` read `db` directly; they will silently use PostgreSQL even when `USE_MEM_STORAGE=true` is set, producing a split-brain storage state during testing.

**M7 — `agentApiKey.ts` key prefix vs. OpenAPI documentation discrepancy**
- `server/utils/agentApiKey.ts` generates keys with prefix `rpb_<env>_…` (line ~25). `server/openapi/agentApi.ts` shows example keys with prefix `agk_live_…`. These do not match.

---

## 12. External Agent Boundary

The external agent integration path from authentication to session to evaluation:

```
External AI Agent System
  │
  │  HTTP POST /api/v1/agent/sessions
  │  Headers: Authorization: Bearer <API key>
  │           X-Idempotency-Key: <UUID>
  │           X-Request-ID: <UUID>
  │
  ▼
agentApiKeyMiddleware (server/middleware/agentApiKeyMiddleware.ts)
  │  1. Extract Bearer token from Authorization header
  │  2. extractKeyPrefix(token) → keyPrefix
  │  3. DB lookup: SELECT * FROM agent_api_keys WHERE key_prefix = ?
  │  4. verifyApiKeyHash(token, keyHash, pepper) → boolean (HMAC-SHA256, timing-safe)
  │  5. Check: isActive, not revokedAt, not expired, scopes include required scope
  │  6. Check: allowedIps (if configured), allowedOrigins (if configured)
  │  7. req.agentKey = { id, organizationId, scopes, … }
  │
  ▼
agentApi router (server/routes/agentApi.ts)
  │  POST /sessions
  │  Body: { scenarioId, personaId, externalUserId, externalSessionId?, language?, difficulty?, metadata? }
  │
  │  Agent identity fields available:
  │    agentKeyId  ← from agentApiKeyMiddleware (req.agentKey.id)     [present]
  │    organizationId ← from agentApiKeyMiddleware (req.agentKey.organizationId) [present]
  │    externalUserId ← from request body (caller-supplied string)     [present, unvalidated]
  │    externalSessionId ← from request body (optional string)         [present if supplied]
  │
  │  Agent identity fields NOT present:
  │    agent version                        [absent — no versioning concept]
  │    agent model / AI system identifier   [absent — no field for which AI system is acting as learner]
  │    agent capability declaration         [absent]
  │    agent configuration snapshot         [absent — metadata JSONB is free-form, not typed]
  │
  │  Creates:
  │    agent_sessions row { id: "ags_<uuid>", agentKeyId, organizationId, externalUserId,
  │                         externalSessionId, scenarioId, personaId, difficulty, status,
  │                         metadata, expiresAt }
  │    scenario_runs row { userId: null, scenarioId, scenarioName, attemptNumber,
  │                        status: 'in_progress', mode, difficulty, scenarioSnapshot }
  │    persona_runs row { scenarioRunId, personaId, personaName, personaSnapshot,
  │                       mbtiType, status: 'active', mode, difficulty }
  │
  ▼
POST /api/v1/agent/sessions/:id/message
  │  Body: { userMessage, language?, difficulty? }
  │
  │  Flow:
  │    1. Load agent_sessions, verify active + not expired
  │    2. Load persona_runs (via personaRunId on agentSession)
  │    3. Load simulation state from persona_runs.simulationState
  │    4. Load scenario harness, MBTI persona
  │    5. Invoke simulationEngine.evaluateUserResponse (Gemini call)
  │    6. Apply simulation patch
  │    7. Check termination conditions
  │    8. Call aiServiceFactory.generateAIResponse (NPC reply)
  │    9. Upsert chat_messages (sender='user', sender='ai')
  │    10. Update simulation state on persona_runs
  │    11. Create simulation_event rows
  │    12. Increment agent_usage_daily
  │    13. Fire webhooks (if configured)
  │
  │  Response: AgentMessageResponse {
  │    id, sessionId, turnId: "${sessionId}-${turnIndex}",
  │    reply: { text, emotionLabel, emotionReason },
  │    simulationState: AgentSimulationState | null,
  │    turnScore: AgentTurnScore | null,
  │    usage: AgentUsage | null,
  │    requestId
  │  }
  │
  ▼
DELETE /api/v1/agent/sessions/:id  (end session)
  │  Triggers:
  │    agent_sessions.status = 'ended', endedAt set
  │    persona_runs.status = 'completed'
  │    scenario_runs.status = 'completed'
  │    generateFeedback (holistic evaluation) → feedbacks row created
  │    Webhook fired: { event: 'session.ended', feedbackReport }
  │
  ▼
GET /api/v1/agent/sessions/:id/feedback
  │  Returns feedbacks row for the session's personaRunId
  │  Available after session end; supports SSE streaming for async generation
  │
  ▼
Evaluation → Simulation → Scenario path (all same as human session)
```

**Idempotency:** `agent_idempotency_keys` table prevents duplicate session creation or message processing when the same `X-Idempotency-Key` is retried within the TTL.

**Audit trail:** `audit_logs` records all agent API actions with `actorUserId=null`, `organizationId`, `action`, `targetType`, `targetId`, and `metadata`.

**Rate limiting:** Per-key configurable (`agent_api_keys.rateLimitPerMinute`); enforced via Redis if `REDIS_URL` is set, otherwise in-memory.

**Key prefix discrepancy:** `server/utils/agentApiKey.ts` generates keys with prefix `rpb_<env>_…`; `server/openapi/agentApi.ts` shows example keys as `agk_live_…` — documentation and implementation disagree.

---

## 13. Future Platformization Map

### Interaction / Trace Boundary

> This subsection maps current representations of conversation and simulation data to a potential future `Interaction` / `EvaluationTrace` role. **No new domain, entity, schema, interface, class, or abstraction is created or designed here. This is observational notation only.**

**Current representation of interaction data (distributed across multiple tables and services):**

| Interaction concept | Current representation | Table / File | Lifecycle | Persistence |
|---|---|---|---|---|
| **Conversation turn (text)** | `chat_messages` row; also denormalized in `conversations.messages` JSONB (legacy) | `shared/schema/conversations.ts` | Created per LLM response; `turnIndex` is sequential | Persisted [P]; `conversations.messages` JSONB is a legacy second copy |
| **Voice turn** | `chat_messages` row with `sender='user'` (transcript) and `sender='ai'` (NPC audio transcript) | `server/services/realtimeVoiceService.ts` | Created post-turn; `interrupted` flag set if barge-in | Persisted [P]; turn boundary is implicit (no explicit voice-turn entity) |
| **Simulation step** | `simulation_events` row; `persona_runs.simulationState` JSONB | `shared/schema/conversations.ts`; `server/storage/sessions.ts` | Event per tool call; state saved periodically (not every turn) | Events are immutable [P]; state is mutable [P]; gap between event and state creates replay ambiguity |
| **Evaluation input** | `feedbacks.conversationSnapshot` JSONB; loaded from `chat_messages` at eval time | `shared/schema/feedback.ts`; `server/services/evaluationEngine.ts` | Captured at evaluation time (session end or agent session end) | Snapshot is immutable [P] but is a point-in-time copy, not a reference |
| **Turn score (per-turn evaluation)** | `AgentTurnScore` in response body; `persona_runs.simulationState.recentTurnScores[]` JSONB | `shared/schema/agentApi.ts`; `server/services/simulation/simulationTypes.ts` | Computed per turn; stored in simulation state JSONB (rolling window) | Transient in simulation state; not independently persisted as a row |

**Future role (notation only — not to be implemented in this task):**

A unified `Interaction` / `EvaluationTrace` concept would consolidate these distributed representations into a single addressable event sequence, enabling:
- Replay from any turn without depending on mutable JSONB state.
- Cross-actor trace comparison (human learner vs. AI agent on same scenario).
- Versioned re-evaluation against updated criteria without re-running the session.

Files that currently embed assumptions that may obstruct this transition:

| File | Assumption |
|---|---|
| `shared/schema/conversations.ts` | `conversations.messages` JSONB is a second (denormalized) turn store alongside `chat_messages` |
| `shared/schema/feedback.ts` | `feedbacks.conversationSnapshot` JSONB is a point-in-time copy, not a reference to an immutable interaction record |
| `server/services/realtimeVoiceService.ts` | Voice turn boundaries are implicit; no explicit turn-start/turn-end event is emitted |
| `server/services/simulation/simulationEngine.ts` | Simulation state is a mutable JSONB blob; `simulation_events` records deltas but reconstruction requires replaying all events in order with correct initial state |
| `shared/schema/agentApi.ts` | `AgentTurnScore` is embedded in `simulationState.recentTurnScores[]`; not independently addressable by turn ID |
| `server/services/simulation/engine/evaluateUserResponse.ts` | Per-turn evaluation result is returned to the caller and applied to simulation state in-memory; not persisted as a first-class evaluation record |

---

### Current → Target Actor and Interaction Model

> **The target model below is architectural notation only. It must not be implemented, and no schemas, interfaces, classes, or abstractions should be created for it as part of this task.**

**Current model:**

```
Session
  └─ ScenarioRun (userId or null, scenarioId, mode)
       └─ PersonaRun (personaId, simulationState JSONB)
            └─ chat_messages (sender: 'user' | 'ai', turnIndex)
            └─ simulation_events (eventType, stateBefore, stateAfter)
            └─ feedbacks (conversationSnapshot JSONB, scores JSONB)
```

Actor identity:
- Human learner: `users.id`
- NPC: `personaId` string (no FK to `mbti_personas`)
- External AI agent: `agentSessions.externalUserId` (free-form string)

**Target model (notation):**

```
Interaction
  └─ ActorRef { type: 'human' | 'agent' | 'npc' | 'simulation' | 'robot', id, version? }
  └─ ScenarioRef { id, versionId }
  └─ TurnEvent[] { index, actorRef, content, timestamp, meta }
  └─ EvaluationTrace { criteriaSetRef, snapshot, scores }

Actor registry (notation only — not implemented):
  HumanActor     { userId }                                          — human learner
  PersonaActor / NPCActor { personaId, harnessRef }                 — platform-controlled roleplay counterpart
  AgentActor     { agentKeyId, externalUserId, model?, version? }   — externally supplied AI system under evaluation
  SimulationActor { scenarioRunId, harnessRef }                     — simulation engine / test harness
  RobotActor     { future }                                         — physical robot (not yet implemented)
```

> `PersonaActor`/`NPCActor` is the platform-controlled roleplay counterpart; `AgentActor` is the externally supplied AI system being evaluated. These are distinct roles and must not be conflated.

**Files that embed current-model assumptions that would need to change:**

| File | Assumption blocking transition |
|---|---|
| `shared/schema/types.ts` | `ConversationMessage.sender: "user" \| "ai"` is a binary label |
| `shared/schema/conversations.ts` | `conversations.personaId` and `persona_runs.personaId` are strings without FK |
| `shared/schema/scenarios.ts` | `scenario_runs.userId` is nullable — agent sessions use `null` sentinel |
| `shared/schema/agentApi.ts` | `agent_sessions` has no `actorType` field; agent model/version are absent |
| `server/services/evaluationEngine.ts` | `sender === 'user'` hardcoded in all evaluation filter logic |
| `server/services/providers/optimizedGeminiProvider.ts` | `sender === 'user'` → Gemini `user` role mapping |
| `server/services/providers/openaiProvider.ts` | `sender === 'user'` → OpenAI `user` role mapping |
| `server/services/realtimeVoiceService.ts` | Voice session identity: `userId`, `userPersonaId`, `personaRunId` are all human-actor IDs |
| `client/src/hooks/useRealtimeVoice.ts` | WebSocket URL params assume one human user, one NPC persona |
| `client/src/lib/scenario-system.ts` | `PlayerProfile` assumes human user attributes |

---
## 14. Test Coverage Map

### Overview

| Domain | Unit | Integration | E2E | Coverage risk |
|---|---|---|---|---|
| Persona | Partial | Partial | None | Medium — MBTI enrichment, avatar media round-trip tested; user persona CRUD not separately tested |
| Scenario | Partial | Partial | None | Medium — scenario validator tested; version publish/rollback not tested |
| Session | Low | Low | None | High — no dedicated session lifecycle tests; PersonaRun creation/completion tested indirectly via agentApi tests |
| Evaluation | High | Medium | None | Medium — evaluation engine helpers tested extensively; per-turn LLM path tested with mocks only |
| Emotion | Medium | Low | None | High — emotionAnalyzer not independently unit-tested; emotion-to-avatar path tested via personaSwitchAvatar.test.ts |
| Voice | Medium | Partial | None | High — realtime WebSocket round-trip with actual provider not tested; reconnection tested with mocks |
| Avatar | Medium | Partial | None | Medium — VideoAvatarRenderer tested; clip slot round-trip tested; actual video playback not testable |
| Auth | Medium | Low | None | Medium — API key middleware tested; session auth not independently tested |
| Simulation | High | Medium | None | Medium — simulation engine, rules, tool handler, stage transition, incident tested; termination conditions partially |
| API Boundary | Medium | High | None | Medium — agentApi route tests are most extensive; internal routes tested via integration; no e2e |
| Media | Medium | Low | None | High — GCS fallback tested with mock; real GCS/Replit Object Storage integration not tested |

### Test file inventory by domain

**Evaluation:**
`tests/server/evaluationEngine.test.ts` — unit; tests `calculateWeightedOverallScore`, `analyzeBargeIn`, `calculateCompletionPenalty`, score caps, adjustment types; no provider mock needed (pure functions).
`tests/server/evaluateUserResponse.test.ts` — unit/integration with mocked Gemini; tests `evaluateUserResponse` harness, fallback, timeout behavior.
`tests/server/evidenceScoreCap.test.ts` — unit; evidence-cap logic.
`tests/server/bargeInAnalysis.test.ts` — unit; barge-in penalty math.
`tests/server/metricSnapshot.test.ts` — unit; metric derivation from simulation events.
`tests/server/optimizedGeminiProvider.test.ts` — integration with mocked Gemini SDK; tests multi-persona feedback, few-shot loading.
`tests/server/benchmarkGroups.test.ts` — unit; benchmark group resolution.
`tests/server/setFewShotExampleFlow.test.ts` — integration; few-shot CRUD flow.
`tests/server/evaluationCriteriaApproval.test.ts` — integration; criteria set approval workflow.

**Voice / Realtime:**
`tests/server/realtimeVoiceService.test.ts` — integration with mocked WebSocket and mocked Gemini/OpenAI; tests session lifecycle, cleanup, usage tracking.
`tests/server/geminiMessageHandler.test.ts` — unit; Gemini Live event parsing, tool call dispatch.
`tests/server/openaiRealtimeAdapter.test.ts` — unit; OpenAI Realtime event parsing.
`tests/server/geminiReconnector.test.ts` — unit; reconnection backoff.
`tests/server/openaiReconnector.test.ts` — unit; OpenAI reconnection.
`tests/server/clientMessageHandler.test.ts` — unit; client WebSocket message routing.
`tests/server/geminiProviderBargeIn.test.ts`, `tests/server/openaiProviderBargeIn.test.ts` — unit; barge-in detection.
`tests/server/textFilter.test.ts` — unit; voice noise filter.
`tests/server/voice/voiceNpcAffectiveState.test.ts` — unit; NPC affective state delta application during voice sessions.
`tests/client/useAudioPlayback.test.ts` — unit (browser mock); AudioContext graph, PCM16, AGC, Bluetooth device selection.
`tests/client/useVoiceActivityDetection.test.ts` — unit (browser mock); VAD threshold, RMS-based barge-in.
`tests/client/useRealtimeVoiceVadSensitivity.test.ts` — unit; VAD sensitivity; **fails with OOM on this environment** (pre-existing heap issue, nondeterministic).
`tests/client/useAudioInputDevices.test.ts` — unit; tri-state device auto-selection.

**Simulation:**
`tests/server/simulationEngine.test.ts` — unit/integration with mocked storage; `applySimulationPatch`, `evaluateFlowGraph`, termination, incident cooldown.
`tests/server/simulation/inferStageTransition.test.ts` — unit; stage transition rules and FlowGraph evaluation.
`tests/server/simulation/simulationRules.test.ts` — unit; emotion patch inference.
`tests/server/simulation/simulationToolHandler.test.ts` — unit; tool call dispatch and simulation event creation.
`tests/server/simulation/triggerIncident.test.ts` — unit; incident candidate inference and probability.

**Agent API / Auth:**
`tests/server/agentApi.test.ts` — integration with mocked storage and AI; session create/message/end/feedback flow; auth enforcement.
`tests/server/agentApiKeyMiddleware.test.ts` — unit; key acceptance, rejection, scope enforcement, IP filtering.
`tests/server/agentApiStreaming.test.ts` — integration; SSE streaming response format.
`tests/server/agentApiKey.test.ts` — unit; key generation, hashing, prefix extraction.
`tests/server/agentApiUsage.test.ts` — unit; usage daily increment, alert threshold logic.
`tests/server/incrementUsageDaily.test.ts` — unit; usage counter increment.
`tests/server/anonymizedUserAuth.test.ts` — unit; anonymized user login prevention.
`tests/server/forbiddenApiEndpoints.test.ts` — unit; endpoint access restriction.

**Avatar / Media:**
`tests/server/clipUrlRoundTrip.test.ts` — integration; clip generation → raw storage key save → `toMediaUrl` resolution.
`tests/server/videoClipEndpoints.test.ts` — integration; video clip API endpoints.
`tests/server/avatarClipPrompt.test.ts` — unit; clip generation prompt construction.
`tests/server/avatarClip.smoke.test.ts` — smoke test; clip generation with mocked provider.
`tests/server/mediaStorageSaveVideo.test.ts` — unit with mocked GCS; `saveScenarioVideo`.
`tests/server/gcsStorageFallback.test.ts` — unit; GCS fallback behavior when bucket unavailable.
`tests/server/scenarioPersonaMediaFallback.test.ts` — unit; persona media enrichment fallback.
`tests/server/videoModelOverride.test.ts` — unit; model override resolution for video generation.
`tests/client/videoAvatarRenderer.test.ts` — unit (browser mock); clip slot selection, emotion mapping, preload/swap.
`tests/client/personaSwitchAvatar.test.ts` — unit (WS mock); persona switch event → avatar resolver.

**Persona / Scenario:**
`tests/server/scenarioValidator.test.ts` — unit; scenario field validation.
`tests/server/fileManagerXss.test.ts` — unit; path traversal prevention in fileManager.
`tests/server/imageGenerationXss.test.ts` — unit; path traversal prevention in image generation.
`tests/server/honorificNim.test.ts` — unit; honorific consistency in NPC replies.
`tests/server/htmlEscape.test.ts` — unit; HTML escaping in report output.
`tests/server/schemaMigrationCoverage.test.ts` — unit; schema export completeness.
`tests/server/aiHarnessGeneration.test.ts` — unit; simulation/evaluation harness generation from AI.
`tests/server/geminiToolValidation.test.ts` — unit; Gemini tool call schema validation.
`tests/server/geminiVideoGeneratorLite.test.ts` — unit; Veo lite model generation.

**Session / Conversation:**
`tests/server/memStorage.test.ts` — unit; MemStorage CRUD for all domains.
`tests/client/useChatSession.test.ts` — unit (mocked API); session lifecycle, message persistence, cache invalidation.
`tests/client/useChatMessages.test.ts` — unit; message list management.
`tests/client/messageSort.test.ts` — unit; message ordering.
`tests/client/realtimeUserMessageDedup.test.ts` — unit; duplicate user message suppression.
`tests/server/realtimeMessageUpsert.test.ts` — unit; chat_messages upsert-on-conflict logic.
`tests/server/emotionStatsByPersona.test.ts` — unit; emotion analytics query.
`tests/server/personaSwitchNoneMode.test.ts` — unit; persona switch disabled when mode='none'.
`tests/server/staleApiRoutes.test.ts` — unit; deprecated route removal.

**Other:**
`tests/client/computeMessagePersonaLabels.test.ts` — unit; persona label resolution for multi-persona conversations.
`tests/client/chatInputBarDevicePopovers.test.tsx` — unit (React component); device selection UI.
`tests/client/generatePrintableContent.test.ts` — unit; PDF/printable content generation.
`tests/client/videoIntroSources.test.ts` — unit; intro video source resolution.
`tests/server/translationRoutes.test.ts` — unit; i18n route behavior.
`tests/server/videoJobStore.test.ts` — unit; async video generation job store.
`tests/server/benchmarkGroups.test.ts` — unit.
`tests/readmeSyncCheck.test.ts` — enforces README/documentation sync.

### Gaps and coverage risks

| Gap | Risk level | Notes |
|---|---|---|
| No E2E tests exist at any layer | High | Full user journey (login → scenario select → voice session → feedback) is not tested end-to-end |
| `realtimeVoiceService` not tested with real provider WebSocket | High | All voice integration tests use mocked `ws` connections; real Gemini Live / OpenAI Realtime behavior is untested |
| Session lifecycle (ScenarioRun + PersonaRun creation/completion) | High | Tested only indirectly via agentApi tests; no dedicated session lifecycle test |
| `emotionAnalyzer.ts` not independently unit-tested | High | Emotion analysis is tested as a side effect in voice handler tests; the analyzer's Gemini call and fallback are not independently verified |
| Simulation termination conditions | Medium | `checkTermination` is tested for some cases; complex `consecutiveTurnsBelow` and multi-axis conditions are not fully covered |
| Media storage backend integration (real GCS) | High | `gcsStorageFallback.test.ts` mocks GCS; no test runs against a real bucket |
| Storage interface consistency (MemStorage vs. PostgreSQL) | Medium | `memStorage.test.ts` covers MemStorage; PostgreSQL behavior tested only via integration tests that require `NEON_DATABASE_URL` |
| `agentApi.ts` direct DB queries | Medium | Agent API integration tests mock storage; the direct `db.*` queries in `agentApi.ts` are not exercised against the real schema in CI |

---

## 15. Open Architectural Questions

> **Observations only. Do not resolve or implement architectural decisions as part of this task.**

The following questions emerged from the audit and represent design decisions that future Platformization work will need to address. They are recorded here as observations, not as decisions or requirements.

---

**Q1 — Should Actors be persisted as first-class entities?**

Currently, Actor identity is distributed across `users`, `agent_api_keys`, `agent_sessions`, and the string literal `sender: 'user' | 'ai'`. There is no `actors` table or `ActorRef` type. This means Actor-level analytics (e.g., "how does an AI Agent perform vs. a human across the same scenario?") require joining multiple tables with different identity schemes. The question is whether a first-class `Actor` entity should be introduced, and if so, what its schema and ownership model should be.

---

**Q2 — Should Interactions be a first-class addressable entity?**

Conversation turns are currently stored in `chat_messages` (normalized) and `conversations.messages` (denormalized JSONB, legacy). Voice turns have no explicit boundary event. Simulation steps are in `simulation_events`. There is no single `Interaction` or `TurnEvent` entity. Evaluation reads from `feedbacks.conversationSnapshot` (a point-in-time JSONB copy). The question is whether a first-class, immutable `Interaction` event stream should replace or overlay the current distributed representation, and how to handle the migration of existing data.

---

**Q3 — Should evaluation input be a Session reference or a Trace reference?**

Currently, evaluation takes a `PersonaRun` (via `personaRunId`) and loads its `chat_messages` from the database. The `feedbacks.conversationSnapshot` is a denormalized copy made at evaluation time. This means re-evaluation against updated criteria requires either trusting the snapshot (which may be stale) or re-loading the live messages (which may have changed). The question is whether evaluation should reference an immutable Interaction/Trace snapshot rather than a mutable Session, and what the lifecycle and ownership of such a trace would be.

---

**Q4 — What is the relationship between ScenarioRun and Session?**

`scenario_runs` tracks a scenario attempt. `persona_runs` tracks per-NPC sub-sessions within that attempt. The HTTP `sessions` table tracks Express session state. There is no unified "Session" concept — the word is overloaded across these three tables and across the Agent API (`agent_sessions`). In a multi-actor platform (Human + AI Agent simultaneously in the same scenario), it is unclear which table would be the container and how the multiple `actor → personaRun` relationships would be represented.

---

**Q5 — How should Agent versioning and capability declaration be handled?**

`agent_sessions.externalUserId` is an unvalidated free-form string. There is no concept of agent version, agent model, or agent capability declaration in the current schema. Per-turn and session-level evaluation scores are generated, but there is no way to attribute them to a specific agent version or configuration. The question is whether agent identity should include structured versioning (model name, version, configuration snapshot) and whether this should be a first-class field on `agent_sessions` or a separate entity.

---

**Q6 — Should evaluation snapshots be verifiably reproducible?**

`feedbacks` stores `conversationSnapshot`, `rubricSnapshot`, `evaluationPromptSnapshot`, and `modelSnapshot` as JSONB. However, there is no mechanism to verify that the snapshot faithfully represents the state that produced the evaluation result — for example, that the `conversationSnapshot` matches the `chat_messages` rows at evaluation time, or that the `rubricSnapshot` matches the `evaluation_dimensions` rows used. The question is whether immutable, content-addressed snapshots (or explicit FKs to versioned rows) are needed for evaluation reproducibility guarantees, and what the storage and migration cost would be.

---

**Q7 — Should the Simulation domain be separated from the Voice and Session domains?**

The simulation engine currently operates within the voice session lifecycle: `realtimeVoiceService.ts` calls `simulationToolHandler`, which calls `simulationEngine`, which writes to `persona_runs.simulationState`. The simulation REST endpoints (`/api/simulation/*`) provide a parallel text-mode path. The question is whether simulation should be an independently addressable service with its own session/run concept, or whether the current coupling to voice sessions and persona runs is the intended long-term architecture.

---

**Q8 — Should provider selection be centralized in AIServiceFactory for all AI calls?**

Three files currently bypass `AIServiceFactory` and import `@google/genai` directly: `emotionAnalyzer.ts`, `evaluateUserResponse.ts`, and `realtimeVoiceService.ts`. The factory provides unified model selection from `system_settings`, fallback handling, and usage tracking. The question is whether all AI calls should be routed through the factory (requiring adapter interfaces for realtime/streaming Gemini Live), or whether the current split — factory for request/response calls, direct SDK for streaming/realtime — is the intended boundary.
