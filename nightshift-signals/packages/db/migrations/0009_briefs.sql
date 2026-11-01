CREATE TABLE "briefs" (
	"date" text NOT NULL,
	"lang" text NOT NULL,
	"script" text NOT NULL,
	"source" text NOT NULL,
	"audio" "bytea",
	"audio_mime" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "briefs_date_lang_pk" PRIMARY KEY("date","lang")
);
