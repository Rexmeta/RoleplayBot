CREATE TABLE "ai_usage_logs" (
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
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar NOT NULL,
	"description" text,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"persona_run_id" varchar NOT NULL,
	"turn_index" integer NOT NULL,
	"sender" text NOT NULL,
	"message" text NOT NULL,
	"emotion" text,
	"emotion_reason" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
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
--> statement-breakpoint
CREATE TABLE "feedbacks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" varchar,
	"persona_run_id" varchar,
	"overall_score" integer NOT NULL,
	"scores" jsonb NOT NULL,
	"detailed_feedback" jsonb NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_runs" (
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
--> statement-breakpoint
CREATE TABLE "scenario_runs" (
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
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" varchar NOT NULL,
	"key" varchar NOT NULL,
	"value" text NOT NULL,
	"description" text,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_by" varchar
);
--> statement-breakpoint
CREATE TABLE "users" (
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
--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_persona_run_id_persona_runs_id_fk" FOREIGN KEY ("persona_run_id") REFERENCES "public"."persona_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_persona_run_id_persona_runs_id_fk" FOREIGN KEY ("persona_run_id") REFERENCES "public"."persona_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_runs" ADD CONSTRAINT "persona_runs_scenario_run_id_scenario_runs_id_fk" FOREIGN KEY ("scenario_run_id") REFERENCES "public"."scenario_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_runs" ADD CONSTRAINT "persona_runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD CONSTRAINT "scenario_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_assigned_category_id_categories_id_fk" FOREIGN KEY ("assigned_category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_usage_logs_occurred_at" ON "ai_usage_logs" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "idx_ai_usage_logs_feature" ON "ai_usage_logs" USING btree ("feature");--> statement-breakpoint
CREATE INDEX "idx_ai_usage_logs_user_id" ON "ai_usage_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_ai_usage_logs_model" ON "ai_usage_logs" USING btree ("model");--> statement-breakpoint
CREATE INDEX "idx_chat_messages_persona_run_id" ON "chat_messages" USING btree ("persona_run_id");--> statement-breakpoint
CREATE INDEX "idx_feedbacks_conversation_id" ON "feedbacks" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_feedbacks_persona_run_id" ON "feedbacks" USING btree ("persona_run_id");--> statement-breakpoint
CREATE INDEX "idx_persona_runs_scenario_run_id" ON "persona_runs" USING btree ("scenario_run_id");--> statement-breakpoint
CREATE INDEX "idx_persona_runs_persona_id" ON "persona_runs" USING btree ("persona_id");--> statement-breakpoint
CREATE INDEX "idx_persona_runs_conversation_id" ON "persona_runs" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_scenario_runs_user_id" ON "scenario_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_scenario_runs_scenario_id" ON "scenario_runs" USING btree ("scenario_id");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "idx_system_settings_category" ON "system_settings" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_system_settings_key" ON "system_settings" USING btree ("key");