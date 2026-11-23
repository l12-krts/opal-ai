ALTER TABLE "conversation" DROP CONSTRAINT "conversation_agent_id_agent_id_fk";
--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "shape" text DEFAULT 'circle' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Each agent keeps one thread: its most recently used chat. Older chats with it become ordinary chats.
UPDATE "conversation" SET "agent_id" = NULL
WHERE "agent_id" IS NOT NULL
  AND "id" NOT IN (
    SELECT DISTINCT ON ("agent_id") "id" FROM "conversation"
    WHERE "agent_id" IS NOT NULL
    ORDER BY "agent_id", "updated_at" DESC
  );--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_agent_uq" ON "conversation" USING btree ("agent_id");