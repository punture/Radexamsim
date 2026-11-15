ALTER TABLE "learning_plans" ADD COLUMN "item_states" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan_pace" text DEFAULT 'standard' NOT NULL;