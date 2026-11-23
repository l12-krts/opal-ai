CREATE TABLE "code_item" (
	"thread_id" text NOT NULL,
	"id" text NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "code_item_thread_id_id_pk" PRIMARY KEY("thread_id","id")
);
--> statement-breakpoint
CREATE TABLE "code_machine" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"os" text DEFAULT '' NOT NULL,
	"hostname" text DEFAULT '' NOT NULL,
	"projects_root" text NOT NULL,
	"token_hash" text NOT NULL,
	"agents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"runner_version" text,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_pairing" (
	"code" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_project" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"machine_id" text NOT NULL,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"is_git" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_thread" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"machine_id" text NOT NULL,
	"project_id" text,
	"title" text DEFAULT 'New thread' NOT NULL,
	"agent" text NOT NULL,
	"model" text,
	"mode" text DEFAULT 'auto' NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"cwd" text NOT NULL,
	"branch" text,
	"base_branch" text,
	"worktree" boolean DEFAULT false NOT NULL,
	"provider_session_id" text,
	"parent_thread_id" text,
	"group_id" text,
	"pr_url" text,
	"pinned_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"last_read_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "code_item" ADD CONSTRAINT "code_item_thread_id_code_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."code_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_machine" ADD CONSTRAINT "code_machine_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_pairing" ADD CONSTRAINT "code_pairing_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_project" ADD CONSTRAINT "code_project_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_project" ADD CONSTRAINT "code_project_machine_id_code_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."code_machine"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_thread" ADD CONSTRAINT "code_thread_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_thread" ADD CONSTRAINT "code_thread_machine_id_code_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."code_machine"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_thread" ADD CONSTRAINT "code_thread_project_id_code_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."code_project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "code_item_seq_idx" ON "code_item" USING btree ("thread_id","seq");--> statement-breakpoint
CREATE INDEX "code_machine_user_idx" ON "code_machine" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "code_machine_token_uq" ON "code_machine" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "code_project_user_idx" ON "code_project" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "code_project_path_uq" ON "code_project" USING btree ("machine_id","path");--> statement-breakpoint
CREATE INDEX "code_thread_user_idx" ON "code_thread" USING btree ("user_id","last_activity_at");