ALTER TABLE "tokens" ADD COLUMN "pool_fee" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "baskets_one_live_per_event" ON "baskets" USING btree ("event_id") WHERE "baskets"."status" <> 'void';