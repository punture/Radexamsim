CREATE TABLE "appeals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"case_attempt_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"statement" text NOT NULL,
	"disputed_element_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"transcript_corrections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"resolution" text,
	"revised_assessment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "assessment_passes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_attempt_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"run" integer DEFAULT 1 NOT NULL,
	"assessor_kind" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"output" jsonb,
	"validation_issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_handles" (
	"handle" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"case_attempt_id" uuid NOT NULL,
	"case_version_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"disclosed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mfa_verified_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "case_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_attempt_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"assessment_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"provisional" boolean NOT NULL,
	"withheld" boolean NOT NULL,
	"assessor_kind" text NOT NULL,
	"supersedes_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"case_version_id" text NOT NULL,
	"case_family_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"stage_state" jsonb,
	"started_at_ms" integer,
	"ended_at_ms" integer,
	"close_reason" text,
	"first_exposure" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_version_id" text NOT NULL,
	"reviewer" text NOT NULL,
	"status" text NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text,
	"provenance" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_versions" (
	"version_id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"publication_status" text NOT NULL,
	"clinical_content_hash" text NOT NULL,
	"rubric_hash" text NOT NULL,
	"assets_hash" text NOT NULL,
	"is_fixture" boolean NOT NULL,
	"validation_issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"case_id" text PRIMARY KEY NOT NULL,
	"case_family_id" text NOT NULL,
	"published_version_id" text,
	"withdrawn_at" timestamp with time zone,
	"withdrawal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"granted" boolean NOT NULL,
	"policy_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slot" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"case_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"result_storage_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'none' NOT NULL,
	"plan_id" text,
	"period_key" text,
	"period_end" timestamp with time zone,
	"demo_cases_remaining" integer DEFAULT 1 NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_version_id" text NOT NULL,
	"mode" text NOT NULL,
	"case_version_ids" jsonb NOT NULL,
	"seed" text NOT NULL,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_profiles" (
	"version_id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "examiner_utterances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"case_attempt_id" uuid,
	"kind" text NOT NULL,
	"ref_id" text,
	"prompt_class" text NOT NULL,
	"text" text NOT NULL,
	"target_element_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"supplies_element_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"planned_at_ms" integer NOT NULL,
	"playback_started_at_ms" integer,
	"playback_ended_at_ms" integer,
	"played_chars" integer DEFAULT 0 NOT NULL,
	"played_portion_method" text DEFAULT 'none' NOT NULL,
	"delivery_status" text NOT NULL,
	"tts_provider" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"dedupe_key" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "metric_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"value" double precision NOT NULL,
	"labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_id" text NOT NULL,
	"prompt_version" text NOT NULL,
	"session_id" uuid,
	"case_attempt_id" uuid,
	"case_version_id" text,
	"status" text NOT NULL,
	"error_class" text,
	"latency_ms" integer NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_review_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"priority" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"resolution" text,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "processed_commands" (
	"session_id" uuid NOT NULL,
	"command_id" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_commands_session_id_command_id_pk" PRIMARY KEY("session_id","command_id")
);
--> statement-breakpoint
CREATE TABLE "recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"bytes" integer NOT NULL,
	"retained_until" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_debriefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"case_attempt_id" uuid,
	"seq" integer NOT NULL,
	"server_time" timestamp with time zone DEFAULT now() NOT NULL,
	"session_clock_ms" integer NOT NULL,
	"type" text NOT NULL,
	"payload_schema_version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"content_versions" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"case_attempt_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"profile_version_id" text NOT NULL,
	"case_family_id" text NOT NULL,
	"element_id" text NOT NULL,
	"skill" text NOT NULL,
	"severity" text NOT NULL,
	"status" text NOT NULL,
	"prompting_level" text,
	"first_exposure" boolean NOT NULL,
	"assisted" boolean NOT NULL,
	"is_fixture" boolean NOT NULL,
	"superseded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"sha256" text NOT NULL,
	"quarantine_storage_key" text NOT NULL,
	"privacy_status" text DEFAULT 'quarantine' NOT NULL,
	"rights_status" text DEFAULT 'unresolved' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_file_id" uuid,
	"locator" text NOT NULL,
	"case_family_id" text,
	"source_diagnosis" text,
	"diagnosis_basis" text,
	"modalities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"image_quality" text,
	"teaching_annotations" boolean DEFAULT false NOT NULL,
	"identifiers_found" boolean DEFAULT false NOT NULL,
	"identifier_notes" text,
	"commercial_use_status" text DEFAULT 'unresolved' NOT NULL,
	"missing_material" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "station_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"profile_version_id" text NOT NULL,
	"mode" text NOT NULL,
	"form_id" uuid NOT NULL,
	"status" text NOT NULL,
	"outcome" text,
	"clock" jsonb NOT NULL,
	"case_count" integer NOT NULL,
	"current_case_index" integer DEFAULT 0 NOT NULL,
	"input_mode" text NOT NULL,
	"speech_config" jsonb NOT NULL,
	"preflight" jsonb,
	"contains_fixtures" boolean NOT NULL,
	"event_seq" integer DEFAULT 0 NOT NULL,
	"viewer_seq" integer DEFAULT 0 NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"technical_notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"finalized_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"api_version" text,
	"created" bigint NOT NULL,
	"livemode" boolean NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"stripe_subscription_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" text NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"trial_end" timestamp with time zone,
	"last_event_created" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcript_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"case_attempt_id" uuid,
	"source" text NOT NULL,
	"text" text NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"words" jsonb,
	"confidence" double precision,
	"provider" jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"supersedes_segment_id" uuid,
	"status" text DEFAULT 'final' NOT NULL,
	"revision_reason" text,
	"revised_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"minutes" integer NOT NULL,
	"session_id" uuid,
	"period_key" text,
	"idempotency_key" text NOT NULL,
	"reason" text NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"role" text DEFAULT 'learner' NOT NULL,
	"auth_provider" text NOT NULL,
	"external_auth_id" text,
	"password_hash" text,
	"totp_secret" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"stripe_customer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "viewer_commands" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"case_attempt_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"await_ack" boolean NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_case_attempt_id_case_attempts_id_fk" FOREIGN KEY ("case_attempt_id") REFERENCES "public"."case_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_assessment_id_case_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."case_assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_passes" ADD CONSTRAINT "assessment_passes_case_attempt_id_case_attempts_id_fk" FOREIGN KEY ("case_attempt_id") REFERENCES "public"."case_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_handles" ADD CONSTRAINT "asset_handles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_handles" ADD CONSTRAINT "asset_handles_session_id_station_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."station_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_handles" ADD CONSTRAINT "asset_handles_case_attempt_id_case_attempts_id_fk" FOREIGN KEY ("case_attempt_id") REFERENCES "public"."case_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assessments" ADD CONSTRAINT "case_assessments_case_attempt_id_case_attempts_id_fk" FOREIGN KEY ("case_attempt_id") REFERENCES "public"."case_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assessments" ADD CONSTRAINT "case_assessments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_attempts" ADD CONSTRAINT "case_attempts_session_id_station_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."station_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_attempts" ADD CONSTRAINT "case_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_attempts" ADD CONSTRAINT "case_attempts_case_version_id_case_versions_version_id_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."case_versions"("version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_reviews" ADD CONSTRAINT "case_reviews_case_version_id_case_versions_version_id_fk" FOREIGN KEY ("case_version_id") REFERENCES "public"."case_versions"("version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_versions" ADD CONSTRAINT "case_versions_case_id_cases_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_forms" ADD CONSTRAINT "exam_forms_profile_version_id_exam_profiles_version_id_fk" FOREIGN KEY ("profile_version_id") REFERENCES "public"."exam_profiles"("version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "examiner_utterances" ADD CONSTRAINT "examiner_utterances_session_id_station_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."station_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_plans" ADD CONSTRAINT "learning_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processed_commands" ADD CONSTRAINT "processed_commands_session_id_station_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."station_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_session_id_station_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."station_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_debriefs" ADD CONSTRAINT "session_debriefs_session_id_station_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."station_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_debriefs" ADD CONSTRAINT "session_debriefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_session_id_station_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."station_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_observations" ADD CONSTRAINT "skill_observations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_files" ADD CONSTRAINT "source_files_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_inventory_items" ADD CONSTRAINT "source_inventory_items_source_file_id_source_files_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."source_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_sessions" ADD CONSTRAINT "station_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_sessions" ADD CONSTRAINT "station_sessions_profile_version_id_exam_profiles_version_id_fk" FOREIGN KEY ("profile_version_id") REFERENCES "public"."exam_profiles"("version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_sessions" ADD CONSTRAINT "station_sessions_form_id_exam_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."exam_forms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_session_id_station_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."station_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewer_commands" ADD CONSTRAINT "viewer_commands_session_id_station_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."station_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appeals_user_idx" ON "appeals" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_passes_uq" ON "assessment_passes" USING btree ("case_attempt_id","stage","run","input_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_handles_attempt_asset_uq" ON "asset_handles" USING btree ("case_attempt_id","asset_id");--> statement-breakpoint
CREATE INDEX "audit_events_target_idx" ON "audit_events" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_uq" ON "auth_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "case_assessments_version_uq" ON "case_assessments" USING btree ("case_attempt_id","assessment_version");--> statement-breakpoint
CREATE UNIQUE INDEX "case_attempts_session_ordinal_uq" ON "case_attempts" USING btree ("session_id","ordinal");--> statement-breakpoint
CREATE INDEX "case_attempts_user_idx" ON "case_attempts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "case_reviews_version_idx" ON "case_reviews" USING btree ("case_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "case_versions_case_number_uq" ON "case_versions" USING btree ("case_id","version_number");--> statement-breakpoint
CREATE INDEX "case_versions_status_idx" ON "case_versions" USING btree ("publication_status");--> statement-breakpoint
CREATE INDEX "consents_user_kind_idx" ON "consents" USING btree ("user_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "examiner_utterances_session_idx" ON "examiner_utterances" USING btree ("session_id","planned_at_ms");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_uq" ON "jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "metric_samples_name_idx" ON "metric_samples" USING btree ("name","created_at");--> statement-breakpoint
CREATE INDEX "model_calls_role_idx" ON "model_calls" USING btree ("role","created_at");--> statement-breakpoint
CREATE INDEX "model_calls_session_idx" ON "model_calls" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "owner_review_items_dedupe_uq" ON "owner_review_items" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "owner_review_items_status_idx" ON "owner_review_items" USING btree ("status","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "session_debriefs_version_uq" ON "session_debriefs" USING btree ("session_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "session_events_seq_uq" ON "session_events" USING btree ("session_id","seq");--> statement-breakpoint
CREATE INDEX "session_events_type_idx" ON "session_events" USING btree ("session_id","type");--> statement-breakpoint
CREATE INDEX "skill_observations_user_idx" ON "skill_observations" USING btree ("user_id","skill","created_at");--> statement-breakpoint
CREATE INDEX "station_sessions_user_idx" ON "station_sessions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_stripe_uq" ON "subscriptions" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "transcript_segments_session_idx" ON "transcript_segments" USING btree ("session_id","start_ms");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_ledger_idem_uq" ON "usage_ledger" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "usage_ledger_user_idx" ON "usage_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_external_auth_uq" ON "users" USING btree ("auth_provider","external_auth_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_stripe_customer_uq" ON "users" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "viewer_commands_seq_uq" ON "viewer_commands" USING btree ("session_id","seq");