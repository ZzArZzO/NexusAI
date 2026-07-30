-- Department domain tables: sales, marketing, support, finance, engineering,
-- assistant and research.
--
-- IMPORTANT — three statements were removed from the generated output by hand:
--
--   DROP INDEX "memory_chunk_embedding_idx";
--   DROP INDEX "memory_chunk_fts_idx";
--   ALTER TABLE "memory_chunk" ALTER COLUMN "fts" DROP DEFAULT;
--
-- prisma migrate diff emits those because the HNSW index, the GIN index on the
-- generated tsvector, and the generated-column expression cannot be represented
-- in schema.prisma — so from Prisma's point of view they are divergence to
-- reconcile. Applying them would silently destroy hybrid retrieval: searches
-- would keep working and quietly fall back to a sequential scan with no fts
-- column to match against.
--
-- This is the same divergence recorded in prisma/expected-drift.txt. Any future
-- migration generated this way needs the same three lines removed. If that ever
-- gets forgotten, pnpm db:migrate:check fails, because the snapshot no longer
-- matches.
-- CreateEnum
CREATE TYPE "deal_stage" AS ENUM ('lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost');

-- CreateEnum
CREATE TYPE "content_status" AS ENUM ('idea', 'drafting', 'review', 'approved', 'scheduled', 'published', 'archived');

-- CreateEnum
CREATE TYPE "ticket_status" AS ENUM ('open', 'waiting_on_customer', 'waiting_on_us', 'escalated', 'resolved', 'closed');

-- DropIndex

-- DropIndex

-- AlterTable

-- CreateTable
CREATE TABLE "company" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "industry" TEXT,
    "size" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "company_id" UUID,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "role" TEXT,
    "linkedin_url" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "score_reason" TEXT,
    "source" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "company_id" UUID,
    "contact_id" UUID,
    "title" TEXT NOT NULL,
    "stage" "deal_stage" NOT NULL DEFAULT 'lead',
    "value_cents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "probability" INTEGER NOT NULL DEFAULT 10,
    "expected_close_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "lost_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "contact_id" UUID,
    "deal_id" UUID,
    "kind" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'internal',
    "summary" TEXT NOT NULL,
    "body" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequence" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequence_step" (
    "id" UUID NOT NULL,
    "sequence_id" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "delayDays" INTEGER NOT NULL DEFAULT 3,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "subject" TEXT,
    "body" TEXT NOT NULL,

    CONSTRAINT "sequence_step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequence_enrollment" (
    "id" UUID NOT NULL,
    "sequence_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "current_step" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "next_due_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sequence_enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "goal_id" UUID,
    "name" TEXT NOT NULL,
    "brief" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "budget_cents" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_item" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "campaign_id" UUID,
    "format" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "hook" TEXT,
    "call_to_action" TEXT,
    "status" "content_status" NOT NULL DEFAULT 'idea',
    "published_at" TIMESTAMP(3),
    "external_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_slot" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "content_item_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_slot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_metric" (
    "id" UUID NOT NULL,
    "content_item_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "engagements" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "observed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_metric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "contact_id" UUID,
    "subject" TEXT NOT NULL,
    "status" "ticket_status" NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "escalation_reason" TEXT,
    "summary" TEXT,
    "first_reply_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_message" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "author" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "is_draft" BOOLEAN NOT NULL DEFAULT false,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_article" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kb_article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_account" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'bank',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "balance_cents" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "account_id" UUID,
    "direction" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "description" TEXT NOT NULL,
    "category" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "external_id" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "anomaly_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "interval" TEXT NOT NULL DEFAULT 'monthly',
    "direction" TEXT NOT NULL DEFAULT 'out',
    "next_charge_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "limit_cents" INTEGER NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'monthly',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forecast" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "metric" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 50,
    "method" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forecast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repository" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'github',
    "default_branch" TEXT NOT NULL DEFAULT 'main',
    "local_path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pull_request_review" (
    "id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "run_id" UUID,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "verdict" TEXT NOT NULL DEFAULT 'comment',
    "findings" JSONB,
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pull_request_review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'investigating',
    "severity" TEXT NOT NULL DEFAULT 'minor',
    "summary" TEXT,
    "root_cause" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_event" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "attendees" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "external_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "note" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'note',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "memory_document_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "notified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "report_id" UUID,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "excerpt" TEXT,
    "retrieved_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_workspace_id_idx" ON "company"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_workspace_id_name_key" ON "company"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "contact_workspace_id_score_idx" ON "contact"("workspace_id", "score");

-- CreateIndex
CREATE UNIQUE INDEX "contact_workspace_id_email_key" ON "contact"("workspace_id", "email");

-- CreateIndex
CREATE INDEX "deal_workspace_id_stage_idx" ON "deal"("workspace_id", "stage");

-- CreateIndex
CREATE INDEX "deal_workspace_id_expected_close_at_idx" ON "deal"("workspace_id", "expected_close_at");

-- CreateIndex
CREATE INDEX "activity_workspace_id_occurred_at_idx" ON "activity"("workspace_id", "occurred_at");

-- CreateIndex
CREATE INDEX "activity_contact_id_occurred_at_idx" ON "activity"("contact_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "sequence_workspace_id_name_key" ON "sequence"("workspace_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "sequence_step_sequence_id_index_key" ON "sequence_step"("sequence_id", "index");

-- CreateIndex
CREATE INDEX "sequence_enrollment_status_next_due_at_idx" ON "sequence_enrollment"("status", "next_due_at");

-- CreateIndex
CREATE UNIQUE INDEX "sequence_enrollment_sequence_id_contact_id_key" ON "sequence_enrollment"("sequence_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_workspace_id_name_key" ON "campaign"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "content_item_workspace_id_status_idx" ON "content_item"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "content_item_workspace_id_published_at_idx" ON "content_item"("workspace_id", "published_at");

-- CreateIndex
CREATE INDEX "schedule_slot_workspace_id_scheduled_for_idx" ON "schedule_slot"("workspace_id", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "content_metric_content_item_id_channel_observed_at_key" ON "content_metric"("content_item_id", "channel", "observed_at");

-- CreateIndex
CREATE INDEX "ticket_workspace_id_status_updated_at_idx" ON "ticket"("workspace_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "ticket_message_ticket_id_created_at_idx" ON "ticket_message"("ticket_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "kb_article_workspace_id_title_key" ON "kb_article"("workspace_id", "title");

-- CreateIndex
CREATE UNIQUE INDEX "financial_account_workspace_id_name_key" ON "financial_account"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "transaction_workspace_id_occurred_at_idx" ON "transaction"("workspace_id", "occurred_at");

-- CreateIndex
CREATE INDEX "transaction_workspace_id_direction_occurred_at_idx" ON "transaction"("workspace_id", "direction", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_workspace_id_source_external_id_key" ON "transaction"("workspace_id", "source", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_workspace_id_name_key" ON "subscription"("workspace_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "budget_workspace_id_category_period_key" ON "budget"("workspace_id", "category", "period");

-- CreateIndex
CREATE INDEX "forecast_workspace_id_metric_period_start_idx" ON "forecast"("workspace_id", "metric", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "repository_workspace_id_full_name_key" ON "repository"("workspace_id", "full_name");

-- CreateIndex
CREATE UNIQUE INDEX "pull_request_review_repository_id_number_created_at_key" ON "pull_request_review"("repository_id", "number", "created_at");

-- CreateIndex
CREATE INDEX "incident_workspace_id_status_idx" ON "incident"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "calendar_event_workspace_id_starts_at_idx" ON "calendar_event"("workspace_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_event_workspace_id_external_id_key" ON "calendar_event"("workspace_id", "external_id");

-- CreateIndex
CREATE INDEX "note_workspace_id_created_at_idx" ON "note"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "reminder_workspace_id_due_at_completed_at_idx" ON "reminder"("workspace_id", "due_at", "completed_at");

-- CreateIndex
CREATE INDEX "source_workspace_id_retrieved_at_idx" ON "source"("workspace_id", "retrieved_at");

-- AddForeignKey
ALTER TABLE "company" ADD CONSTRAINT "company_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact" ADD CONSTRAINT "contact_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact" ADD CONSTRAINT "contact_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal" ADD CONSTRAINT "deal_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal" ADD CONSTRAINT "deal_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal" ADD CONSTRAINT "deal_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence" ADD CONSTRAINT "sequence_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_step" ADD CONSTRAINT "sequence_step_sequence_id_fkey" FOREIGN KEY ("sequence_id") REFERENCES "sequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_enrollment" ADD CONSTRAINT "sequence_enrollment_sequence_id_fkey" FOREIGN KEY ("sequence_id") REFERENCES "sequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_enrollment" ADD CONSTRAINT "sequence_enrollment_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_item" ADD CONSTRAINT "content_item_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_item" ADD CONSTRAINT "content_item_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_slot" ADD CONSTRAINT "schedule_slot_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_slot" ADD CONSTRAINT "schedule_slot_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_metric" ADD CONSTRAINT "content_metric_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_message" ADD CONSTRAINT "ticket_message_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_article" ADD CONSTRAINT "kb_article_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_account" ADD CONSTRAINT "financial_account_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget" ADD CONSTRAINT "budget_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast" ADD CONSTRAINT "forecast_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repository" ADD CONSTRAINT "repository_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pull_request_review" ADD CONSTRAINT "pull_request_review_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident" ADD CONSTRAINT "incident_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note" ADD CONSTRAINT "note_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder" ADD CONSTRAINT "reminder_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source" ADD CONSTRAINT "source_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source" ADD CONSTRAINT "source_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "report"("id") ON DELETE SET NULL ON UPDATE CASCADE;
