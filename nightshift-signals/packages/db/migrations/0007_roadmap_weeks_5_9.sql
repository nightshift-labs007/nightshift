CREATE TYPE "public"."vote" AS ENUM('follow', 'fade');--> statement-breakpoint
CREATE TABLE "category_overrides" (
	"category" "category" PRIMARY KEY NOT NULL,
	"disabled" boolean NOT NULL,
	"reason" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"min_severity" smallint DEFAULT 3 NOT NULL,
	"categories" "category"[] DEFAULT '{}' NOT NULL,
	"drift" boolean DEFAULT false NOT NULL,
	"receipts" boolean DEFAULT true NOT NULL,
	"quiet_start" smallint,
	"quiet_end" smallint,
	"tz" text DEFAULT 'UTC' NOT NULL,
	"lang" text DEFAULT 'en' NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"basket_id" text NOT NULL,
	"user_id" text NOT NULL,
	"vote" "vote" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "votes_basket_id_user_id_pk" PRIMARY KEY("basket_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "graded_ret_pct" numeric(20, 10);--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "graded_vs_spy_pct" numeric(20, 10);--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "graded_pnl_usdg" numeric(38, 18);--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "graded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "handle" text;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_basket_id_baskets_id_fk" FOREIGN KEY ("basket_id") REFERENCES "public"."baskets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "push_endpoint_uq" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "push_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "positions_graded_idx" ON "positions" USING btree ("graded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_handle_uq" ON "users" USING btree (lower("handle"));