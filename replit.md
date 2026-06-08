# Overview

This project is an AI-powered role-playing training system designed to enhance communication skills for new employees. It uses interactive conversations with AI personas across various workplace scenarios, offering 10-turn dialogues, real-time emotion analysis, and detailed AI-generated feedback. The system supports text, text-to-speech (TTS), and real-time voice conversation modes. The business vision is to provide a scalable and effective tool for professional development, leveraging AI for personalized communication coaching.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend
- **Framework**: React with TypeScript (Vite)
- **UI**: Radix UI with shadcn/ui, Tailwind CSS
- **Routing**: Wouter
- **State Management**: TanStack React Query
- **Forms**: React Hook Form with Zod validation
- **Internationalization**: i18next (`react-i18next`) with `i18next-browser-languagedetector`; supports Korean, English, Japanese, and Chinese (`client/src/lib/i18n.ts`)
- **Conversation Modes**: Text Input, Text-to-Speech (TTS) via ElevenLabs API, and Real-time Voice via Gemini Live API (default) or OpenAI Realtime API (GPT-4o) with full-duplex communication and barge-in support. The active realtime model is configurable via system settings (`ai / model_realtime`). Voice sessions include resilience features like auto-reconnect and context recovery.

## Backend
- **Runtime**: Node.js with Express.js
- **Language**: TypeScript (ES modules)
- **API Design**: RESTful for conversations and feedback, WebSocket for real-time voice. Routes are modularized in `server/routes/`.
- **Authentication**: JWT (JSON Web Tokens) with session management via `sessions` table (PostgreSQL-backed).
- **Authorization**: Resource ownership verification and role-based access control (`admin`, `operator`, `user`). System-admin level checks via `isSystemAdmin` middleware.
- **Security**: JWT_SECRET enforcement, CSRF protection, API key logging prevention, Redis-based login rate limiting (with in-memory fallback when Redis is unavailable), strong password policies, and file upload authentication with path traversal prevention.
- **Enterprise B2B Agent API**: Bearer API-key-authenticated routes at `/api/v1/agent/`. OpenAPI/Swagger docs at `/api/v1/agent/docs` (Swagger UI) and `/api/v1/agent/openapi.json` (dynamic spec). Spec definition in `server/openapi/agentApi.ts`.
- **Payments**: Stripe client (`server/stripeClient.ts`) and webhook handlers (`server/webhookHandlers.ts`) for subscription lifecycle events.
- **Cloud Run Health Checks**: `/_ah/health` (liveness, always 200), `/_ah/ready` (readiness, 503 until app is fully initialized), `/_ah/debug` (diagnostic info, enabled when `DEBUG_ENDPOINT_ENABLED=true` env var is set). Server binds to `0.0.0.0` and registers health endpoints before all route initialization.
- **Application Health API**: `/api/health` returns memory usage, uptime, and realtime voice session counts.
- **Voice Audio Settings**: `/api/settings/voice-audio` exposes configurable AGC parameters (target RMS, min/max gain, attack/release coefficients), seeded from `system_settings` on first access.

## Data Storage
- **ORM**: Drizzle ORM (PostgreSQL dialect). Schema is split into domain modules under `shared/schema/`.
- **Database**: PostgreSQL (Neon serverless).
- **Schema modules**:
  - `users.ts` — `companies`, `organizations`, `categories`, `users`, `operator_assignments`, `user_bookmarks`
  - `conversations.ts` — `conversations`, `persona_runs`, `simulation_events`, `chat_messages`
  - `scenarios.ts` — `scenarios`, `scenario_versions`, `scenario_runs`, `scenario_overrides`
  - `personas.ts` — `mbti_personas`, `user_personas`, `user_persona_likes`, `persona_user_scenes`
  - `feedback.ts` — `feedbacks`, `evaluation_criteria_sets`, `evaluation_dimensions`
  - `analytics.ts` — `ai_usage_logs`, `hr_benchmark_targets`
  - `billing.ts` — `plans`, `subscriptions`
  - `store.ts` — `store_packs`, `store_entitlements`, `store_entitlement_audit_log`
  - `agentApi.ts` — `agent_api_keys`, `agent_key_scenarios`, `agent_sessions`, `agent_idempotency_keys`, `agent_usage_daily`, `agent_key_alerts`, `audit_logs`, `agent_webhooks`, `agent_webhook_deliveries`
  - `i18n.ts` — `supported_languages`, `scenario_translations`, `persona_translations`, `category_translations`, `evaluation_criteria_set_translations`, `evaluation_dimension_translations`
  - `settings.ts` — `system_settings`
  - `sessions.ts` — `sessions` (JWT session store)
- **Scenario Soft Delete**: Scenarios use soft deletion (`is_deleted` flag) to preserve historical data while blocking new interactions.

## Media Storage (Object Storage)
- **Architecture**: Database stores GCS keys; frontend utility `toMediaUrl()` converts keys to serving URLs. Backend endpoints serve files from storage.
- **Dual Deployment Support**: Supports both Replit Object Storage (development with optional dual-writing to GCS) and Google Cloud Storage (production).
- **Path Normalization**: Object paths are automatically normalized by stripping query strings and prefixes.

## Features
- **Comprehensive Persona Reflection**: AI conversations accurately reflect detailed persona definitions including MBTI traits, communication style, motivations, fears, and scenario-specific data.
- **4-Level Difficulty System**: Influences AI responses across all conversation modes.
- **Analytics and Reporting**: Comprehensive user conversation history analytics, including scores, category breakdowns, growth tracking, and pattern recognition, using a research-based 5-point scoring system.
- **HR Analytics**: Aggregate workforce communication metrics, benchmark targets (`hr_benchmark_targets`), and group comparison reports at `/analytics/hr`.
- **Automatic Score Adjustments**: Feedback system applies score adjustments based on non-verbal expressions, barge-in analysis, and scenario context.
- **Real-time Emotion Analysis**: AI characters display emotions visually.
- **Role-Based Access Control**: `admin`, `operator`, `user` roles with distinct permissions.
- **Category System**: Scenarios organized by categories with operator assignments.
- **System Settings Management**: Configurable system parameters, including per-feature AI model selection. Managed via `/system-admin`.
- **AI Usage Tracking**: Logs AI API usage for cost analysis (`ai_usage_logs`).
- **Configurable Difficulty Settings**: Editable difficulty levels via operator dashboard.
- **Intro Video Generation**: Integration with Gemini Veo 3.1 API for scenario intro videos.
- **Multilingual Translation System**: Comprehensive translation management with AI-powered translation generation, manual editing workflow, and support for multiple languages (Korean, English, Japanese, Chinese) via i18n schema tables and i18next on the frontend.
- **Subscription & Token Quota System**: `plans` and `subscriptions` tables with per-cycle token quota enforcement. Token quota is checked before starting real-time voice sessions and at the API level.
- **Store**: Scenario and content packs purchasable at `/store` (`store_packs`, `store_entitlements` tables).
- **Persona Discovery**: Browse and explore AI personas at `/persona` (admin-only).
- **PersonaX Free Chat**: Messenger-style 3-column UI at `/free-chat`. Users create, manage, and share custom AI personas (stored in `user_personas` DB table). Features: public/private toggle, like system (`user_persona_likes` table), chat count tracking, persona editor modal, and MBTI persona tab. Sentinel `__user_persona__:<id>` distinguishes user-created persona chats from MBTI-based free chats in the AI message handler.
- **NPC Simulation Engine**: Server-authoritative simulation state with per-turn Zod-validated deltas, incident cooldowns, and real-time SimulationPanel UI. Text/TTS mode uses synchronous fast-eval: `simulationState` is returned directly in the POST /messages HTTP response. Voice mode uses WebSocket `simulation_update` events. State persists in `persona_runs.simulation_state` JSONB with `simulation_events` audit log.

# External Dependencies

## Third-party Services
- **Google Gemini API**: Gemini 2.5 Flash/Pro for AI conversations, feedback, strategy, scenario generation, and emotion analysis; Gemini Veo 3.1 for intro video generation.
- **OpenAI API**: GPT-4o via OpenAI Realtime API for real-time voice conversations (WebSocket at `/api/realtime-voice`).
- **ElevenLabs API**: Text-to-speech synthesis.
- **Stripe**: Payment processing and subscription webhook handling (`server/stripeClient.ts`, `server/webhookHandlers.ts`).
- **Redis**: Rate limiting for login endpoints (optional; falls back to in-memory store when unavailable).
- **Neon Database**: Serverless PostgreSQL hosting.

## Key Libraries and Frameworks
- **React Ecosystem**: React 18, React Query, React Hook Form, Wouter.
- **UI Components**: Radix UI (shadcn/ui).
- **Internationalization**: i18next, react-i18next, i18next-browser-languagedetector.
- **Database**: Drizzle ORM.
- **Validation**: Zod.
- **API Docs**: swagger-ui-express, OpenAPI 3.x spec.
- **Development Tools**: Vite, TypeScript, Tailwind CSS.
- **Testing**: Vitest (`npx vitest run`) with happy-dom for client hook tests. 962 tests across 39 test files.

## Testing

Run tests with: `npx vitest run`

Test files are organized under `tests/server/`, `tests/client/`, and `tests/` (root-level server tests):

**Server tests (`tests/server/`):**
- `geminiMessageHandler.test.ts` — goAway handling, sessionResumption, audio routing, barge-in suppression, inputTranscription accumulation, turnComplete lifecycle, modelTurn thinking-text detection, outputTranscription filtering
- `geminiReconnector.test.ts` — normal close cleanup, unexpected close reconnection, exponential backoff, session context restoration, max-attempts failure, client-disconnect cancellation
- `agentApi.test.ts` — Agent API endpoint coverage
- `agentApiKey.test.ts` — API key creation, hashing, validation
- `agentApiKeyMiddleware.test.ts` — Bearer auth middleware
- `agentApiStreaming.test.ts` — Streaming response handling
- `agentApiUsage.test.ts` — Usage tracking and daily aggregation
- `clientMessageHandler.test.ts` — Client WebSocket message handling
- `evaluateUserResponse.test.ts` — Simulation evaluation harness
- `evaluationCriteriaApproval.test.ts` — Evaluation criteria approval workflow
- `evaluationEngine.test.ts` — Scoring engine logic
- `evidenceScoreCap.test.ts` — Score capping rules
- `fileManagerXss.test.ts` — XSS prevention in file manager
- `forbiddenApiEndpoints.test.ts` — Auth enforcement on protected routes
- `gcsStorageFallback.test.ts` — GCS / object storage fallback behavior
- `geminiToolValidation.test.ts` — Gemini tool-call schema validation
- `htmlEscape.test.ts` — HTML escaping utility
- `imageGenerationXss.test.ts` — XSS prevention in image generation
- `incrementUsageDaily.test.ts` — Daily usage counter increment logic
- `memStorage.test.ts` — In-memory storage domain coverage
- `metricSnapshot.test.ts` — Metric snapshot computation
- `optimizedGeminiProvider.test.ts` — Gemini AI provider optimizations
- `realtimeVoiceService.test.ts` — Realtime voice service session lifecycle
- `scenarioValidator.test.ts` — Scenario data validation
- `simulationEngine.test.ts` — Core simulation engine logic
- `simulationRules.test.ts` — Simulation rule evaluation
- `simulationToolHandler.test.ts` — Simulation Gemini tool handler
- `textFilter.test.ts` — Thinking-tag text filter
- `benchmarkGroups.test.ts` — HR benchmark group logic

**Client tests (`tests/client/`):**
- `useAudioPlayback.test.ts` — Initial state, stopPlayback barge-in, playAudioDelta gating, PCM16 decoding math, AnalyserNode/GainNode lifecycle
- `useVoiceActivityDetection.test.ts` — RMS computation, barge-in trigger timing, expectedTurnSeq increment, WebSocket cancel message, double-trigger prevention, auto-reset on silence
- `useChatSession.test.ts` — Chat session hook state management
- `computeMessagePersonaLabels.test.ts` — Message persona label assignment
- `generatePrintableContent.test.ts` — Printable content generation
- `personaSwitchAvatar.test.ts` — Persona avatar switching logic
- `videoIntroSources.test.ts` — Intro video source resolution

Client test files use `// @vitest-environment happy-dom` per-file annotation; server tests run in Node environment. Setup file at `tests/setup.ts`.

## Real-time Voice Module Architecture

The real-time voice system supports both Gemini Live API (default) and OpenAI Realtime API (GPT-4o), selectable via system settings. It is split into focused sub-modules for maintainability. WebSocket endpoint: `/api/realtime-voice`.

### Server-side (`server/services/voice/`)
- `types.ts` — Shared TypeScript types and constants (VoiceSession, event types, timeouts)
- `textFilter.ts` — Utility to strip thinking-mode tags from streamed text
- `prompts/languageInstructions.ts` — Multilingual language instructions and prohibition strings
- `prompts/sectionText.ts` — Prompt section templates for scenario/persona context
- `prompts/userPersonaPrompt.ts` — System prompt builder for user-created personas (PersonaX free chat)
- `systemPromptBuilder.ts` — Assembles the full system instruction prompt from sub-modules
- `emotionAnalyzer.ts` — Standalone emotion analysis function using Gemini
- `openaiRealtimeAdapter.ts` — Handles all incoming OpenAI Realtime WebSocket events (audio routing, transcription, emotion analysis, barge-in)
- `openaiReconnector.ts` — Manages OpenAI session close and proactive reconnection logic (exponential backoff, fatal code detection)
- `clientMessageHandler.ts` — Handles all incoming client WebSocket messages
- `sessionManager.ts` — Session lifecycle helpers: cleanup scheduler, usage tracking, status reporting
- `geminiMessageHandler.ts` — Gemini Live message handler
- `geminiReconnector.ts` — Gemini Live session reconnection logic

**Orchestrator** (`server/services/`):
- `realtimeVoiceService.ts` — Slim orchestrator wiring all voice sub-modules; selects Gemini Live or OpenAI Realtime based on `model_realtime` system setting

### Client-side (`client/src/hooks/`)
- `useAudioPlayback.ts` — AudioContext management, PCM16 decoding, scheduling, analyser, amplitude tracking, AGC (Auto Gain Control) processing, stopPlayback, playAudioDelta
- `useVoiceActivityDetection.ts` — VAD ScriptProcessor setup, RMS-based barge-in detection, userAudioAmplitude state
- `useRealtimeVoice.ts` — Slim orchestrator using both sub-hooks for WebSocket state, reconnection, and recording

### AGC (Auto Gain Control)
Server-side configurable AGC parameters are stored in `system_settings` (category: `voice_audio`) and exposed at `/api/settings/voice-audio`: `agc_target_rms`, `agc_min_gain`, `agc_max_gain`, `agc_attack_coeff`, `agc_release_coeff`. Client-side applies these for dynamic audio level normalization.

## Simulation Engine Architecture

The NPC simulation engine is implemented in `server/services/simulation/` and drives scenario-aware NPC behavior.

### Core engine (`server/services/simulation/engine/`)
- `evaluateUserResponse.ts` — Per-turn evaluation harness (`EvaluationHarness`, `NpcBehaviorHarness`) scoring user communication and applying NPC behavior modifiers
- `inferStageTransition.ts` — Rule-based and `FlowGraph`-based stage transition logic (`intro → conflict → negotiation → escalation/resolution`)
- `triggerIncident.ts` — Heuristic incident candidate inference and probability evaluation; constructs fully typed `Incident` objects
- `index.ts` — Re-exports all engine functions

### Supporting modules (`server/services/simulation/`)
- `simulationEngine.ts` — `applySimulationPatch`, `FlowGraph` evaluation, incident cooldown checks
- `simulationRules.ts` — Emotion patch inference from evaluation results, NPC behavior harness modifiers
- `simulationTypes.ts` — Shared types (`SimulationState`, `ScenarioStage`, `Incident`, `TurnScore`)
- `simulationPrompt.ts` — Builds the simulation state block injected into AI prompts
- `harnessReader.ts` — Reads `EvaluationHarness` / `NpcBehaviorHarness` from scenario data
- `incidentTemplates.ts` — Renders incident messages per language

## Enterprise B2B Agent API

External integrations can interact with the system via API key authentication (no JWT required).

- **Authentication**: Bearer token API key, hashed and stored in `agent_api_keys`
- **Base URL**: `/api/v1/agent/`
- **Swagger UI**: `/api/v1/agent/docs`
- **OpenAPI spec**: `/api/v1/agent/openapi.json` (dynamic — sets `servers[0].url` from `AGENT_API_PUBLIC_URL` env var or inferred from request headers)
- **Admin key management**: `/api/admin/agent-keys` (JWT + admin/operator required), UI at `/system-admin`
- **Usage tracking**: Per-key daily aggregation in `agent_usage_daily`; alert thresholds in `agent_key_alerts`
- **Webhook system**: Outbound webhooks configured in `agent_webhooks`; delivery log in `agent_webhook_deliveries`
- **Idempotency**: `agent_idempotency_keys` table prevents duplicate operations
- **Audit log**: All agent API actions recorded in `audit_logs`
