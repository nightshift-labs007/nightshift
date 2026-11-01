CREATE TABLE "live_activities" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"basket_id" text NOT NULL,
	"platform" text NOT NULL,
	"push_token" text NOT NULL,
	"last_sent_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "live_activities" ADD CONSTRAINT "live_activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_activities" ADD CONSTRAINT "live_activities_basket_id_baskets_id_fk" FOREIGN KEY ("basket_id") REFERENCES "public"."baskets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "live_activities_token_basket_uq" ON "live_activities" USING btree ("push_token","basket_id");--> statement-breakpoint
CREATE INDEX "live_activities_basket_idx" ON "live_activities" USING btree ("basket_id");