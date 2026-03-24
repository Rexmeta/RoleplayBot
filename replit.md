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
- **Conversation Modes**: Text Input, Text-to-Speech (TTS) via ElevenLabs API, and Real-time Voice via Gemini Live API with full-duplex communication and barge-in support. Voice sessions include resilience features like auto-reconnect and context recovery.

## Backend
- **Runtime**: Node.js with Express.js
- **Language**: TypeScript (ES modules)
- **API Design**: RESTful for conversations and feedback, WebSocket for real-time voice.
- **Authentication**: JWT (JSON Web Tokens).
- **Authorization**: Resource ownership verification and role-based access control (admin, operator, user).
- **Security**: Robust measures including JWT_SECRET enforcement, CSRF protection, API key logging prevention, login rate limiting, strong password policies, and file upload authentication with path traversal prevention.

## Data Storage
- **ORM**: Drizzle ORM (PostgreSQL dialect).
- **Database**: PostgreSQL (Neon serverless) with schema for `conversations`, `feedbacks`, `users`, `categories`, `system_settings`, `ai_usage_logs`, and comprehensive multilingual scenario and persona data.
- **Data Persistence**: Scenarios and MBTI personas are stored in the PostgreSQL database.
- **Scenario Soft Delete**: Scenarios use soft deletion (`is_deleted` flag) to preserve historical data while blocking new interactions.

## Media Storage (Object Storage)
- **Architecture**: Database stores GCS keys; frontend utility `toMediaUrl()` converts keys to serving URLs. Backend endpoints serve files from storage.
- **Dual Deployment Support**: Supports both Replit Object Storage (development with optional dual-writing to GCS) and Google Cloud Storage (production).
- **Path Normalization**: Object paths are automatically normalized by stripping query strings and prefixes.

## Features
- **Comprehensive Persona Reflection**: AI conversations accurately reflect detailed persona definitions including MBTI traits, communication style, motivations, fears, and scenario-specific data.
- **4-Level Difficulty System**: Influences AI responses across all conversation modes.
- **Analytics and Reporting**: Comprehensive user conversation history analytics, including scores, category breakdowns, growth tracking, and pattern recognition, using a research-based 5-point scoring system.
- **Automatic Score Adjustments**: Feedback system applies score adjustments based on non-verbal expressions, barge-in analysis, and scenario context.
- **Real-time Emotion Analysis**: AI characters display emotions visually.
- **Role-Based Access Control**: `admin`, `operator`, `user` roles with distinct permissions.
- **Category System**: Scenarios organized by categories with operator assignments.
- **System Settings Management**: Configurable system parameters, including per-feature AI model selection.
- **AI Usage Tracking**: Logs AI API usage for cost analysis.
- **Configurable Difficulty Settings**: Editable difficulty levels via operator dashboard.
- **Intro Video Generation**: Integration with Gemini Veo 3.1 API for scenario intro videos.
- **Multilingual Translation System**: Comprehensive translation management with AI-powered translation generation, manual editing workflow, and support for multiple languages with a language-agnostic architecture.

# External Dependencies

## Third-party Services
- **Google Gemini API**: Gemini 2.5 Flash/Pro for AI conversations, feedback, strategy, scenario generation; Gemini Veo 3.1 for intro video generation.
- **Google Gemini Live API**: Real-time voice conversations.
- **ElevenLabs API**: Text-to-speech synthesis.
- **Neon Database**: Serverless PostgreSQL hosting.

## Key Libraries and Frameworks
- **React Ecosystem**: React 18, React Query, React Hook Form, Wouter.
- **UI Components**: Radix UI.
- **Database**: Drizzle ORM.
- **Validation**: Zod.
- **Development Tools**: Vite, TypeScript, Tailwind CSS.