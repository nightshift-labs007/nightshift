ALTER TABLE "baskets" ADD COLUMN "why_chain" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "baskets" ADD COLUMN "why_chain_i18n" jsonb DEFAULT '{}'::jsonb NOT NULL;