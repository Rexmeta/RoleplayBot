import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

const migrationSQL = `
-- 1. Users 테이블
CREATE TABLE IF NOT EXISTS "users" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" varchar NOT NULL,
  "password" varchar NOT NULL,
  "name" varchar NOT NULL,
  "role" varchar DEFAULT 'user' NOT NULL,
  "profile_image" varchar,
  "tier" varchar DEFAULT 'bronze' NOT NULL,
  "preferred_language" varchar DEFAULT 'ko' NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "last_login_at" timestamp,
  "company_id" varchar,
  "organization_id" varchar,
  "assigned_company_id" varchar,
  "assigned_organization_id" varchar,
  "assigned_category_id" varchar,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "users_email_unique" UNIQUE("email")
);

-- 기존 users 테이블에 preferred_language 컬럼이 없으면 추가
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'preferred_language'
  ) THEN
    ALTER TABLE "users" ADD COLUMN "preferred_language" varchar DEFAULT 'ko' NOT NULL;
  END IF;
END $$;

-- 2. Categories
CREATE TABLE IF NOT EXISTS "categories" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar NOT NULL,
  "description" text,
  "order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "categories_name_unique" UNIQUE("name")
);

-- 3. Sessions
CREATE TABLE IF NOT EXISTS "sessions" (
  "sid" varchar PRIMARY KEY NOT NULL,
  "sess" jsonb NOT NULL,
  "expire" timestamp NOT NULL
);

-- 4. System Settings
CREATE TABLE IF NOT EXISTS "system_settings" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "category" varchar NOT NULL,
  "key" varchar NOT NULL,
  "value" text NOT NULL,
  "description" text,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_by" varchar
);

-- 5. Conversations
CREATE TABLE IF NOT EXISTS "conversations" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" varchar,
  "scenario_id" text NOT NULL,
  "persona_id" text,
  "persona_snapshot" jsonb,
  "scenario_name" text NOT NULL,
  "messages" jsonb NOT NULL,
  "turn_count" integer DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "completed_at" timestamp,
  "conversation_type" text DEFAULT 'single' NOT NULL,
  "current_phase" integer DEFAULT 1,
  "total_phases" integer DEFAULT 1,
  "persona_selections" jsonb,
  "strategy_choices" jsonb,
  "sequence_analysis" jsonb,
  "strategy_reflection" text,
  "conversation_order" jsonb,
  "mode" text DEFAULT 'text' NOT NULL,
  "difficulty" integer DEFAULT 2 NOT NULL
);

-- 6. Scenario Runs
CREATE TABLE IF NOT EXISTS "scenario_runs" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" varchar NOT NULL,
  "scenario_id" text NOT NULL,
  "scenario_name" text NOT NULL,
  "attempt_number" integer NOT NULL,
  "status" text DEFAULT 'in_progress' NOT NULL,
  "total_score" integer,
  "difficulty" integer DEFAULT 2 NOT NULL,
  "mode" text DEFAULT 'text' NOT NULL,
  "conversation_order" jsonb,
  "persona_selections" jsonb,
  "strategy_choices" jsonb,
  "sequence_analysis" jsonb,
  "strategy_reflection" text,
  "started_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "completed_at" timestamp
);

-- 7. Persona Runs
CREATE TABLE IF NOT EXISTS "persona_runs" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scenario_run_id" varchar NOT NULL,
  "conversation_id" varchar,
  "persona_id" text NOT NULL,
  "persona_name" text,
  "persona_snapshot" jsonb,
  "mbti_type" text,
  "phase" integer,
  "status" text DEFAULT 'active' NOT NULL,
  "turn_count" integer DEFAULT 0 NOT NULL,
  "score" integer,
  "mode" text DEFAULT 'text' NOT NULL,
  "difficulty" integer DEFAULT 2 NOT NULL,
  "started_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "actual_started_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "completed_at" timestamp
);

-- 8. Feedbacks
CREATE TABLE IF NOT EXISTS "feedbacks" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "conversation_id" varchar,
  "persona_run_id" varchar,
  "overall_score" integer NOT NULL,
  "scores" jsonb NOT NULL,
  "detailed_feedback" jsonb NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 9. Chat Messages
CREATE TABLE IF NOT EXISTS "chat_messages" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "persona_run_id" varchar NOT NULL,
  "turn_index" integer NOT NULL,
  "sender" text NOT NULL,
  "message" text NOT NULL,
  "emotion" text,
  "emotion_reason" text,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 10. AI Usage Logs
CREATE TABLE IF NOT EXISTS "ai_usage_logs" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "occurred_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "feature" varchar NOT NULL,
  "model" varchar NOT NULL,
  "provider" varchar NOT NULL,
  "user_id" varchar,
  "conversation_id" varchar,
  "request_id" varchar,
  "prompt_tokens" integer DEFAULT 0 NOT NULL,
  "completion_tokens" integer DEFAULT 0 NOT NULL,
  "total_tokens" integer DEFAULT 0 NOT NULL,
  "input_cost_usd" double precision DEFAULT 0 NOT NULL,
  "output_cost_usd" double precision DEFAULT 0 NOT NULL,
  "total_cost_usd" double precision DEFAULT 0 NOT NULL,
  "duration_ms" integer,
  "metadata" jsonb
);

-- 11. Evaluation Criteria Sets (평가 기준 세트)
CREATE TABLE IF NOT EXISTS "evaluation_criteria_sets" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar NOT NULL,
  "description" text,
  "is_default" boolean DEFAULT false NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "category_id" varchar,
  "created_by" varchar,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 12. Evaluation Dimensions (평가 지표)
CREATE TABLE IF NOT EXISTS "evaluation_dimensions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "criteria_set_id" varchar NOT NULL,
  "key" varchar NOT NULL,
  "name" varchar NOT NULL,
  "description" text,
  "icon" varchar DEFAULT '📊' NOT NULL,
  "color" varchar DEFAULT 'blue' NOT NULL,
  "weight" double precision DEFAULT 1.0 NOT NULL,
  "min_score" integer DEFAULT 1 NOT NULL,
  "max_score" integer DEFAULT 5 NOT NULL,
  "scoring_rubric" jsonb,
  "display_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 13. Companies (회사 - 3단 계층 구조 최상위)
CREATE TABLE IF NOT EXISTS "companies" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar NOT NULL,
  "description" text,
  "logo" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "companies_name_unique" UNIQUE("name")
);

-- 14. Organizations (조직 - 회사 하위)
CREATE TABLE IF NOT EXISTS "organizations" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" varchar NOT NULL,
  "name" varchar NOT NULL,
  "description" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 15. Operator Assignments (운영자 권한 할당 - 복합 할당)
CREATE TABLE IF NOT EXISTS "operator_assignments" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" varchar NOT NULL,
  "company_id" varchar,
  "organization_id" varchar,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 16. Scenarios (시나리오)
CREATE TABLE IF NOT EXISTS "scenarios" (
  "id" varchar PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "source_locale" varchar(10) DEFAULT 'ko' NOT NULL,
  "difficulty" integer DEFAULT 4 NOT NULL,
  "estimated_time" text,
  "skills" text[],
  "category_id" varchar,
  "image" text,
  "image_prompt" text,
  "intro_video_url" text,
  "video_prompt" text,
  "objective_type" text,
  "context" jsonb,
  "objectives" text[],
  "success_criteria" jsonb,
  "personas" jsonb,
  "recommended_flow" text[],
  "evaluation_criteria_set_id" varchar,
  "is_demo" boolean DEFAULT false NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "deleted_at" timestamp,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 17. MBTI Personas (MBTI 페르소나)
CREATE TABLE IF NOT EXISTS "mbti_personas" (
  "id" varchar PRIMARY KEY NOT NULL,
  "mbti" varchar NOT NULL,
  "gender" varchar,
  "personality_traits" text[],
  "communication_style" text,
  "motivation" text,
  "fears" text[],
  "background" jsonb,
  "communication_patterns" jsonb,
  "voice" jsonb,
  "images" jsonb,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 18. Supported Languages (지원 언어)
CREATE TABLE IF NOT EXISTS "supported_languages" (
  "code" varchar(10) PRIMARY KEY NOT NULL,
  "name" varchar NOT NULL,
  "native_name" varchar NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 19. Scenario Translations (시나리오 번역)
CREATE TABLE IF NOT EXISTS "scenario_translations" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scenario_id" text NOT NULL,
  "source_locale" varchar(10) DEFAULT 'ko' NOT NULL,
  "locale" varchar(10) NOT NULL,
  "is_original" boolean DEFAULT false NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "situation" text,
  "timeline" text,
  "stakes" text,
  "player_role" text,
  "objectives" text[],
  "success_criteria_optimal" text,
  "success_criteria_good" text,
  "success_criteria_acceptable" text,
  "success_criteria_failure" text,
  "skills" text[],
  "persona_contexts" jsonb,
  "is_machine_translated" boolean DEFAULT false NOT NULL,
  "is_reviewed" boolean DEFAULT false NOT NULL,
  "reviewed_by" varchar,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 20. Persona Translations (페르소나 번역)
CREATE TABLE IF NOT EXISTS "persona_translations" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "persona_id" text NOT NULL,
  "source_locale" varchar(10) DEFAULT 'ko' NOT NULL,
  "locale" varchar(10) NOT NULL,
  "name" varchar NOT NULL,
  "personality_traits" text[],
  "communication_style" text,
  "motivation" text,
  "fears" text[],
  "personality_description" text,
  "education" text,
  "previous_experience" text,
  "major_projects" text[],
  "expertise" text[],
  "background" text,
  "is_machine_translated" boolean DEFAULT false NOT NULL,
  "is_reviewed" boolean DEFAULT false NOT NULL,
  "reviewed_by" varchar,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 21. Category Translations (카테고리 번역)
CREATE TABLE IF NOT EXISTS "category_translations" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "category_id" varchar NOT NULL,
  "source_locale" varchar(10) DEFAULT 'ko' NOT NULL,
  "locale" varchar(10) NOT NULL,
  "name" varchar NOT NULL,
  "description" text,
  "is_machine_translated" boolean DEFAULT false NOT NULL,
  "is_reviewed" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 22. Evaluation Criteria Set Translations (평가 기준 세트 번역)
CREATE TABLE IF NOT EXISTS "evaluation_criteria_set_translations" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "criteria_set_id" varchar NOT NULL,
  "source_locale" varchar(10) DEFAULT 'ko' NOT NULL,
  "locale" varchar(10) NOT NULL,
  "is_original" boolean DEFAULT false NOT NULL,
  "name" varchar NOT NULL,
  "description" text,
  "is_machine_translated" boolean DEFAULT false NOT NULL,
  "is_reviewed" boolean DEFAULT false NOT NULL,
  "reviewed_by" varchar,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 23. Evaluation Dimension Translations (평가 차원 번역)
CREATE TABLE IF NOT EXISTS "evaluation_dimension_translations" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "dimension_id" varchar NOT NULL,
  "source_locale" varchar(10) DEFAULT 'ko' NOT NULL,
  "locale" varchar(10) NOT NULL,
  "is_original" boolean DEFAULT false NOT NULL,
  "name" varchar NOT NULL,
  "description" text,
  "scoring_rubric" jsonb,
  "is_machine_translated" boolean DEFAULT false NOT NULL,
  "is_reviewed" boolean DEFAULT false NOT NULL,
  "reviewed_by" varchar,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Categories 테이블에 organization_id, is_active, updated_at 컬럼 추가 (마이그레이션)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'categories' AND column_name = 'organization_id'
  ) THEN
    ALTER TABLE "categories" ADD COLUMN "organization_id" varchar;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'categories' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE "categories" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'categories' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE "categories" ADD COLUMN "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL;
  END IF;
END $$;

-- Users 테이블에 company_id, organization_id 컬럼 추가 (마이그레이션)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE "users" ADD COLUMN "company_id" varchar;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'organization_id'
  ) THEN
    ALTER TABLE "users" ADD COLUMN "organization_id" varchar;
  END IF;
END $$;

-- categories_name_unique 제약 조건 삭제 (같은 이름이 다른 조직에 있을 수 있음)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'categories_name_unique'
  ) THEN
    ALTER TABLE "categories" DROP CONSTRAINT "categories_name_unique";
  END IF;
END $$;

-- Companies 테이블에 code 컬럼 추가 (마이그레이션)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'code'
  ) THEN
    ALTER TABLE "companies" ADD COLUMN "code" varchar(50);
    ALTER TABLE "companies" ADD CONSTRAINT "companies_code_unique" UNIQUE ("code");
  END IF;
END $$;

-- Organizations 테이블에 code 컬럼 추가 (마이그레이션)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'organizations' AND column_name = 'code'
  ) THEN
    ALTER TABLE "organizations" ADD COLUMN "code" varchar(50);
  END IF;
END $$;

-- Users 테이블에 assigned_company_id, assigned_organization_id 컬럼 추가 (마이그레이션)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'assigned_company_id'
  ) THEN
    ALTER TABLE "users" ADD COLUMN "assigned_company_id" varchar;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'assigned_organization_id'
  ) THEN
    ALTER TABLE "users" ADD COLUMN "assigned_organization_id" varchar;
  END IF;
END $$;

-- Chat Messages 테이블에 interrupted 컬럼 추가 (마이그레이션)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'chat_messages' AND column_name = 'interrupted'
  ) THEN
    ALTER TABLE "chat_messages" ADD COLUMN "interrupted" boolean DEFAULT false;
  END IF;
END $$;

-- Evaluation Dimensions 테이블에 dimension_type 컬럼 추가 (마이그레이션)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'evaluation_dimensions' AND column_name = 'dimension_type'
  ) THEN
    ALTER TABLE "evaluation_dimensions" ADD COLUMN "dimension_type" varchar DEFAULT 'standard' NOT NULL;
  END IF;
END $$;

-- 사용자 북마크 테이블 생성 (즐겨찾기)
CREATE TABLE IF NOT EXISTS "user_bookmarks" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" varchar NOT NULL,
  "scenario_id" text NOT NULL,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "user_bookmarks_user_scenario_unique" UNIQUE("user_id", "scenario_id")
);
`;

const foreignKeysSQL = `
-- Foreign Keys (IF NOT EXISTS 불가능하므로 DO $$ BLOCK 사용)
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_assigned_category_id_categories_id_fk" 
    FOREIGN KEY ("assigned_category_id") REFERENCES "public"."categories"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" 
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "scenario_runs" ADD CONSTRAINT "scenario_runs_user_id_users_id_fk" 
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "persona_runs" ADD CONSTRAINT "persona_runs_scenario_run_id_scenario_runs_id_fk" 
    FOREIGN KEY ("scenario_run_id") REFERENCES "public"."scenario_runs"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "persona_runs" ADD CONSTRAINT "persona_runs_conversation_id_conversations_id_fk" 
    FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_conversation_id_conversations_id_fk" 
    FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_persona_run_id_persona_runs_id_fk" 
    FOREIGN KEY ("persona_run_id") REFERENCES "public"."persona_runs"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_persona_run_id_persona_runs_id_fk" 
    FOREIGN KEY ("persona_run_id") REFERENCES "public"."persona_runs"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_user_id_users_id_fk" 
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_users_id_fk" 
    FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "evaluation_criteria_sets" ADD CONSTRAINT "evaluation_criteria_sets_category_id_fk" 
    FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "evaluation_criteria_sets" ADD CONSTRAINT "evaluation_criteria_sets_created_by_fk" 
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "evaluation_dimensions" ADD CONSTRAINT "evaluation_dimensions_criteria_set_id_fk" 
    FOREIGN KEY ("criteria_set_id") REFERENCES "public"."evaluation_criteria_sets"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Organizations FK to Companies
DO $$ BEGIN
  ALTER TABLE "organizations" ADD CONSTRAINT "organizations_company_id_companies_id_fk" 
    FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Categories FK to Organizations
DO $$ BEGIN
  ALTER TABLE "categories" ADD CONSTRAINT "categories_organization_id_organizations_id_fk" 
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Users FK to Companies
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk" 
    FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Users FK to Organizations
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" 
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Operator Assignments FK to Users
DO $$ BEGIN
  ALTER TABLE "operator_assignments" ADD CONSTRAINT "operator_assignments_user_id_users_id_fk" 
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Operator Assignments FK to Companies
DO $$ BEGIN
  ALTER TABLE "operator_assignments" ADD CONSTRAINT "operator_assignments_company_id_companies_id_fk" 
    FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Operator Assignments FK to Organizations
DO $$ BEGIN
  ALTER TABLE "operator_assignments" ADD CONSTRAINT "operator_assignments_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Users FK to Companies (assigned_company_id)
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_assigned_company_id_companies_id_fk"
    FOREIGN KEY ("assigned_company_id") REFERENCES "public"."companies"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Users FK to Organizations (assigned_organization_id)
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_assigned_organization_id_organizations_id_fk"
    FOREIGN KEY ("assigned_organization_id") REFERENCES "public"."organizations"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Scenarios FK to Categories
DO $$ BEGIN
  ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_category_id_categories_id_fk"
    FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- User Bookmarks FK to Users
DO $$ BEGIN
  ALTER TABLE "user_bookmarks" ADD CONSTRAINT "user_bookmarks_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- User Bookmarks unique constraint (user_id, scenario_id)
DO $$ BEGIN
  ALTER TABLE "user_bookmarks" ADD CONSTRAINT "user_bookmarks_user_scenario_unique"
    UNIQUE ("user_id", "scenario_id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Scenario Translations FK
DO $$ BEGIN
  ALTER TABLE "scenario_translations" ADD CONSTRAINT "scenario_translations_source_locale_fk"
    FOREIGN KEY ("source_locale") REFERENCES "public"."supported_languages"("code");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "scenario_translations" ADD CONSTRAINT "scenario_translations_locale_fk"
    FOREIGN KEY ("locale") REFERENCES "public"."supported_languages"("code");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Persona Translations FK
DO $$ BEGIN
  ALTER TABLE "persona_translations" ADD CONSTRAINT "persona_translations_source_locale_fk"
    FOREIGN KEY ("source_locale") REFERENCES "public"."supported_languages"("code");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "persona_translations" ADD CONSTRAINT "persona_translations_locale_fk"
    FOREIGN KEY ("locale") REFERENCES "public"."supported_languages"("code");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Category Translations FK
DO $$ BEGIN
  ALTER TABLE "category_translations" ADD CONSTRAINT "category_translations_category_id_fk"
    FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "category_translations" ADD CONSTRAINT "category_translations_source_locale_fk"
    FOREIGN KEY ("source_locale") REFERENCES "public"."supported_languages"("code");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "category_translations" ADD CONSTRAINT "category_translations_locale_fk"
    FOREIGN KEY ("locale") REFERENCES "public"."supported_languages"("code");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Evaluation Criteria Set Translations FK
DO $$ BEGIN
  ALTER TABLE "evaluation_criteria_set_translations" ADD CONSTRAINT "eval_criteria_set_translations_set_id_fk"
    FOREIGN KEY ("criteria_set_id") REFERENCES "public"."evaluation_criteria_sets"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Evaluation Dimension Translations FK
DO $$ BEGIN
  ALTER TABLE "evaluation_dimension_translations" ADD CONSTRAINT "eval_dimension_translations_dimension_id_fk"
    FOREIGN KEY ("dimension_id") REFERENCES "public"."evaluation_dimensions"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Evaluation Criteria Set Translations locale FKs
DO $$ BEGIN
  ALTER TABLE "evaluation_criteria_set_translations" ADD CONSTRAINT "eval_criteria_set_translations_source_locale_fk"
    FOREIGN KEY ("source_locale") REFERENCES "public"."supported_languages"("code");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "evaluation_criteria_set_translations" ADD CONSTRAINT "eval_criteria_set_translations_locale_fk"
    FOREIGN KEY ("locale") REFERENCES "public"."supported_languages"("code");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Evaluation Dimension Translations locale FKs
DO $$ BEGIN
  ALTER TABLE "evaluation_dimension_translations" ADD CONSTRAINT "eval_dimension_translations_source_locale_fk"
    FOREIGN KEY ("source_locale") REFERENCES "public"."supported_languages"("code");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "evaluation_dimension_translations" ADD CONSTRAINT "eval_dimension_translations_locale_fk"
    FOREIGN KEY ("locale") REFERENCES "public"."supported_languages"("code");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Scenario Translations reviewed_by FK
DO $$ BEGIN
  ALTER TABLE "scenario_translations" ADD CONSTRAINT "scenario_translations_reviewed_by_fk"
    FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Persona Translations reviewed_by FK
DO $$ BEGIN
  ALTER TABLE "persona_translations" ADD CONSTRAINT "persona_translations_reviewed_by_fk"
    FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Evaluation Criteria Set Translations reviewed_by FK
DO $$ BEGIN
  ALTER TABLE "evaluation_criteria_set_translations" ADD CONSTRAINT "eval_criteria_set_translations_reviewed_by_fk"
    FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Evaluation Dimension Translations reviewed_by FK
DO $$ BEGIN
  ALTER TABLE "evaluation_dimension_translations" ADD CONSTRAINT "eval_dimension_translations_reviewed_by_fk"
    FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`;

const indexesSQL = `
-- Indexes (IF NOT EXISTS 사용)
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "sessions" USING btree ("expire");
CREATE INDEX IF NOT EXISTS "idx_system_settings_category" ON "system_settings" USING btree ("category");
CREATE INDEX IF NOT EXISTS "idx_system_settings_key" ON "system_settings" USING btree ("key");
CREATE INDEX IF NOT EXISTS "idx_feedbacks_conversation_id" ON "feedbacks" USING btree ("conversation_id");
CREATE INDEX IF NOT EXISTS "idx_feedbacks_persona_run_id" ON "feedbacks" USING btree ("persona_run_id");
CREATE INDEX IF NOT EXISTS "idx_persona_runs_scenario_run_id" ON "persona_runs" USING btree ("scenario_run_id");
CREATE INDEX IF NOT EXISTS "idx_persona_runs_persona_id" ON "persona_runs" USING btree ("persona_id");
CREATE INDEX IF NOT EXISTS "idx_persona_runs_conversation_id" ON "persona_runs" USING btree ("conversation_id");
CREATE INDEX IF NOT EXISTS "idx_scenario_runs_user_id" ON "scenario_runs" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "idx_scenario_runs_scenario_id" ON "scenario_runs" USING btree ("scenario_id");
CREATE INDEX IF NOT EXISTS "idx_chat_messages_persona_run_id" ON "chat_messages" USING btree ("persona_run_id");
CREATE INDEX IF NOT EXISTS "idx_ai_usage_logs_occurred_at" ON "ai_usage_logs" USING btree ("occurred_at");
CREATE INDEX IF NOT EXISTS "idx_ai_usage_logs_feature" ON "ai_usage_logs" USING btree ("feature");
CREATE INDEX IF NOT EXISTS "idx_ai_usage_logs_user_id" ON "ai_usage_logs" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "idx_ai_usage_logs_model" ON "ai_usage_logs" USING btree ("model");
CREATE INDEX IF NOT EXISTS "idx_criteria_sets_category" ON "evaluation_criteria_sets" USING btree ("category_id");
CREATE INDEX IF NOT EXISTS "idx_criteria_sets_default" ON "evaluation_criteria_sets" USING btree ("is_default");
CREATE INDEX IF NOT EXISTS "idx_dimensions_criteria_set" ON "evaluation_dimensions" USING btree ("criteria_set_id");
CREATE INDEX IF NOT EXISTS "idx_dimensions_key" ON "evaluation_dimensions" USING btree ("key");

-- 3단 계층 구조 인덱스
CREATE INDEX IF NOT EXISTS "idx_organizations_company_id" ON "organizations" USING btree ("company_id");
CREATE INDEX IF NOT EXISTS "idx_categories_organization_id" ON "categories" USING btree ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_users_company_id" ON "users" USING btree ("company_id");
CREATE INDEX IF NOT EXISTS "idx_users_organization_id" ON "users" USING btree ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_operator_assignments_user_id" ON "operator_assignments" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "idx_operator_assignments_company_id" ON "operator_assignments" USING btree ("company_id");
CREATE INDEX IF NOT EXISTS "idx_operator_assignments_organization_id" ON "operator_assignments" USING btree ("organization_id");

-- 시나리오 및 번역 인덱스
CREATE INDEX IF NOT EXISTS "idx_scenarios_category_id" ON "scenarios" USING btree ("category_id");
CREATE INDEX IF NOT EXISTS "idx_scenarios_difficulty" ON "scenarios" USING btree ("difficulty");
CREATE INDEX IF NOT EXISTS "idx_scenarios_is_deleted" ON "scenarios" USING btree ("is_deleted");
CREATE INDEX IF NOT EXISTS "idx_scenario_translations_scenario_id" ON "scenario_translations" USING btree ("scenario_id");
CREATE INDEX IF NOT EXISTS "idx_scenario_translations_locale" ON "scenario_translations" USING btree ("locale");
CREATE INDEX IF NOT EXISTS "idx_persona_translations_persona_id" ON "persona_translations" USING btree ("persona_id");
CREATE INDEX IF NOT EXISTS "idx_persona_translations_locale" ON "persona_translations" USING btree ("locale");
CREATE INDEX IF NOT EXISTS "idx_category_translations_category_id" ON "category_translations" USING btree ("category_id");
CREATE INDEX IF NOT EXISTS "idx_category_translations_locale" ON "category_translations" USING btree ("locale");
CREATE INDEX IF NOT EXISTS "idx_criteria_set_translations_set_id" ON "evaluation_criteria_set_translations" USING btree ("criteria_set_id");
CREATE INDEX IF NOT EXISTS "idx_criteria_set_translations_locale" ON "evaluation_criteria_set_translations" USING btree ("locale");
CREATE INDEX IF NOT EXISTS "idx_dimension_translations_dimension_id" ON "evaluation_dimension_translations" USING btree ("dimension_id");
CREATE INDEX IF NOT EXISTS "idx_dimension_translations_locale" ON "evaluation_dimension_translations" USING btree ("locale");

-- 사용자 북마크 인덱스
CREATE INDEX IF NOT EXISTS "idx_user_bookmarks_user_id" ON "user_bookmarks" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "idx_user_bookmarks_scenario_id" ON "user_bookmarks" USING btree ("scenario_id");
`;

// 기본 평가 기준 세트 시딩 SQL
const seedDefaultEvaluationCriteriaSQL = `
-- 기본 평가 기준 세트 (없으면 생성)
INSERT INTO "evaluation_criteria_sets" ("id", "name", "description", "is_default", "is_active", "category_id", "created_by", "created_at", "updated_at")
SELECT 
  'default-criteria-set',
  '기본 커뮤니케이션 평가 기준',
  'ComOn Check 연구 기반 5점 척도 평가 기준. 명확성/논리성, 경청/공감, 적절성/적응력, 설득력/영향력, 전략적 커뮤니케이션 5개 차원으로 구성됩니다.',
  true,
  true,
  NULL,
  NULL,
  NOW(),
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM "evaluation_criteria_sets" WHERE "id" = 'default-criteria-set');

-- 기본 평가 차원들 (없으면 생성)
INSERT INTO "evaluation_dimensions" ("id", "criteria_set_id", "key", "name", "description", "weight", "min_score", "max_score", "icon", "color", "display_order", "is_active", "scoring_rubric", "created_at")
SELECT 
  'dim-clarity-logic',
  'default-criteria-set',
  'clarityLogic',
  '명확성과 논리성',
  '메시지의 명확한 전달과 논리적인 구조로 효과적으로 의사를 표현하는 능력',
  1.0,
  1,
  5,
  'fa-solid fa-bullseye',
  'blue',
  1,
  true,
  '[{"score":5,"label":"탁월","description":"매우 명확하고 논리적인 커뮤니케이션"},{"score":4,"label":"우수","description":"명확하고 논리적인 커뮤니케이션"},{"score":3,"label":"보통","description":"기본적인 명확성과 논리성"},{"score":2,"label":"개선필요","description":"명확성이나 논리성이 부족"},{"score":1,"label":"미흡","description":"불명확하고 비논리적인 커뮤니케이션"}]',
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM "evaluation_dimensions" WHERE "id" = 'dim-clarity-logic');

INSERT INTO "evaluation_dimensions" ("id", "criteria_set_id", "key", "name", "description", "weight", "min_score", "max_score", "icon", "color", "display_order", "is_active", "scoring_rubric", "created_at")
SELECT 
  'dim-listening-empathy',
  'default-criteria-set',
  'listeningEmpathy',
  '경청과 공감',
  '상대방의 말을 주의 깊게 듣고 감정을 이해하며 적절히 반응하는 능력',
  1.0,
  1,
  5,
  'fa-solid fa-heart',
  'pink',
  2,
  true,
  '[{"score":5,"label":"탁월","description":"깊은 경청과 공감 능력"},{"score":4,"label":"우수","description":"우수한 경청과 공감"},{"score":3,"label":"보통","description":"기본적인 경청과 공감"},{"score":2,"label":"개선필요","description":"경청이나 공감이 부족"},{"score":1,"label":"미흡","description":"경청과 공감이 미흡"}]',
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM "evaluation_dimensions" WHERE "id" = 'dim-listening-empathy');

INSERT INTO "evaluation_dimensions" ("id", "criteria_set_id", "key", "name", "description", "weight", "min_score", "max_score", "icon", "color", "display_order", "is_active", "scoring_rubric", "created_at")
SELECT 
  'dim-appropriateness',
  'default-criteria-set',
  'appropriatenessAdaptability',
  '적절성과 적응력',
  '상황과 맥락에 맞게 커뮤니케이션 스타일을 조절하고 적절하게 대응하는 능력',
  1.0,
  1,
  5,
  'fa-solid fa-arrows-rotate',
  'green',
  3,
  true,
  '[{"score":5,"label":"탁월","description":"뛰어난 상황 적응력"},{"score":4,"label":"우수","description":"우수한 상황 대응"},{"score":3,"label":"보통","description":"기본적인 상황 대응"},{"score":2,"label":"개선필요","description":"상황 대응이 미숙"},{"score":1,"label":"미흡","description":"상황 파악이 미흡"}]',
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM "evaluation_dimensions" WHERE "id" = 'dim-appropriateness');

INSERT INTO "evaluation_dimensions" ("id", "criteria_set_id", "key", "name", "description", "weight", "min_score", "max_score", "icon", "color", "display_order", "is_active", "scoring_rubric", "created_at")
SELECT 
  'dim-persuasiveness',
  'default-criteria-set',
  'persuasivenessImpact',
  '설득력과 영향력',
  '상대방을 효과적으로 설득하고 원하는 방향으로 영향력을 발휘하는 능력',
  1.0,
  1,
  5,
  'fa-solid fa-chart-line',
  'orange',
  4,
  true,
  '[{"score":5,"label":"탁월","description":"탁월한 설득력과 영향력"},{"score":4,"label":"우수","description":"우수한 설득력"},{"score":3,"label":"보통","description":"기본적인 설득력"},{"score":2,"label":"개선필요","description":"설득력이 부족"},{"score":1,"label":"미흡","description":"설득력이 미흡"}]',
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM "evaluation_dimensions" WHERE "id" = 'dim-persuasiveness');

INSERT INTO "evaluation_dimensions" ("id", "criteria_set_id", "key", "name", "description", "weight", "min_score", "max_score", "icon", "color", "display_order", "is_active", "scoring_rubric", "created_at")
SELECT 
  'dim-strategic-comm',
  'default-criteria-set',
  'strategicCommunication',
  '전략적 커뮤니케이션',
  '목표 달성을 위해 체계적이고 전략적으로 대화를 이끌어가는 능력',
  1.0,
  1,
  5,
  'fa-solid fa-chess',
  'purple',
  5,
  true,
  '[{"score":5,"label":"탁월","description":"탁월한 전략적 대화 능력"},{"score":4,"label":"우수","description":"우수한 전략적 접근"},{"score":3,"label":"보통","description":"기본적인 전략적 대화"},{"score":2,"label":"개선필요","description":"전략적 접근이 부족"},{"score":1,"label":"미흡","description":"전략적 사고가 미흡"}]',
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM "evaluation_dimensions" WHERE "id" = 'dim-strategic-comm');
`;

/**
 * Build pg Pool config – handles Cloud SQL Unix socket URLs.
 * See storage.ts for detailed explanation.
 */
function buildPoolConfig(url: string): import('pg').PoolConfig {
  try {
    const parsed = new URL(url);
    const hostParam = parsed.searchParams.get('host');

    if (hostParam && hostParam.startsWith('/cloudsql/')) {
      console.log(`[migrate] Using Cloud SQL Unix socket: ${hostParam}`);
      return {
        host: hostParam,
        user: parsed.username,
        password: parsed.password,
        database: parsed.pathname.slice(1),
        ssl: false,
      };
    }
  } catch {
    // fall through
  }

  const isUnixSocket = url.includes('/cloudsql/');
  const disableSsl = url.includes('sslmode=disable') || isUnixSocket;

  return {
    connectionString: url,
    ssl: disableSsl ? false : { rejectUnauthorized: false },
  };
}

/** Run a query with a per-statement timeout to prevent migrations from hanging. */
async function queryWithTimeout(
  client: import('pg').PoolClient,
  label: string,
  queryText: string,
  timeoutMs = 30_000,
): Promise<void> {
  await client.query(`SET statement_timeout = ${timeoutMs}`);
  try {
    await client.query(queryText);
    console.log(`✅ ${label}`);
  } catch (err) {
    console.error(`❌ ${label} failed:`, err);
    throw err;
  } finally {
    await client.query('SET statement_timeout = 0');
  }
}

export async function runMigrations(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.log('⚠️ DATABASE_URL not set, skipping migrations');
    return;
  }

  const pool = new Pool({
    ...buildPoolConfig(databaseUrl),
    connectionTimeoutMillis: 10000,
  });

  try {
    console.log('🔄 Running database migrations...');

    const client = await pool.connect();

    try {
      // 테이블 생성
      await queryWithTimeout(client, 'Tables created/verified', migrationSQL);

      // Critical columns patch: ensure users table has all required columns
      // even if the main migration failed partway through on a previous run.
      // Each ALTER TABLE runs independently so one failure doesn't block others.
      const criticalColumnPatches = [
        { table: 'users', column: 'preferred_language', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='preferred_language') THEN ALTER TABLE "users" ADD COLUMN "preferred_language" varchar DEFAULT 'ko' NOT NULL; END IF; END $$;` },
        { table: 'users', column: 'company_id', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='company_id') THEN ALTER TABLE "users" ADD COLUMN "company_id" varchar; END IF; END $$;` },
        { table: 'users', column: 'organization_id', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='organization_id') THEN ALTER TABLE "users" ADD COLUMN "organization_id" varchar; END IF; END $$;` },
        { table: 'users', column: 'assigned_company_id', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='assigned_company_id') THEN ALTER TABLE "users" ADD COLUMN "assigned_company_id" varchar; END IF; END $$;` },
        { table: 'users', column: 'assigned_organization_id', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='assigned_organization_id') THEN ALTER TABLE "users" ADD COLUMN "assigned_organization_id" varchar; END IF; END $$;` },
        { table: 'scenarios', column: 'is_deleted', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='scenarios' AND column_name='is_deleted') THEN ALTER TABLE "scenarios" ADD COLUMN "is_deleted" boolean DEFAULT false NOT NULL; END IF; END $$;` },
        { table: 'scenarios', column: 'deleted_at', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='scenarios' AND column_name='deleted_at') THEN ALTER TABLE "scenarios" ADD COLUMN "deleted_at" timestamp; END IF; END $$;` },
        { table: 'scenarios', column: 'source_locale', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='scenarios' AND column_name='source_locale') THEN ALTER TABLE "scenarios" ADD COLUMN "source_locale" varchar(10) DEFAULT 'ko' NOT NULL; END IF; END $$;` },
        { table: 'scenarios', column: 'is_demo', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='scenarios' AND column_name='is_demo') THEN ALTER TABLE "scenarios" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL; END IF; END $$;` },
        { table: 'scenarios', column: 'evaluation_criteria_set_id', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='scenarios' AND column_name='evaluation_criteria_set_id') THEN ALTER TABLE "scenarios" ADD COLUMN "evaluation_criteria_set_id" varchar; END IF; END $$;` },
        { table: 'evaluation_dimensions', column: 'dimension_type', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evaluation_dimensions' AND column_name='dimension_type') THEN ALTER TABLE "evaluation_dimensions" ADD COLUMN "dimension_type" varchar DEFAULT 'standard' NOT NULL; END IF; END $$;` },
      ];

      for (const patch of criticalColumnPatches) {
        try {
          await client.query(patch.sql);
        } catch (err) {
          console.warn(`⚠️ Failed to ensure ${patch.table}.${patch.column}:`, err);
        }
      }
      console.log('✅ Critical column patches verified');

      // Foreign Keys 추가
      await queryWithTimeout(client, 'Foreign keys created/verified', foreignKeysSQL);

      // Indexes 추가
      await queryWithTimeout(client, 'Indexes created/verified', indexesSQL);

      // 기본 평가 기준 시딩
      await queryWithTimeout(client, 'Default evaluation criteria seeded', seedDefaultEvaluationCriteriaSQL);

      console.log('✅ Database migrations completed successfully');
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ Migration error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}
