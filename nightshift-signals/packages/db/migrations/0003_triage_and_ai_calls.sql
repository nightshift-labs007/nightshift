CREATE TABLE "ai_calls" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"event_id" text,
	"user_prompt" text NOT NULL,
	"output" jsonb,
	"stop_reason" text,
	"error" text,
	"latency_ms" integer,
	"usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "corroborated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "ai_calls_event_idx" ON "ai_calls" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "ai_calls_created_idx" ON "ai_calls" USING btree ("created_at");