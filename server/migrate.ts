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
  10,
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
  10,
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
  10,
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
  10,
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
  10,
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
        { table: 'user_personas', column: 'expressions', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_personas' AND column_name='expressions') THEN ALTER TABLE "user_personas" ADD COLUMN "expressions" jsonb; END IF; END $$;` },
        { table: 'user_personas', column: 'gender', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_personas' AND column_name='gender') THEN ALTER TABLE "user_personas" ADD COLUMN "gender" varchar; END IF; END $$;` },
      ];

      criticalColumnPatches.push(
        { table: 'scenarios', column: 'target_duration_minutes', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='scenarios' AND column_name='target_duration_minutes') THEN ALTER TABLE "scenarios" ADD COLUMN "target_duration_minutes" integer NOT NULL DEFAULT 7; END IF; END $$;` },
        { table: 'scenarios', column: 'target_turns', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='scenarios' AND column_name='target_turns') THEN ALTER TABLE "scenarios" ADD COLUMN "target_turns" integer NOT NULL DEFAULT 10; END IF; END $$;` },
        { table: 'scenarios', column: 'min_valid_turns', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='scenarios' AND column_name='min_valid_turns') THEN ALTER TABLE "scenarios" ADD COLUMN "min_valid_turns" integer NOT NULL DEFAULT 4; END IF; END $$;` },
        { table: 'scenarios', column: 'persona_switch_mode', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='scenarios' AND column_name='persona_switch_mode') THEN ALTER TABLE "scenarios" ADD COLUMN "persona_switch_mode" varchar; END IF; END $$;` },
        { table: 'scenarios', column: 'simulation_harness', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='scenarios' AND column_name='simulation_harness') THEN ALTER TABLE "scenarios" ADD COLUMN "simulation_harness" jsonb; END IF; END $$;` },
        { table: 'feedbacks', column: 'confidence', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='feedbacks' AND column_name='confidence') THEN ALTER TABLE "feedbacks" ADD COLUMN "confidence" double precision; END IF; END $$;` },
        { table: 'feedbacks', column: 'report_status', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='feedbacks' AND column_name='report_status') THEN ALTER TABLE "feedbacks" ADD COLUMN "report_status" varchar; END IF; END $$;` },
        { table: 'feedbacks', column: 'overall_score_nullable', sql: `DO $$ BEGIN ALTER TABLE "feedbacks" ALTER COLUMN "overall_score" DROP NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END $$;` },
        { table: 'feedbacks', column: 'rubric_snapshot', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='feedbacks' AND column_name='rubric_snapshot') THEN ALTER TABLE "feedbacks" ADD COLUMN "rubric_snapshot" jsonb; END IF; END $$;` },
        { table: 'feedbacks', column: 'conversation_snapshot', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='feedbacks' AND column_name='conversation_snapshot') THEN ALTER TABLE "feedbacks" ADD COLUMN "conversation_snapshot" jsonb; END IF; END $$;` },
        { table: 'feedbacks', column: 'evaluation_prompt_snapshot', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='feedbacks' AND column_name='evaluation_prompt_snapshot') THEN ALTER TABLE "feedbacks" ADD COLUMN "evaluation_prompt_snapshot" jsonb; END IF; END $$;` },
        { table: 'feedbacks', column: 'model_snapshot', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='feedbacks' AND column_name='model_snapshot') THEN ALTER TABLE "feedbacks" ADD COLUMN "model_snapshot" jsonb; END IF; END $$;` },
        { table: 'feedbacks', column: 'criteria_set_version', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='feedbacks' AND column_name='criteria_set_version') THEN ALTER TABLE "feedbacks" ADD COLUMN "criteria_set_version" integer; END IF; END $$;` },
        { table: 'evaluation_criteria_sets', column: 'status', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evaluation_criteria_sets' AND column_name='status') THEN ALTER TABLE "evaluation_criteria_sets" ADD COLUMN "status" varchar DEFAULT 'draft' NOT NULL; END IF; END $$;` },
        { table: 'evaluation_criteria_sets', column: 'approved_by', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evaluation_criteria_sets' AND column_name='approved_by') THEN ALTER TABLE "evaluation_criteria_sets" ADD COLUMN "approved_by" varchar; END IF; END $$;` },
        { table: 'evaluation_criteria_sets', column: 'approved_at', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evaluation_criteria_sets' AND column_name='approved_at') THEN ALTER TABLE "evaluation_criteria_sets" ADD COLUMN "approved_at" timestamp; END IF; END $$;` },
        { table: 'evaluation_criteria_sets', column: 'version', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evaluation_criteria_sets' AND column_name='version') THEN ALTER TABLE "evaluation_criteria_sets" ADD COLUMN "version" integer DEFAULT 1 NOT NULL; END IF; END $$;` },
        { table: 'evaluation_criteria_sets', column: 'parent_set_id', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evaluation_criteria_sets' AND column_name='parent_set_id') THEN ALTER TABLE "evaluation_criteria_sets" ADD COLUMN "parent_set_id" varchar; END IF; END $$;` },
        { table: 'evaluation_criteria_sets', column: 'status_migrate_legacy', sql: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM "evaluation_criteria_sets" WHERE "status" IN ('approved','review','archived')) THEN UPDATE "evaluation_criteria_sets" SET "status" = 'approved' WHERE "is_active" = true; END IF; END $$;` },
        // Make scenario_runs.user_id nullable so agent API sessions can create runs
        // without a fake "__agent__" user ID. agent_sessions.id is the source of truth
        // for agent-originated runs.
        { table: 'scenario_runs', column: 'user_id_nullable', sql: `DO $$ BEGIN ALTER TABLE "scenario_runs" ALTER COLUMN "user_id" DROP NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END $$;` }
      );

      for (const patch of criticalColumnPatches) {
        try {
          await client.query(patch.sql);
        } catch (err) {
          console.warn(`⚠️ Failed to ensure ${patch.table}.${patch.column}:`, err);
        }
      }
      console.log('✅ Critical column patches verified');

      // Persona X 사용자 장면 테이블 생성
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS "persona_user_scenes" (
            "id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
            "creator_id" varchar(36) NOT NULL,
            "title" text NOT NULL,
            "description" text NOT NULL DEFAULT '',
            "setting" text NOT NULL DEFAULT '',
            "mood" text NOT NULL DEFAULT '',
            "opening_line" text NOT NULL DEFAULT '',
            "genre" text NOT NULL DEFAULT '일상',
            "tags" text[] DEFAULT '{}',
            "is_public" boolean NOT NULL DEFAULT false,
            "use_count" integer NOT NULL DEFAULT 0,
            "created_at" timestamp NOT NULL DEFAULT now(),
            "updated_at" timestamp NOT NULL DEFAULT now()
          )
        `);
        console.log('✅ persona_user_scenes table created/verified');
      } catch (err) {
        console.warn('⚠️ Failed to create persona_user_scenes table:', err);
      }

      // Foreign Keys 추가
      await queryWithTimeout(client, 'Foreign keys created/verified', foreignKeysSQL);

      // feedbacks.conversation_id FK 제약 조건 제거 (레거시 컬럼, nullable로 유지)
      try {
        await client.query(`ALTER TABLE feedbacks DROP CONSTRAINT IF EXISTS feedbacks_conversation_id_conversations_id_fk`);
        console.log('✅ Dropped legacy feedbacks FK constraint (if existed)');
      } catch (err) {
        console.warn('⚠️ Failed to drop feedbacks FK constraint:', err);
      }

      // Indexes 추가
      await queryWithTimeout(client, 'Indexes created/verified', indexesSQL);

      // 기본 평가 기준 시딩
      await queryWithTimeout(client, 'Default evaluation criteria seeded', seedDefaultEvaluationCriteriaSQL);

      // 모든 평가 차원 max_score 5→10 업데이트 (10점 척도 전환)
      try {
        await client.query(`
          UPDATE evaluation_dimensions
          SET max_score = 10
          WHERE max_score = 5
        `);
        console.log('✅ Default evaluation dimensions max_score updated to 10');
      } catch (err) {
        console.warn('⚠️ Failed to update evaluation_dimensions max_score:', err);
      }

      // simulation_state column on persona_runs
      try {
        await client.query(`
          DO $$ BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_name='persona_runs' AND column_name='simulation_state'
            ) THEN
              ALTER TABLE persona_runs ADD COLUMN simulation_state jsonb;
            END IF;
          END $$;
        `);
        console.log('✅ persona_runs.simulation_state column ensured');
      } catch (err) {
        console.warn('⚠️ Failed to add simulation_state to persona_runs:', err);
      }

      // simulation_events table
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS simulation_events (
            id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
            persona_run_id varchar NOT NULL REFERENCES persona_runs(id) ON DELETE CASCADE,
            scenario_run_id varchar,
            turn_index integer NOT NULL DEFAULT 0,
            turn_id varchar,
            event_type varchar NOT NULL,
            tool_name varchar,
            args jsonb,
            result jsonb,
            state_before jsonb,
            state_after jsonb,
            state_version_before integer,
            state_version_after integer,
            include_in_report boolean NOT NULL DEFAULT true,
            created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
        `);
        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_simulation_events_persona_run_id ON simulation_events(persona_run_id);
          CREATE INDEX IF NOT EXISTS idx_simulation_events_turn_index ON simulation_events(turn_index);
        `);
        console.log('✅ simulation_events table ensured');
      } catch (err) {
        console.warn('⚠️ Failed to create simulation_events table:', err);
      }

      // ─── Agent API Tables (Phase 1A) ──────────────────────────────────────
      await queryWithTimeout(client, 'Agent API tables created/verified', `
        -- agent_api_keys
        CREATE TABLE IF NOT EXISTS "agent_api_keys" (
          "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          "name" varchar NOT NULL,
          "key_hash" varchar NOT NULL,
          "key_prefix" varchar(16) NOT NULL,
          "environment" varchar(10) NOT NULL DEFAULT 'live',
          "owner_user_id" varchar NOT NULL REFERENCES "users"("id"),
          "organization_id" varchar NOT NULL,
          "scopes" text[] NOT NULL DEFAULT '{}',
          "allowed_ips" text[] NOT NULL DEFAULT '{}',
          "allowed_origins" text[] NOT NULL DEFAULT '{}',
          "rate_limit_per_minute" integer NOT NULL DEFAULT 60,
          "expires_at" timestamp,
          "last_used_at" timestamp,
          "revoked_at" timestamp,
          "revoked_by_user_id" varchar REFERENCES "users"("id"),
          "revocation_reason" text,
          "is_active" boolean NOT NULL DEFAULT true,
          "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "agent_api_keys_key_hash_unique" UNIQUE("key_hash")
        );
        CREATE INDEX IF NOT EXISTS "idx_agent_api_keys_key_prefix" ON "agent_api_keys"("key_prefix");
        CREATE INDEX IF NOT EXISTS "idx_agent_api_keys_org_id" ON "agent_api_keys"("organization_id");
        CREATE INDEX IF NOT EXISTS "idx_agent_api_keys_owner" ON "agent_api_keys"("owner_user_id");

        -- agent_key_scenarios
        CREATE TABLE IF NOT EXISTS "agent_key_scenarios" (
          "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          "agent_key_id" varchar NOT NULL REFERENCES "agent_api_keys"("id") ON DELETE CASCADE,
          "scenario_id" text NOT NULL,
          "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "agent_key_scenarios_unique" UNIQUE("agent_key_id", "scenario_id")
        );
        CREATE INDEX IF NOT EXISTS "idx_agent_key_scenarios_key" ON "agent_key_scenarios"("agent_key_id");

        -- audit_logs
        CREATE TABLE IF NOT EXISTS "audit_logs" (
          "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          "actor_user_id" varchar REFERENCES "users"("id"),
          "organization_id" varchar,
          "action" varchar NOT NULL,
          "target_type" varchar,
          "target_id" varchar,
          "metadata" jsonb,
          "ip" varchar,
          "user_agent" text,
          "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS "idx_audit_logs_actor" ON "audit_logs"("actor_user_id");
        CREATE INDEX IF NOT EXISTS "idx_audit_logs_org" ON "audit_logs"("organization_id");
        CREATE INDEX IF NOT EXISTS "idx_audit_logs_action" ON "audit_logs"("action");
        CREATE INDEX IF NOT EXISTS "idx_audit_logs_created" ON "audit_logs"("created_at");

        -- ai_usage_logs: add agent_key_id column if not exists (Phase 1A only)
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_usage_logs' AND column_name = 'agent_key_id') THEN
            ALTER TABLE "ai_usage_logs" ADD COLUMN "agent_key_id" varchar;
          END IF;
        END $$;
      `);
      console.log('✅ Agent API tables created/verified');

      // Multi-persona tracking columns for persona_runs
      try {
        await client.query(`
          DO $$ BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_name='persona_runs' AND column_name='active_persona_index'
            ) THEN
              ALTER TABLE persona_runs ADD COLUMN active_persona_index integer NOT NULL DEFAULT 0;
            END IF;
          END $$;
        `);
        await client.query(`
          DO $$ BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_name='persona_runs' AND column_name='persona_switch_log'
            ) THEN
              ALTER TABLE persona_runs ADD COLUMN persona_switch_log jsonb;
            END IF;
          END $$;
        `);
        console.log('✅ persona_runs multi-persona columns ensured');
      } catch (err) {
        console.warn('⚠️ Failed to add multi-persona columns to persona_runs:', err);
      }

      // 구형 realtime 모델 설정 자동 업데이트 (deprecated native audio preview → gemini-live-2.5-flash)
      try {
        await client.query(`
          UPDATE system_settings
          SET value = 'gemini-3.1-flash-live-preview', updated_at = now()
          WHERE category = 'ai'
            AND key = 'model_realtime'
            AND value IN (
              'gemini-2.5-flash-native-audio-preview-09-2025',
              'gemini-2.5-flash-native-audio-preview-12-2025',
              'gemini-live-2.5-flash',
              'gemini-live-2.5-flash-preview'
            )
        `);
        console.log('✅ Realtime model setting migrated to gemini-3.1-flash-live-preview');
      } catch (err) {
        console.warn('⚠️ Failed to migrate deprecated realtime model setting:', err);
      }

      // Backfill isPrimary on multi-persona scenarios that have none set.
      // Sets isPrimary=true on persona[0] (the default primary) for any scenario
      // where >1 persona exists but no persona has isPrimary=true yet.
      try {
        const bfResult = await client.query(`
          UPDATE scenarios
          SET personas = jsonb_set(personas, '{0,isPrimary}', 'true'::jsonb)
          WHERE jsonb_array_length(personas) > 1
            AND is_deleted = false
            AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(personas) p
              WHERE (p->>'isPrimary')::boolean IS TRUE
            )
        `);
        if (bfResult.rowCount && bfResult.rowCount > 0) {
          console.log(`✅ Backfilled isPrimary on ${bfResult.rowCount} multi-persona scenario(s)`);
        } else {
          console.log('✅ Multi-persona isPrimary backfill: no scenarios needed updating');
        }
      } catch (err) {
        console.warn('⚠️ Failed to backfill multi-persona isPrimary:', err);
      }

      // Backfill triggerHints and entryLine for known multi-persona scenarios.
      // These are scenario-context-aware values written once; idempotent because
      // the WHERE clause only matches personas that still lack the fields.
      try {
        // 스마트폰 생산법인장: 이수진 (persona[1], 생산팀 팀장)
        await client.query(`
          UPDATE scenarios
          SET personas = jsonb_build_array(
            personas->0,
            (personas->1)
              || '{"triggerHints":["사용자가 생산팀 입장을 직접 들어야 할 필요가 있을 때","구매팀과의 협상이 교착 상태에 빠졌을 때","생산 현장의 구체적인 어려움 파악이 필요할 때"]}'::jsonb
              || '{"entryLine":"생산팀장 이수진입니다. 제 팀원들 입장도 직접 말씀드리고 싶어서 왔습니다."}'::jsonb
          )
          WHERE id = '스마트폰-생산법인장-핵심-2026-03-27T14-21-50'
            AND jsonb_array_length(personas) = 2
            AND personas->1->>'triggerHints' IS NULL
        `);

        // N-Core persona[1]: 이수진 (선임 연구원)
        await client.query(`
          UPDATE scenarios
          SET personas = jsonb_set(
            jsonb_set(personas, '{1,triggerHints}',
              '["팀 화합이나 인간적인 문제 해결이 필요할 때","부서장과 신입사원 사이의 비공식적인 중재가 필요할 때","사용자가 팀 내 분위기 파악을 원할 때"]'::jsonb),
            '{1,entryLine}',
            '"잠깐 제가 끼어들어도 될까요? 팀 분위기가 걱정되어서요, 제가 중간에서 조율해볼 수 있을 것 같아요."'::jsonb
          )
          WHERE id = 'new-project-ncore-2026-01-21T08-00-02'
            AND jsonb_array_length(personas) = 3
            AND personas->1->>'triggerHints' IS NULL
        `);
        // N-Core persona[2]: 박지원 (PM)
        await client.query(`
          UPDATE scenarios
          SET personas = jsonb_set(
            jsonb_set(personas, '{2,triggerHints}',
              '["사용자가 공식적인 역할 조율 또는 프로젝트 전체 관점의 해결책을 요청할 때","부서장 권한 밖의 문제 해결이 필요할 때","과거 프로젝트 실패 사례나 데이터 기반 근거가 필요할 때"]'::jsonb),
            '{2,entryLine}',
            '"프로젝트 매니저 박지원입니다. 이 문제를 건설적으로 해결하는 데 제가 도움을 드릴 수 있을 것 같아서요."'::jsonb
          )
          WHERE id = 'new-project-ncore-2026-01-21T08-00-02'
            AND jsonb_array_length(personas) = 3
            AND personas->2->>'triggerHints' IS NULL
        `);

        // 코드 리뷰 persona[1]: 박수진 (PM)
        await client.query(`
          UPDATE scenarios
          SET personas = jsonb_set(
            jsonb_set(personas, '{1,triggerHints}',
              '["프로젝트 일정 지연이 심각해질 때","갈등 중재 및 빠른 합의 도출이 필요할 때","사용자가 PM의 도움을 요청할 때"]'::jsonb),
            '{1,entryLine}',
            '"PM 박수진입니다. 오늘 안에 이 문제를 꼭 해결해야 해서요, 제가 중간에서 조율해볼게요."'::jsonb
          )
          WHERE id = '코드-리뷰-터진-2026-01-21T04-34-21'
            AND jsonb_array_length(personas) = 3
            AND personas->1->>'triggerHints' IS NULL
        `);
        // 코드 리뷰 persona[2]: 이유진 (CTO)
        await client.query(`
          UPDATE scenarios
          SET personas = jsonb_set(
            jsonb_set(personas, '{2,triggerHints}',
              '["경영진 차원의 결정이 필요할 때","사용자가 CTO에게 직접 에스컬레이션을 요청할 때","팀 문화 개선 차원의 논의가 필요할 때"]'::jsonb),
            '{2,entryLine}',
            '"CTO 이유진입니다. 이번 상황을 단순히 넘기기가 어렵겠다 싶어서 직접 나왔습니다."'::jsonb
          )
          WHERE id = '코드-리뷰-터진-2026-01-21T04-34-21'
            AND jsonb_array_length(personas) = 3
            AND personas->2->>'triggerHints' IS NULL
        `);
        console.log('✅ Multi-persona triggerHints/entryLine backfill completed');
      } catch (err) {
        console.warn('⚠️ Failed to backfill multi-persona triggerHints/entryLine:', err);
      }

      // Migrate legacy stale-active runs to abandoned
      // A stale-active run is one where a newer run (same user+scenario) exists that was started later.
      try {
        const result = await client.query(`
          UPDATE scenario_runs sr
          SET status = 'abandoned'
          WHERE sr.status = 'active'
            AND EXISTS (
              SELECT 1 FROM scenario_runs newer
              WHERE newer.user_id = sr.user_id
                AND newer.scenario_id = sr.scenario_id
                AND newer.id != sr.id
                AND newer.started_at > sr.started_at
            )
        `);
        if (result.rowCount && result.rowCount > 0) {
          console.log(`✅ Migrated ${result.rowCount} legacy stale-active scenario run(s) to abandoned`);
        } else {
          console.log('✅ No legacy stale-active scenario runs to migrate');
        }
      } catch (err) {
        console.warn('⚠️ Failed to migrate legacy stale-active runs:', err);
      }

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
