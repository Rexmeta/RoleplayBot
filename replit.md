# Overview

This project is an AI-powered role-playing training system designed to enhance communication skills for new employees. It uses interactive conversations with AI personas across various workplace scenarios. Users engage in 10-turn dialogues, receiving real-time emotion analysis and detailed AI-generated feedback including scores, strengths, and areas for improvement. The system supports three conversation modes: text, text-to-speech (TTS), and real-time voice, utilizing advanced AI models for natural and immersive interactions. The business vision is to provide a scalable and effective tool for professional development, leveraging AI to offer personalized communication coaching.

## Difficulty System
- **4-Level Difficulty**: All scenarios use a unified 4-level difficulty system (1=매우 쉬움, 2=기본, 3=도전형, 4=고난도)
- **User-Selected Difficulty**: Users can select their preferred difficulty level when starting a conversation on the scenario detail page
- **Difficulty Storage**: Selected difficulty is stored in the conversation record (`conversations.difficulty` field)
- **AI Behavior**: AI responses adapt based on the user-selected difficulty level, overriding the scenario's default difficulty
- **Consistent Application**: Selected difficulty applies uniformly across all conversation modes (text/TTS/realtime voice)
- **MBTI Independence**: MBTI personas no longer store difficulty levels; they only define personality traits and communication styles

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend
- **Framework**: React with TypeScript (Vite)
- **UI**: Radix UI with shadcn/ui, Tailwind CSS
- **Routing**: Wouter
- **State Management**: TanStack React Query (aggressive caching)
- **Forms**: React Hook Form with Zod validation
- **Conversation Modes**:
    - **Text Input**: Standard text-based chat, optional Web Speech API for dictation.
    - **Text-to-Speech (TTS)**: User text input, AI voice response (ElevenLabs API), voice selection based on MBTI persona.
    - **Real-time Voice**: Full-duplex voice conversation via OpenAI Realtime API (GPT-4o Realtime), WebSocket streaming (PCM16, 24kHz), server-side VAD, Whisper transcription, Web Audio API playback.

## Backend
- **Runtime**: Node.js with Express.js
- **Language**: TypeScript (ES modules)
- **API Design**: RESTful for conversations and feedback, WebSocket for real-time voice.
- **Authentication**: JWT (JSON Web Tokens) for stateless authentication, Bearer token in `Authorization` header.
- **Authorization**: Resource ownership verification for all user data.
- **User Isolation**: All data queries filtered by authenticated user ID.

## Data Storage
- **ORM**: Drizzle ORM (PostgreSQL dialect)
- **Database**: PostgreSQL (Neon serverless)
- **Schema**: `conversations`, `feedbacks`, `users` tables with appropriate foreign keys for user and conversation linking.
- **Persistence**: All conversations and feedback are stored permanently.

## Analytics and Reporting
- **Comprehensive Analytics**: Aggregates all user conversation history to provide:
    - Overall performance (average score, grade).
    - Category breakdown of scores (e.g., clarity, empathy).
    - Growth tracking (time-series score history).
    - Pattern recognition (frequent strengths/improvements).
    - Progress trends (recent vs. older sessions).
- **Evaluation Framework**: ComOn Check research-based 5-point scoring system (1-5 scale), converted to 0-100.
- **Real-time Emotion Analysis**: AI characters display emotions (😊, 😢, 😠, 😲, 😐) with visual indicators and reasoning.

# External Dependencies

## Third-party Services
- **Google Gemini API**: Gemini 2.5 Flash/Pro for AI conversation responses and feedback generation.
- **OpenAI Realtime API**: GPT-4o Realtime for real-time voice conversations.
- **ElevenLabs API**: Text-to-speech synthesis.
- **Neon Database**: Serverless PostgreSQL hosting.

## Key Libraries and Frameworks
- **React Ecosystem**: React 18, React Query, React Hook Form, Wouter.
- **UI Components**: Radix UI.
- **Database**: Drizzle ORM.
- **Validation**: Zod.
- **Development Tools**: Vite, TypeScript, Tailwind CSS.

# Code Organization

## Common Components
- **AppHeader**: Reusable header component with title, subtitle, back button, and user profile menu
- **UserProfileMenu**: User profile dropdown with navigation and logout functionality

## Key Files
- `client/src/components/AppHeader.tsx`: Common header component used across all pages
- `client/src/components/UserProfileMenu.tsx`: User profile dropdown component
- `client/src/pages/home.tsx`: Main landing page with scenario selection
- `client/src/pages/MyPage.tsx`: User dashboard with conversation history and analytics tabs
- `client/src/pages/admin-dashboard.tsx`: Operator dashboard - analytics and performance monitoring
- `client/src/pages/admin-management.tsx`: Content management for scenarios and personas
- `client/src/pages/system-admin.tsx`: System admin page - user management (role/tier/status)

## Role-Based Access Control
- **시스템관리자 (admin)**: Full access to system admin page, operator dashboard, content management
- **운영자 (operator)**: Access to operator dashboard, content management
- **일반유저 (user)**: Standard user features only

## User Management (System Admin)
- Users table extended with `isActive` (account status) and `lastLoginAt` (last login time)
- API: GET `/api/system-admin/users` - List all users (admin only)
- API: PATCH `/api/system-admin/users/:id` - Update user role/tier/status (admin only)
- Tier system: bronze, silver, gold, platinum, diamond

## Category System
- **Categories Table**: `categories` - stores scenario categories (온보딩, 리더십, 경영지원, 기타)
- **Operator Assignment**: `users.assignedCategoryId` - links operators to their managed category
- **Scenario Categories**: `scenarios.categoryId` - each scenario belongs to one category
- **Permission Control**:
  - 시스템관리자 (admin): Can manage all categories and all scenarios
  - 운영자 (operator): Can only manage scenarios in their assigned category
- **API Endpoints**:
  - GET `/api/categories` - List all categories (public)
  - POST `/api/categories` - Create category (admin only)
  - PATCH `/api/categories/:id` - Update category (admin only)
  - DELETE `/api/categories/:id` - Delete category if no linked scenarios (admin only)
- **UI Features**:
  - System admin page: Category management tab with CRUD operations
  - Scenario list: Category filter dropdown + category badge on cards
  - Admin management: Operators see only their category's scenarios

## System Settings (System Admin)
- **Database Table**: `system_settings` - stores configurable system parameters
- **Simplified Settings**: Focus on AI model selection (gemini-2.5-flash / gemini-2.5-pro)
- **API Endpoints**:
  - GET `/api/system-admin/settings` - List all settings (admin only)
  - PUT `/api/system-admin/settings` - Create/update single setting (admin only)
  - GET `/api/system-admin/api-keys-status` - Check API key configuration status (admin only)
- **Dynamic Model Selection**:
  - Model setting stored in DB (`category=ai`, `key=model`)
  - AI service reads model from DB before each response generation
  - `syncModelFromSettings()` function updates singleton AI service with latest setting
- **API Key Status Display**:
  - Shows configuration status for Gemini, OpenAI, ElevenLabs keys
  - Only displays boolean status (설정됨/미설정), not actual values
  - Keys managed via Replit Secrets tab
- **UI**: System admin page → "시스템 설정" tab with AI model selector and API key status cards

## Recent Changes (December 2025)
- Added system settings management feature for configurable system parameters
- Added system admin page with user management functionality
- Extended users table with isActive and lastLoginAt fields
- Implemented role-based menu visibility in UserProfileMenu
- Renamed "관리자 대시보드" to "운영자 대시보드"
- Extracted AppHeader and UserProfileMenu as shared components to eliminate code duplication across 4 pages
- Removed unused legacy files: Header.tsx, StrategicPersonaSelector.tsx, FeedbackReport.tsx, scenarios.ts, authUtils.ts, dynamic-situation-manager.ts, sequence-analyzer.ts, assets folder
- Unified UI terminology: "MBTI 페르소나" → "페르소나"
- Standardized session display format: "완료한세션/전체세션"