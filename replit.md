# Overview

This project is an AI-powered role-playing training system designed to enhance communication skills for new employees. It uses interactive conversations with AI personas across various workplace scenarios. Users engage in 10-turn dialogues, receiving real-time emotion analysis and detailed AI-generated feedback including scores, strengths, and areas for improvement. The system supports three conversation modes: text, text-to-speech (TTS), and real-time voice, utilizing advanced AI models for natural and immersive interactions. The business vision is to provide a scalable and effective tool for professional development, leveraging AI to offer personalized communication coaching.

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