# Overview

This is an AI-powered role-playing training system for new employees, designed to help develop communication skills through interactive conversations with AI personas. The application presents various workplace scenarios where users engage in 10-turn conversations with different AI characters (senior researchers, team leaders, clients, executives), each with distinct personalities and communication challenges. Each AI response includes real-time emotion analysis with visual indicators (emojis, color-coded bubbles). After completing conversations, users receive detailed AI-generated feedback with scores, strengths, improvements, and next steps.

**Recent Updates (2025-10-22)**:
- **SECURITY: User-scoped data isolation implemented** - All conversations and feedbacks are now filtered by authenticated user
- **AUTHENTICATION: Complete JWT token flow** - Frontend sends Authorization header with Bearer token for all API requests
- **DATABASE: User ID foreign key added** - conversations table now has user_id column referencing users table
- **AUTHORIZATION: Ownership verification** - All conversation endpoints verify user owns the resource before allowing access (403 Forbidden for unauthorized, 404 for not found)
- **BACKEND: User-specific storage methods** - getUserConversations() and getUserFeedbacks() filter by userId
- **MIDDLEWARE: Authentication enforcement** - isAuthenticated middleware applied to all conversation and feedback endpoints
- **FRONTEND: Token management** - queryClient and apiRequest forward localStorage authToken in Authorization header

**Recent Updates (2025-08-22)**:
- **LICENSE: CC BY-NC 4.0 라이센스 적용** - 상업적 사용을 제한하는 Creative Commons Attribution-NonCommercial 라이센스로 변경
- **DOCUMENTATION: 포괄적인 README.md 작성 완료** - GitHub용 프로젝트 설명서, 설치 가이드, 기술 스택, 사용법, 평가 시스템 상세 설명 포함
- **ENHANCED: 프로젝트 문서화 개선** - 개발자 가이드, 배포 방법, 문제 해결 섹션 추가 
- **VOICE INPUT SYSTEM: 완전한 중복 방지 시스템 구현** - speechStartTextRef와 accumulatedSpeechRef를 사용한 텍스트 누적 추적, Web Speech API의 중복 결과 처리 문제 해결
- **ENHANCED: 연속 음성 인식 최적화** - continuous: true, interimResults: true 설정으로 자연스러운 음성 입력, 중간 멈춤 허용
- **TECHNICAL: 음성 입력 상태 관리 개선** - 음성 입력 시작/종료 시점 정확한 텍스트 관리, 실시간 피드백과 최종 결과 분리
- **NAVIGATION FIX: 로고 링크 중복 문제 해결** - Home 페이지의 기존 헤더만 사용하도록 수정, ChatWindow와 PersonalDevelopmentReport에서 중복 Header 제거
- **CRITICAL FIX: React hooks 순서 오류 완전 해결** - PersonalDevelopmentReport의 조건부 hooks 호출 문제 근본적 해결, useEffect를 조건부 렌더링 이전에 호출하도록 변경, 애니메이션 hooks 완전 제거
- **MAJOR IMPROVEMENT: 김태훈 시나리오 완전 개편** - 스마트폰 개발 미션 "노이즈 문제, 이대로 출시해도 될까요?" 구현
- **ENHANCED: 현실적 비즈니스 시나리오** - 마이크 모듈 노이즈 문제, 양산 일정 제약, 선임 책임자 설득 미션 구성
- **TECHNICAL: 자동 초기 대화 생성** - 새 대화 생성 시 AI가 미션 상황에 맞는 첫 메시지 자동 생성
- **UI/UX: 애니메이션 안정성 향상** - useCountUpAnimation, useProgressAnimation hooks 안전성 강화
- **CONTENT: 평가 기준 업데이트** - 논리적 설명, 설득력, 조직 내 협상, 현실적 해결책 제시 능력 평가
- Successfully migrated from OpenAI/AIMLAPI to Google Gemini API for real-time AI conversation generation
- Gemini API fully operational for character-based conversations with natural, context-aware responses
- **RESOLVED: Complete feedback system working** with comprehensive evaluation reports (5 categories, detailed analysis)
- **IMPLEMENTED: Real-time emotion state system** - AI characters display emotions (기쁨😊, 슬픔😢, 분노😠, 놀람😲, 중립😐) for each conversation turn
- Emotion-based UI changes: color-coded message bubbles, avatar emotion indicators, and detailed emotion reasoning
- **IMPROVED: UI flow** - Removed automatic redirect after 10 turns, added manual "Final Feedback" button for user control
- Enhanced JSON parsing for Gemini API feedback generation with robust error handling
- Robust fallback system ensures 100% system reliability even during API issues
- **UPGRADED: Scientific evaluation framework** - Implemented ComOn Check research-based 5-point scoring system (1-5 scale)
- **IMPLEMENTED: Research-based assessment categories** - Message clarity, audience adaptation, emotional responsiveness, conversation structure, professional competence
- **ENHANCED: Quantitative scoring methodology** - Each category scored 1-5 points, overall score calculated as (sum/5)*20 for 0-100 scale
- **IMPLEMENTED: Advanced real-time scoring system** - Scientific 0-100 point scoring starting from 0, with ComOn Check methodology
- **IMPLEMENTED: Multi-factor real-time analysis** - Message structure (25%), empathy expression (20%), professional solutions (25%), communication appropriateness (20%), scenario adaptation (10%)
- **ENHANCED: Dynamic score visualization** - Color-coded progress bar with performance levels (미흡/개선 필요/보통/우수) and real-time feedback

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
- **Authentication Method**: JWT (JSON Web Tokens) with Bearer token in Authorization header
- **Token Storage**: localStorage for client-side token persistence
- **Session Management**: Stateless JWT-based authentication (no server-side sessions)
- **Authorization**: Resource ownership verification on all conversation and feedback endpoints
- **User Isolation**: All data queries filtered by authenticated user's ID
- **Security**: 401 Unauthorized for missing/invalid tokens, 403 Forbidden for unauthorized access

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