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
- **Conversation Modes**:
    - **Text Input**: Standard text-based chat.
    - **Text-to-Speech (TTS)**: User text input, AI voice response via ElevenLabs API, voice selection based on MBTI persona.
    - **Real-time Voice**: Full-duplex voice conversation via Gemini Live API, WebSocket streaming, server-side VAD, Web Audio API playback, barge-in support (turnSeq-based interruption handling).

## Backend
- **Runtime**: Node.js with Express.js
- **Language**: TypeScript (ES modules)
- **API Design**: RESTful for conversations and feedback, WebSocket for real-time voice.
- **Authentication**: JWT (JSON Web Tokens) - JWT_SECRET 환경 변수 필수.
- **Authorization**: Resource ownership verification and role-based access control (admin, operator, user).
- **User Isolation**: All data queries filtered by authenticated user ID.
- **Security**: 
  - JWT_SECRET 필수 (미설정시 서버 시작 차단)
  - Cookie sameSite=strict로 CSRF 방지
  - API 키 로깅 금지
  - 로그인 Rate Limiting (5분 내 5회 실패 시 차단)
  - 비밀번호 복잡성 정책 (8자+대문자+소문자+숫자+특수문자)
  - 업로드 파일 인증 필수 + Path Traversal 방지
  - API 응답 로그에서 민감정보 자동 제거

## Data Storage
- **ORM**: Drizzle ORM (PostgreSQL dialect)
- **Database**: PostgreSQL (Neon serverless)
- **Schema**: `conversations`, `feedbacks`, `users`, `categories`, `system_settings`, `ai_usage_logs`, `supported_languages`, `scenario_translations`, `persona_translations`, `scenarios`, `mbti_personas` tables.
- **Data Persistence**: Scenarios and MBTI personas are stored in the PostgreSQL database to persist across Replit deployments. FileManagerService uses database as primary source with JSON file fallback.

## Media Storage (Object Storage)

### Media URL Architecture
- **DB stores GCS keys**: `scenarios/...webp`, `videos/...webm`, `personas/...webp`
- **Frontend utility**: `toMediaUrl()` in `client/src/lib/mediaUrl.ts` converts keys to serving URLs
  - Normal keys → `/objects?key=<encoded key>`
  - Absolute URLs → passed through
  - Legacy UUIDs → `/api/objects/resolve?id=<uuid>` (302 redirect or 404)
- **Backend endpoints**:
  - `GET /objects?key=<key>` → serves file from GCS (Cloud Run) or Replit Object Storage
  - `GET /objects/*` → path-based serving (Cloud Run only, legacy compatibility)
  - `GET /api/objects/resolve?id=<uuid>` → resolves legacy UUIDs by searching scenario data

### Dual Deployment Support
The system supports two completely separate storage backends:

#### Replit Environment (development)
- **Provider**: Replit Object Storage (via sidecar at 127.0.0.1:1106)
- **Serving**: `GET /objects?key=<key>` searches public object paths
- **Detection**: `REPL_ID` environment variable present

#### Cloud Run Environment (production)
- **Provider**: Google Cloud Storage (GCS)
- **Serving**: `GET /objects?key=<key>` streams from GCS bucket
- **Detection**: `K_SERVICE` or `K_REVISION` environment variable present
- **Required Env Vars**:
  - `GCS_BUCKET_NAME`: Your GCS bucket name (e.g., `roleplay-bucket`)
- **IMPORTANT**: Remove Replit-specific env vars from Cloud Run:
  - `PRIVATE_OBJECT_DIR` - causes Replit fallback attempts
  - `PUBLIC_OBJECT_SEARCH_PATHS` - not needed
  
#### Cloud Run Setup Commands
```bash
# Set GCS bucket and remove Replit env vars
gcloud run services update SERVICE_NAME \
  --region REGION \
  --update-env-vars GCS_BUCKET_NAME=your-bucket \
  --clear-env-vars PRIVATE_OBJECT_DIR,PUBLIC_OBJECT_SEARCH_PATHS

# Grant storage permissions to runtime service account
gcloud storage buckets add-iam-policy-binding gs://your-bucket \
  --member=serviceAccount:runtime-sa@PROJECT.iam.gserviceaccount.com \
  --role=roles/storage.objectAdmin
```

### Path Normalization
Object paths are automatically normalized:
- Query strings (`?t=timestamp`) are stripped before GCS lookup
- Signed URLs have bucket name stripped for proper key extraction
- `/objects/` prefix removed before GCS lookup

### Services
- `client/src/lib/mediaUrl.ts`: Frontend URL converter (toMediaUrl)
- `server/services/gcsStorage.ts`: GCS operations, signed URLs, streamFromGCS
- `server/services/mediaStorage.ts`: High-level media upload service (auto-selects backend)
- `server/replit_integrations/object_storage/routes.ts`: /objects?key=, /objects/*, /api/objects/resolve

## Features
- **Comprehensive Persona Reflection**: AI conversations fully reflect persona definitions including:
  - MBTI personality traits, communication style, motivation, fears
  - Characteristic phrases (key_phrases) and argument response patterns (response_to_arguments)
  - Personal values from background data
  - Scenario-specific data: stance, goal, tradeoff (negotiation limits), experience, department
- **4-Level Difficulty System**: Users select difficulty, influencing AI responses across all conversation modes.
- **Analytics and Reporting**: Comprehensive user conversation history analytics including scores, category breakdowns, growth tracking, and pattern recognition. Uses a ComOn Check research-based 5-point scoring system (converted to 0-100).
- **Automatic Score Adjustments**: The feedback system applies automatic score adjustments based on:
  - **Non-verbal expression penalty**: Short responses (<3 chars: -2pts), silence ("...": -3pts), hesitation sounds ("음...", "uh": -2pts), skips (-5pts). Max penalty: -20pts.
  - **Barge-in analysis**: Interrupting AI while asking a question = -3pts (poor listening). Interrupting with substantial response (>30 chars) = +2pts (active participation). Net adjustment range: -15 to +10pts.
- **Real-time Emotion Analysis**: AI characters display emotions with visual indicators.
- **Role-Based Access Control**: `시스템관리자 (admin)`, `운영자 (operator)`, `일반유저 (user)` roles with distinct permissions for system admin, operator dashboard, and content management.
- **Category System**: Scenarios are organized by categories, with operators assigned to manage specific categories.
- **System Settings Management**: Configurable system parameters stored in `system_settings` table, including per-feature AI model selection (e.g., Gemini, OpenAI for conversation/feedback, Gemini Live for real-time voice).
- **AI Usage Tracking**: Logs AI API usage data (feature, model, token usage, cost) for cost analysis.
- **Configurable Difficulty Settings**: Difficulty levels are editable via the operator dashboard, allowing customization of name, description, response length, tone, pressure, feedback style, and constraints.
- **Intro Video Generation**: Integration with Gemini Veo 3.1 API for generating 8-second intro videos for scenarios, stored as WebM files.
- **Multilingual Translation System**: Comprehensive translation management with AI-powered translation generation (Gemini 2.5 Flash), manual editing/review workflow, batch translation tools, and translation status dashboard. Supports Korean, English, Japanese, and Chinese with extensible language database.
  - **Language-Agnostic Architecture**: Scenarios can be written in ANY language (not just Korean). The system uses:
    - `scenarios.sourceLocale`: Tracks the original writing language of each scenario
    - `scenario_translations.isOriginal`: Marks which translation is the original content
    - **Original content is stored in both `scenarios` table AND `scenario_translations` with `isOriginal=true`**
  - **Translation Data Architecture**:
    - **Master Persona Translations** (`personaTranslations`): MBTI type identity only (name, personalityTraits, communicationStyle, motivation, fears, background info). Reusable across all scenarios.
    - **Scenario Context Translations** (`scenarioTranslations.personaContexts`): Scenario-specific persona details (position, department, role, stance, goal, tradeoff). Each persona can have different context in different scenarios.
  - **Edit Mode vs Display Mode**:
    - **Edit mode** (`?mode=edit`): Always returns original content regardless of language setting
    - **Display mode** (`?lang=xx`): Returns translated content with fallback to original

# External Dependencies

## Third-party Services
- **Google Gemini API**: Gemini 2.5 Flash/Pro for AI conversation responses, feedback, strategy, scenario generation, and Gemini Veo 3.1 for intro video generation.
- **Google Gemini Live API**: Real-time voice conversations with barge-in support.
- **ElevenLabs API**: Text-to-speech synthesis.
- **Neon Database**: Serverless PostgreSQL hosting.

## Key Libraries and Frameworks
- **React Ecosystem**: React 18, React Query, React Hook Form, Wouter.
- **UI Components**: Radix UI.
- **Database**: Drizzle ORM.
- **Validation**: Zod.
- **Development Tools**: Vite, TypeScript, Tailwind CSS.

# Maintenance Scripts

## Persona Image Sync
When persona expression images exist in the file system (`attached_assets/personas/{personaId}/{gender}/*.webp`) but are missing from the database `images` JSONB column, run:
```bash
npx tsx server/scripts/syncPersonaImages.ts
```
This script:
- Scans `attached_assets/personas/` for webp image files
- Maps English filenames (angry, anxious, neutral, etc.) to Korean emotion names (분노, 불안, 중립, etc.)
- Updates the `mbti_personas.images` JSONB column with proper URLs
- Skips personas that already have valid image data in the database