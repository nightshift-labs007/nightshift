ALTER TABLE "users" DROP CONSTRAINT "users_has_identity";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "telegram_id" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX "users_telegram_uq" ON "users" USING btree ("telegram_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_has_identity" CHECK ("users"."wallet" is not null or "users"."email" is not null or "users"."telegram_id" is not null);