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
    - **Real-time Voice**: Full-duplex voice conversation via OpenAI Realtime API (GPT-4o Realtime), WebSocket streaming, server-side VAD, Whisper transcription, Web Audio API playback.

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

## Data Storage
- **ORM**: Drizzle ORM (PostgreSQL dialect)
- **Database**: PostgreSQL (Neon serverless)
- **Schema**: `conversations`, `feedbacks`, `users`, `categories`, `system_settings`, `ai_usage_logs` tables.

## Features
- **4-Level Difficulty System**: Users select difficulty, influencing AI responses across all conversation modes.
- **Analytics and Reporting**: Comprehensive user conversation history analytics including scores, category breakdowns, growth tracking, and pattern recognition. Uses a ComOn Check research-based 5-point scoring system (converted to 0-100).
- **Real-time Emotion Analysis**: AI characters display emotions with visual indicators.
- **Role-Based Access Control**: `시스템관리자 (admin)`, `운영자 (operator)`, `일반유저 (user)` roles with distinct permissions for system admin, operator dashboard, and content management.
- **Category System**: Scenarios are organized by categories, with operators assigned to manage specific categories.
- **System Settings Management**: Configurable system parameters stored in `system_settings` table, including per-feature AI model selection (e.g., Gemini, OpenAI for conversation/feedback, Gemini Live for real-time voice).
- **AI Usage Tracking**: Logs AI API usage data (feature, model, token usage, cost) for cost analysis.
- **Configurable Difficulty Settings**: Difficulty levels are editable via the operator dashboard, allowing customization of name, description, response length, tone, pressure, feedback style, and constraints.
- **Intro Video Generation**: Integration with Gemini Veo 3.1 API for generating 8-second intro videos for scenarios, stored as WebM files.

# External Dependencies

## Third-party Services
- **Google Gemini API**: Gemini 2.5 Flash/Pro for AI conversation responses, feedback, strategy, scenario generation, and Gemini Veo 3.1 for intro video generation.
- **OpenAI Realtime API**: GPT-4o Realtime for real-time voice conversations.
- **ElevenLabs API**: Text-to-speech synthesis.
- **Neon Database**: Serverless PostgreSQL hosting.

## Key Libraries and Frameworks
- **React Ecosystem**: React 18, React Query, React Hook Form, Wouter.
- **UI Components**: Radix UI.
- **Database**: Drizzle ORM.
- **Validation**: Zod.
- **Development Tools**: Vite, TypeScript, Tailwind CSS.