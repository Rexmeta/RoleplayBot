# Overview

This is an AI-powered role-playing training system for new employees, designed to help develop communication skills through interactive conversations with AI personas. The application presents various workplace scenarios where users engage in 10-turn conversations with different AI characters (senior researchers, team leaders, clients, executives), each with distinct personalities and communication challenges. After completing conversations, users receive detailed AI-generated feedback with scores, strengths, improvements, and next steps.

**Recent Update (2025-08-19)**: Successfully migrated from OpenAI/AIMLAPI to Google Gemini API for more reliable and cost-effective AI responses.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React with TypeScript using Vite as the build tool
- **UI Library**: Radix UI components with shadcn/ui design system
- **Styling**: Tailwind CSS with custom CSS variables for theming
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack React Query for server state management
- **Forms**: React Hook Form with Zod validation

## Backend Architecture
- **Runtime**: Node.js with Express.js server
- **Language**: TypeScript with ES modules
- **API Design**: RESTful endpoints for conversations and feedback
- **Development**: Development server with hot module replacement via Vite middleware
- **Production**: Built server bundle with static file serving

## Data Storage Solutions
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Database**: PostgreSQL (configured via Drizzle but using Neon serverless driver)
- **Schema**: Conversations table storing messages as JSON, feedbacks table with evaluation scores
- **Development Storage**: In-memory storage implementation for development/testing
- **Migrations**: Drizzle Kit for database schema management

## Authentication and Authorization
- **Session Management**: PostgreSQL session store using connect-pg-simple
- **Current Implementation**: Basic setup without full authentication flow implemented

## External Dependencies

### Third-party Services
- **Google Gemini API**: Gemini 2.5 Flash/Pro models for AI conversation responses and feedback generation
- **Neon Database**: Serverless PostgreSQL hosting
- **Replit Integration**: Development environment integration with cartographer and runtime error handling

### Key Libraries and Frameworks
- **React Ecosystem**: React 18, React Query, React Hook Form, React Router (Wouter)
- **UI Components**: Comprehensive Radix UI primitive collection
- **Database**: Drizzle ORM, Neon serverless driver, PostgreSQL session store
- **Validation**: Zod for schema validation and type safety
- **Development Tools**: Vite, TypeScript, Tailwind CSS, ESBuild for production builds
- **Utilities**: date-fns for date manipulation, class-variance-authority for component variants

### API Structure
- `POST /api/conversations` - Create new conversation
- `GET /api/conversations/:id` - Retrieve conversation
- `POST /api/conversations/:id/messages` - Send message and get AI response
- `POST /api/conversations/:id/feedback` - Generate feedback for completed conversation
- `GET /api/conversations/:id/feedback` - Retrieve existing feedback

The system uses a shared schema between client and server, ensuring type safety across the full stack. The application supports multiple predefined scenarios with different AI personas, each designed to test specific communication skills like empathy, negotiation, and presentation abilities.