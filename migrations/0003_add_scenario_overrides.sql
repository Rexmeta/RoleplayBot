CREATE TABLE "scenario_overrides" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "organization_id" varchar NOT NULL,
        "scenario_id" varchar NOT NULL,
        "override" jsonb NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenario_versions" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "scenario_id" varchar NOT NULL,
        "version" integer NOT NULL,
        "status" varchar(20) DEFAULT 'published' NOT NULL,
        "content_snapshot" jsonb NOT NULL,
        "evaluation_harness_snapshot" jsonb,
        "published_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "published_by" varchar
);
--> statement-breakpoint
CREATE TABLE "persona_user_scenes" (
        "id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "creator_id" varchar(36) NOT NULL,
        "title" text NOT NULL,
        "description" text DEFAULT '' NOT NULL,
        "setting" text DEFAULT '' NOT NULL,
        "mood" text DEFAULT '' NOT NULL,
        "opening_line" text DEFAULT '' NOT NULL,
        "genre" text DEFAULT '일상' NOT NULL,
        "tags" text[] DEFAULT '{}',
        "is_public" boolean DEFAULT false NOT NULL,
        "use_count" integer DEFAULT 0 NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simulation_events" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "persona_run_id" varchar NOT NULL,
        "scenario_run_id" varchar,
        "turn_index" integer DEFAULT 0 NOT NULL,
        "turn_id" varchar,
        "event_type" varchar NOT NULL,
        "tool_name" varchar,
        "args" jsonb,
        "result" jsonb,
        "state_before" jsonb,
        "state_after" jsonb,
        "state_version_before" integer,
        "state_version_after" integer,
        "include_in_report" boolean DEFAULT true NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_api_keys" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "name" varchar NOT NULL,
        "key_hash" varchar NOT NULL,
        "key_prefix" varchar(16) NOT NULL,
        "environment" varchar(10) DEFAULT 'live' NOT NULL,
        "owner_user_id" varchar NOT NULL,
        "organization_id" varchar NOT NULL,
        "scopes" text[] DEFAULT '{}'::text[] NOT NULL,
        "allowed_ips" text[] DEFAULT '{}'::text[] NOT NULL,
        "allowed_origins" text[] DEFAULT '{}'::text[] NOT NULL,
        "rate_limit_per_minute" integer DEFAULT 60 NOT NULL,
        "expires_at" timestamp,
        "last_used_at" timestamp,
        "revoked_at" timestamp,
        "revoked_by_user_id" varchar,
        "revocation_reason" text,
        "is_active" boolean DEFAULT true NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_idempotency_keys" (
        "key" varchar NOT NULL,
        "agent_key_id" varchar NOT NULL,
        "request_hash" varchar NOT NULL,
        "response_body" jsonb,
        "status_code" integer NOT NULL,
        "expires_at" timestamp NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_key_scenarios" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "agent_key_id" varchar NOT NULL,
        "scenario_id" text NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_sessions" (
        "id" varchar PRIMARY KEY NOT NULL,
        "agent_key_id" varchar NOT NULL,
        "organization_id" varchar NOT NULL,
        "external_user_id" varchar NOT NULL,
        "external_session_id" varchar,
        "persona_run_id" varchar,
        "scenario_id" text NOT NULL,
        "persona_id" text NOT NULL,
        "language" varchar(5) DEFAULT 'ko' NOT NULL,
        "difficulty" integer DEFAULT 4 NOT NULL,
        "status" varchar(20) DEFAULT 'active' NOT NULL,
        "metadata" jsonb,
        "last_activity_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "expires_at" timestamp NOT NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "ended_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "agent_usage_daily" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "organization_id" varchar NOT NULL,
        "agent_key_id" varchar NOT NULL,
        "date" varchar(10) NOT NULL,
        "request_count" integer DEFAULT 0 NOT NULL,
        "session_count" integer DEFAULT 0 NOT NULL,
        "input_tokens" integer DEFAULT 0 NOT NULL,
        "output_tokens" integer DEFAULT 0 NOT NULL,
        "total_tokens" integer DEFAULT 0 NOT NULL,
        "error_count" integer DEFAULT 0 NOT NULL,
        "avg_latency_ms" integer
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "actor_user_id" varchar,
        "organization_id" varchar,
        "action" varchar NOT NULL,
        "target_type" varchar,
        "target_id" varchar,
        "metadata" jsonb,
        "ip" varchar,
        "user_agent" text,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evaluation_dimensions" ALTER COLUMN "max_score" SET DEFAULT 10;--> statement-breakpoint
ALTER TABLE "feedbacks" ALTER COLUMN "overall_score" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "scenario_runs" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN "agent_key_id" varchar;--> statement-breakpoint
ALTER TABLE "evaluation_criteria_sets" ADD COLUMN "status" varchar DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "evaluation_criteria_sets" ADD COLUMN "owner_operator_id" varchar;--> statement-breakpoint
ALTER TABLE "evaluation_criteria_sets" ADD COLUMN "approved_by" varchar;--> statement-breakpoint
ALTER TABLE "evaluation_criteria_sets" ADD COLUMN "approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "evaluation_criteria_sets" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "evaluation_criteria_sets" ADD COLUMN "parent_set_id" varchar;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD COLUMN "confidence" double precision;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD COLUMN "report_status" varchar;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD COLUMN "rubric_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD COLUMN "conversation_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD COLUMN "evaluation_prompt_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD COLUMN "model_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD COLUMN "criteria_set_version" integer;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD COLUMN "score_adjustments" jsonb;--> statement-breakpoint
ALTER TABLE "persona_runs" ADD COLUMN "simulation_state" jsonb;--> statement-breakpoint
ALTER TABLE "persona_runs" ADD COLUMN "termination_reason" text;--> statement-breakpoint
ALTER TABLE "persona_runs" ADD COLUMN "active_persona_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "persona_runs" ADD COLUMN "persona_switch_log" jsonb;--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD COLUMN "scenario_version_id" varchar;--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD COLUMN "scenario_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD COLUMN "evaluation_harness_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "scenarios" ADD COLUMN "flow_graph" jsonb;--> statement-breakpoint
ALTER TABLE "scenarios" ADD COLUMN "persona_switch_rules" jsonb;--> statement-breakpoint
ALTER TABLE "scenarios" ADD COLUMN "target_duration_minutes" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "scenarios" ADD COLUMN "target_turns" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "scenarios" ADD COLUMN "min_valid_turns" integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "scenarios" ADD COLUMN "evaluation_harness" jsonb;--> statement-breakpoint
ALTER TABLE "scenarios" ADD COLUMN "termination_rules" jsonb;--> statement-breakpoint
ALTER TABLE "scenarios" ADD COLUMN "player_constraints" jsonb;--> statement-breakpoint
ALTER TABLE "scenarios" ADD COLUMN "difficulty_profile" jsonb;--> statement-breakpoint
ALTER TABLE "scenarios" ADD COLUMN "persona_switch_mode" varchar(20);--> statement-breakpoint
ALTER TABLE "scenarios" ADD COLUMN "simulation_harness" jsonb;--> statement-breakpoint
ALTER TABLE "user_personas" ADD COLUMN "expressions" jsonb;--> statement-breakpoint
ALTER TABLE "user_personas" ADD COLUMN "gender" varchar;--> statement-breakpoint
ALTER TABLE "scenario_overrides" ADD CONSTRAINT "scenario_overrides_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_overrides" ADD CONSTRAINT "scenario_overrides_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_versions" ADD CONSTRAINT "scenario_versions_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_versions" ADD CONSTRAINT "scenario_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_events" ADD CONSTRAINT "simulation_events_persona_run_id_persona_runs_id_fk" FOREIGN KEY ("persona_run_id") REFERENCES "public"."persona_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_api_keys" ADD CONSTRAINT "agent_api_keys_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_api_keys" ADD CONSTRAINT "agent_api_keys_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_idempotency_keys" ADD CONSTRAINT "agent_idempotency_keys_agent_key_id_agent_api_keys_id_fk" FOREIGN KEY ("agent_key_id") REFERENCES "public"."agent_api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_key_scenarios" ADD CONSTRAINT "agent_key_scenarios_agent_key_id_agent_api_keys_id_fk" FOREIGN KEY ("agent_key_id") REFERENCES "public"."agent_api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_agent_key_id_agent_api_keys_id_fk" FOREIGN KEY ("agent_key_id") REFERENCES "public"."agent_api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_usage_daily" ADD CONSTRAINT "agent_usage_daily_agent_key_id_agent_api_keys_id_fk" FOREIGN KEY ("agent_key_id") REFERENCES "public"."agent_api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_scenario_overrides_org_id" ON "scenario_overrides" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_scenario_overrides_scenario_id" ON "scenario_overrides" USING btree ("scenario_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_scenario_overrides_org_scenario" ON "scenario_overrides" USING btree ("organization_id","scenario_id");--> statement-breakpoint
CREATE INDEX "idx_scenario_versions_scenario_id" ON "scenario_versions" USING btree ("scenario_id");--> statement-breakpoint
CREATE INDEX "idx_scenario_versions_status" ON "scenario_versions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_simulation_events_persona_run_id" ON "simulation_events" USING btree ("persona_run_id");--> statement-breakpoint
CREATE INDEX "idx_simulation_events_turn_index" ON "simulation_events" USING btree ("turn_index");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_agent_api_keys_key_hash" ON "agent_api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "idx_agent_api_keys_key_prefix" ON "agent_api_keys" USING btree ("key_prefix");--> statement-breakpoint
CREATE INDEX "idx_agent_api_keys_org_id" ON "agent_api_keys" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_agent_api_keys_owner" ON "agent_api_keys" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_agent_idempotency_keys_primary" ON "agent_idempotency_keys" USING btree ("key","agent_key_id");--> statement-breakpoint
CREATE INDEX "idx_agent_idempotency_keys_expires" ON "agent_idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_agent_key_scenarios_unique" ON "agent_key_scenarios" USING btree ("agent_key_id","scenario_id");--> statement-breakpoint
CREATE INDEX "idx_agent_key_scenarios_key" ON "agent_key_scenarios" USING btree ("agent_key_id");--> statement-breakpoint
CREATE INDEX "idx_agent_sessions_key_id" ON "agent_sessions" USING btree ("agent_key_id");--> statement-breakpoint
CREATE INDEX "idx_agent_sessions_org_id" ON "agent_sessions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_agent_sessions_status" ON "agent_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_agent_sessions_external_session" ON "agent_sessions" USING btree ("organization_id","external_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_agent_usage_daily_unique" ON "agent_usage_daily" USING btree ("organization_id","agent_key_id","date");--> statement-breakpoint
CREATE INDEX "idx_agent_usage_daily_org" ON "agent_usage_daily" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_agent_usage_daily_date" ON "agent_usage_daily" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_actor" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_org" ON "audit_logs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_action" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_created" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "evaluation_criteria_sets" ADD CONSTRAINT "evaluation_criteria_sets_owner_operator_id_users_id_fk" FOREIGN KEY ("owner_operator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_criteria_sets" ADD CONSTRAINT "evaluation_criteria_sets_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD CONSTRAINT "scenario_runs_scenario_version_id_scenario_versions_id_fk" FOREIGN KEY ("scenario_version_id") REFERENCES "public"."scenario_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_criteria_sets_status" ON "evaluation_criteria_sets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_criteria_sets_parent" ON "evaluation_criteria_sets" USING btree ("parent_set_id");