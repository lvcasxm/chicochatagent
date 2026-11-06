CREATE TYPE "public"."analytics_event_type" AS ENUM('conversation_started', 'category_detected', 'resolved_without_ticket', 'ticket_created', 'ticket_failed', 'conversation_finished', 'rating_received', 'ticket_duplicate_warning_shown', 'ticket_duplicate_overridden');--> statement-breakpoint
CREATE TYPE "public"."category_action" AS ENUM('chat', 'external_link', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."conversation_outcome" AS ENUM('resolved', 'escalated', 'no_outcome');--> statement-breakpoint
CREATE TYPE "public"."instruction_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant', 'notice');--> statement-breakpoint
CREATE TYPE "public"."message_source" AS ENUM('llm', 'cache', 'system');--> statement-breakpoint
CREATE TYPE "public"."summary_source" AS ENUM('llm', 'fallback', 'test');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('pending', 'success', 'failed', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'tecnico', 'admin');--> statement-breakpoint
CREATE TABLE "ai_response_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cache_key" text NOT NULL,
	"response" text NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_hit_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" "analytics_event_type" NOT NULL,
	"user_id" uuid,
	"conversation_id" uuid,
	"attendance_session_id" uuid,
	"category" text,
	"sector" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedbacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"ticket_attempt_id" uuid,
	"rating" integer NOT NULL,
	"suggestion" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedbacks_rating_range" CHECK ("feedbacks"."rating" between 1 and 5),
	CONSTRAINT "feedbacks_suggestion_length" CHECK (char_length("feedbacks"."suggestion") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"card_description" text,
	"icon" text,
	"action" "category_action" DEFAULT 'chat' NOT NULL,
	"external_url" text,
	"secondary_link_label" text,
	"secondary_link_url" text,
	"canned_message" text,
	"short_label" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_link_has_url" CHECK ("categories"."action" <> 'external_link' or "categories"."external_url" is not null)
);
--> statement-breakpoint
CREATE TABLE "instruction_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"status" "instruction_status" NOT NULL,
	"content" text NOT NULL,
	"change_request" text,
	"change_summary" text,
	"ai_conflicts" jsonb,
	"created_by" uuid,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instruction_versions_content_length" CHECK (char_length("instruction_versions"."content") between 1 and 20000),
	CONSTRAINT "instruction_versions_no_markers" CHECK (position('<<' in "instruction_versions"."content") = 0),
	CONSTRAINT "instruction_versions_published_has_date" CHECK ("instruction_versions"."status" = 'draft' or "instruction_versions"."published_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text,
	"category_key" text,
	"attendance_session_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"resolution_attempts" integer DEFAULT 0 NOT NULL,
	"issue_persists" boolean,
	"ticket_form_unlocked_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"outcome" "conversation_outcome",
	"sector" text,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "conversations_title_length" CHECK (char_length("conversations"."title") <= 80),
	CONSTRAINT "conversations_attempts_nonnegative" CHECK ("conversations"."resolution_attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"source" "message_source",
	"incomplete" boolean DEFAULT false NOT NULL,
	"model" text,
	"finish_reason" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"prompt_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_content_length" CHECK (char_length("messages"."content") <= 20000),
	CONSTRAINT "messages_user_has_no_source" CHECK ("messages"."role" <> 'user' or "messages"."source" is null)
);
--> statement-breakpoint
CREATE TABLE "ticket_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "ticket_status" DEFAULT 'pending' NOT NULL,
	"glpi_ticket_id" text,
	"glpi_requester_id" integer,
	"requester_name" text NOT NULL,
	"requester_email" text NOT NULL,
	"sector" text NOT NULL,
	"machine_ip" text,
	"ip_unavailable" boolean DEFAULT false NOT NULL,
	"on_behalf" boolean DEFAULT false NOT NULL,
	"beneficiary_name" text,
	"beneficiary_registration" text,
	"beneficiary_sector" text,
	"title" text,
	"category" text,
	"urgency" integer,
	"summary" text,
	"summary_source" "summary_source",
	"error_code" text,
	"error_detail" text,
	"is_test" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_attempts_ip_xor" CHECK (("ticket_attempts"."ip_unavailable" and "ticket_attempts"."machine_ip" is null) or (not "ticket_attempts"."ip_unavailable" and "ticket_attempts"."machine_ip" is not null)),
	CONSTRAINT "ticket_attempts_beneficiary_required" CHECK (not "ticket_attempts"."on_behalf" or ("ticket_attempts"."beneficiary_name" is not null and "ticket_attempts"."beneficiary_sector" is not null)),
	CONSTRAINT "ticket_attempts_urgency_range" CHECK ("ticket_attempts"."urgency" is null or "ticket_attempts"."urgency" between 1 and 5),
	CONSTRAINT "ticket_attempts_success_has_ticket" CHECK ("ticket_attempts"."status" <> 'success' or "ticket_attempts"."glpi_ticket_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "ticket_transcripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_attempt_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"title" text,
	"summary" text,
	"requester_name" text,
	"sector" text,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"default_sector" text,
	"privacy_ack_at" timestamp with time zone,
	"privacy_ack_version" text,
	"google_sub" text NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "users_email_lowercase" CHECK ("users"."email" = lower("users"."email")),
	CONSTRAINT "users_privacy_ack_pair" CHECK (("users"."privacy_ack_at" is null) = ("users"."privacy_ack_version" is null))
);
--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_ticket_attempt_id_ticket_attempts_id_fk" FOREIGN KEY ("ticket_attempt_id") REFERENCES "public"."ticket_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instruction_versions" ADD CONSTRAINT "instruction_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instruction_versions" ADD CONSTRAINT "instruction_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_attempts" ADD CONSTRAINT "ticket_attempts_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_attempts" ADD CONSTRAINT "ticket_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_transcripts" ADD CONSTRAINT "ticket_transcripts_ticket_attempt_id_ticket_attempts_id_fk" FOREIGN KEY ("ticket_attempt_id") REFERENCES "public"."ticket_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_response_cache_key" ON "ai_response_cache" USING btree ("cache_key");--> statement-breakpoint
CREATE INDEX "ai_response_cache_expires_idx" ON "ai_response_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "analytics_events_type_created_idx" ON "analytics_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "analytics_events_created_at_idx" ON "analytics_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "analytics_events_conversation_idx" ON "analytics_events" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "feedbacks_conversation_key" ON "feedbacks" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_key_key" ON "categories" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "instruction_versions_version_key" ON "instruction_versions" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX "instruction_versions_single_published" ON "instruction_versions" USING btree ("status") WHERE "instruction_versions"."status" = 'published';--> statement-breakpoint
CREATE UNIQUE INDEX "instruction_versions_single_draft" ON "instruction_versions" USING btree ("status") WHERE "instruction_versions"."status" = 'draft';--> statement-breakpoint
CREATE INDEX "conversations_user_recent_idx" ON "conversations" USING btree ("user_id","last_message_at" DESC NULLS LAST) WHERE "conversations"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "conversations_attendance_session_idx" ON "conversations" USING btree ("attendance_session_id");--> statement-breakpoint
CREATE INDEX "conversations_created_at_idx" ON "conversations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_created_at_idx" ON "messages" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_attempts_idempotency_key" ON "ticket_attempts" USING btree ("conversation_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ticket_attempts_user_success_idx" ON "ticket_attempts" USING btree ("user_id","created_at" DESC NULLS LAST) WHERE "ticket_attempts"."status" = 'success' and not "ticket_attempts"."is_test";--> statement-breakpoint
CREATE INDEX "ticket_attempts_success_created_idx" ON "ticket_attempts" USING btree ("created_at") WHERE "ticket_attempts"."status" = 'success';--> statement-breakpoint
CREATE INDEX "ticket_attempts_status_idx" ON "ticket_attempts" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_transcripts_attempt_key" ON "ticket_transcripts" USING btree ("ticket_attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_transcripts_token_hash_key" ON "ticket_transcripts" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_sub_key" ON "users" USING btree ("google_sub");