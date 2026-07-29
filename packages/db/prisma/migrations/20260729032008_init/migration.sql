-- ═══════════════════════════════════════════════════════════════════
-- Extensions
-- ═══════════════════════════════════════════════════════════════════
--
-- Declared here, at the top of the first migration, rather than in an
-- out-of-band bootstrap script. Migrations must be self-sufficient: applying
-- them to an empty database has to produce a working schema, with no "and also
-- run this other thing first" step.
--
-- This is not merely tidiness. `prisma migrate diff` resets the shadow database
-- before replaying migration history, which drops any extension installed
-- outside that history — so a drift check would fail on `type "vector" does not
-- exist` even though the real database was fine.
--
-- Installed into `public` rather than a dedicated `extensions` schema, because
-- Prisma pins its session search_path from the connection string and would not
-- otherwise resolve the type.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- CreateEnum
CREATE TYPE "notification_level" AS ENUM ('info', 'success', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "department_key" AS ENUM ('ceo', 'operations', 'research', 'marketing', 'sales', 'support', 'finance', 'engineering', 'assistant');

-- CreateEnum
CREATE TYPE "run_trigger" AS ENUM ('chat', 'schedule', 'event', 'delegation', 'manual');

-- CreateEnum
CREATE TYPE "run_status" AS ENUM ('running', 'succeeded', 'failed', 'cancelled', 'awaiting_approval');

-- CreateEnum
CREATE TYPE "tool_call_status" AS ENUM ('succeeded', 'failed', 'awaiting_approval', 'rejected', 'expired');

-- CreateEnum
CREATE TYPE "risk_tier" AS ENUM ('read', 'internal', 'external', 'financial');

-- CreateEnum
CREATE TYPE "approval_status" AS ENUM ('pending', 'approved', 'rejected', 'expired');

-- CreateEnum
CREATE TYPE "message_role" AS ENUM ('user', 'assistant', 'system', 'tool');

-- CreateEnum
CREATE TYPE "goal_horizon" AS ENUM ('annual', 'quarterly', 'monthly', 'weekly');

-- CreateEnum
CREATE TYPE "goal_status" AS ENUM ('active', 'achieved', 'missed', 'abandoned');

-- CreateEnum
CREATE TYPE "kpi_direction" AS ENUM ('up', 'down');

-- CreateEnum
CREATE TYPE "task_status" AS ENUM ('backlog', 'todo', 'in_progress', 'blocked', 'in_review', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "task_priority" AS ENUM ('low', 'medium', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "report_kind" AS ENUM ('daily_brief', 'weekly_review', 'research', 'campaign', 'financial', 'incident', 'custom');

-- CreateEnum
CREATE TYPE "memory_source_kind" AS ENUM ('note', 'document', 'conversation', 'meeting', 'report', 'research', 'email', 'web', 'code');

-- CreateEnum
CREATE TYPE "memory_link_target" AS ENUM ('goal', 'task', 'department', 'report', 'run', 'contact', 'project');

-- CreateEnum
CREATE TYPE "connection_status" AS ENUM ('connected', 'disconnected', 'error', 'expired');

-- CreateTable
CREATE TABLE "workspace" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_setting" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMP(3),
    "refresh_token_expires_at" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission" (
    "id" UUID NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" TEXT,
    "department_id" UUID,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resource_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" TEXT,
    "level" "notification_level" NOT NULL DEFAULT 'info',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "key" "department_key" NOT NULL,
    "display_name" TEXT NOT NULL,
    "charter" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_config" (
    "department_id" UUID NOT NULL,
    "models" JSONB NOT NULL DEFAULT '{}',
    "tools" JSONB NOT NULL DEFAULT '[]',
    "memoryScopes" JSONB NOT NULL DEFAULT '[]',
    "maxSteps" INTEGER NOT NULL DEFAULT 12,
    "autoApprove" JSONB NOT NULL DEFAULT '["read","internal"]',

    CONSTRAINT "department_config_pkey" PRIMARY KEY ("department_id")
);

-- CreateTable
CREATE TABLE "run" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "conversation_id" UUID,
    "parent_run_id" UUID,
    "trigger" "run_trigger" NOT NULL,
    "status" "run_status" NOT NULL DEFAULT 'running',
    "objective" TEXT,
    "outcome" TEXT,
    "error" TEXT,
    "inngest_run_id" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cached_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micros" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "duration_ms" INTEGER,

    CONSTRAINT "run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_step" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "summary" TEXT,
    "cited_chunk_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "model" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cached_tokens" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration_ms" INTEGER,

    CONSTRAINT "run_step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_call" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "run_step_id" UUID,
    "tool_name" TEXT NOT NULL,
    "risk" "risk_tier" NOT NULL,
    "status" "tool_call_status" NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration_ms" INTEGER,

    CONSTRAINT "tool_call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_request" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "run_id" UUID,
    "tool_call_id" UUID,
    "status" "approval_status" NOT NULL DEFAULT 'pending',
    "risk" "risk_tier" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "requires_second_confirmation" BOOLEAN NOT NULL DEFAULT false,
    "second_confirmed_at" TIMESTAMP(3),
    "resume_event" TEXT,
    "decided_by_id" TEXT,
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "approval_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "user_id" TEXT,
    "title" TEXT,
    "summary" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" "message_role" NOT NULL,
    "content" TEXT NOT NULL,
    "parts" JSONB,
    "run_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "horizon" "goal_horizon" NOT NULL,
    "status" "goal_status" NOT NULL DEFAULT 'active',
    "owner_key" "department_key",
    "target_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "goal_id" UUID,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "direction" "kpi_direction" NOT NULL DEFAULT 'up',
    "target" DECIMAL(18,4),
    "owner_key" "department_key",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_snapshot" (
    "id" UUID NOT NULL,
    "kpi_id" UUID NOT NULL,
    "value" DECIMAL(18,4) NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "goal_id" UUID,
    "department_id" UUID,
    "created_by_department_id" UUID,
    "run_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "task_status" NOT NULL DEFAULT 'todo',
    "priority" "task_priority" NOT NULL DEFAULT 'medium',
    "due_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_dependency" (
    "task_id" UUID NOT NULL,
    "blocked_by_task_id" UUID NOT NULL,

    CONSTRAINT "task_dependency_pkey" PRIMARY KEY ("task_id","blocked_by_task_id")
);

-- CreateTable
CREATE TABLE "task_event" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "run_id" UUID,
    "kind" "report_kind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "highlights" JSONB,
    "period_start" TIMESTAMP(3),
    "period_end" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_document" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "department_id" UUID,
    "kind" "memory_source_kind" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source_ref" TEXT,
    "content_hash" TEXT NOT NULL,
    "metadata" JSONB,
    "ingested_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memory_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_chunk" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "headings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "token_count" INTEGER NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "embedding" vector(1536),
    "fts" tsvector,

    CONSTRAINT "memory_chunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_link" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "target" "memory_link_target" NOT NULL,
    "target_id" TEXT NOT NULL,
    "relation" TEXT NOT NULL DEFAULT 'mentions',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_fact" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "statement" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidence" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "observations" INTEGER NOT NULL DEFAULT 1,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_fact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_connection" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "connector_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" "connection_status" NOT NULL DEFAULT 'disconnected',
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "config" JSONB NOT NULL DEFAULT '{}',
    "last_checked_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_credential" (
    "connection_id" UUID NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "key_version" INTEGER NOT NULL DEFAULT 1,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_credential_pkey" PRIMARY KEY ("connection_id")
);

-- CreateTable
CREATE TABLE "webhook_event" (
    "id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signature_ok" BOOLEAN NOT NULL,
    "processed_at" TIMESTAMP(3),
    "error" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_slug_key" ON "workspace"("slug");

-- CreateIndex
CREATE INDEX "system_setting_workspace_id_idx" ON "system_setting"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "system_setting_workspace_id_key_key" ON "system_setting"("workspace_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_user_id_idx" ON "session"("user_id");

-- CreateIndex
CREATE INDEX "account_user_id_idx" ON "account"("user_id");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE INDEX "membership_user_id_idx" ON "membership"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "membership_workspace_id_user_id_key" ON "membership"("workspace_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_workspace_id_key_key" ON "role"("workspace_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "permission_resource_action_key" ON "permission"("resource", "action");

-- CreateIndex
CREATE INDEX "role_permission_permission_id_idx" ON "role_permission"("permission_id");

-- CreateIndex
CREATE INDEX "audit_log_workspace_id_created_at_idx" ON "audit_log"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_resource_resource_id_idx" ON "audit_log"("resource", "resource_id");

-- CreateIndex
CREATE INDEX "notification_workspace_id_read_at_created_at_idx" ON "notification"("workspace_id", "read_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "department_workspace_id_key_key" ON "department"("workspace_id", "key");

-- CreateIndex
CREATE INDEX "run_workspace_id_started_at_idx" ON "run"("workspace_id", "started_at");

-- CreateIndex
CREATE INDEX "run_department_id_started_at_idx" ON "run"("department_id", "started_at");

-- CreateIndex
CREATE INDEX "run_conversation_id_idx" ON "run"("conversation_id");

-- CreateIndex
CREATE INDEX "run_parent_run_id_idx" ON "run"("parent_run_id");

-- CreateIndex
CREATE INDEX "run_step_run_id_idx" ON "run_step"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "run_step_run_id_index_key" ON "run_step"("run_id", "index");

-- CreateIndex
CREATE INDEX "tool_call_run_id_idx" ON "tool_call"("run_id");

-- CreateIndex
CREATE INDEX "tool_call_tool_name_started_at_idx" ON "tool_call"("tool_name", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "approval_request_tool_call_id_key" ON "approval_request"("tool_call_id");

-- CreateIndex
CREATE INDEX "approval_request_workspace_id_status_created_at_idx" ON "approval_request"("workspace_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "approval_request_expires_at_idx" ON "approval_request"("expires_at");

-- CreateIndex
CREATE INDEX "conversation_workspace_id_department_id_updated_at_idx" ON "conversation"("workspace_id", "department_id", "updated_at");

-- CreateIndex
CREATE INDEX "message_conversation_id_created_at_idx" ON "message"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "goal_workspace_id_status_idx" ON "goal"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_workspace_id_key_key" ON "kpi"("workspace_id", "key");

-- CreateIndex
CREATE INDEX "kpi_snapshot_kpi_id_observed_at_idx" ON "kpi_snapshot"("kpi_id", "observed_at");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_snapshot_kpi_id_observed_at_key" ON "kpi_snapshot"("kpi_id", "observed_at");

-- CreateIndex
CREATE INDEX "task_workspace_id_status_due_at_idx" ON "task"("workspace_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "task_department_id_status_idx" ON "task"("department_id", "status");

-- CreateIndex
CREATE INDEX "task_dependency_blocked_by_task_id_idx" ON "task_dependency"("blocked_by_task_id");

-- CreateIndex
CREATE INDEX "task_event_task_id_created_at_idx" ON "task_event"("task_id", "created_at");

-- CreateIndex
CREATE INDEX "report_workspace_id_created_at_idx" ON "report"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "report_department_id_kind_created_at_idx" ON "report"("department_id", "kind", "created_at");

-- CreateIndex
CREATE INDEX "memory_document_workspace_id_kind_created_at_idx" ON "memory_document"("workspace_id", "kind", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "memory_document_workspace_id_content_hash_key" ON "memory_document"("workspace_id", "content_hash");

-- CreateIndex
CREATE INDEX "memory_chunk_workspace_id_idx" ON "memory_chunk"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "memory_chunk_document_id_index_key" ON "memory_chunk"("document_id", "index");

-- CreateIndex
CREATE INDEX "memory_link_target_target_id_idx" ON "memory_link"("target", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "memory_link_document_id_target_target_id_relation_key" ON "memory_link"("document_id", "target", "target_id", "relation");

-- CreateIndex
CREATE INDEX "memory_fact_workspace_id_confidence_idx" ON "memory_fact"("workspace_id", "confidence");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connection_workspace_id_connector_id_key" ON "integration_connection"("workspace_id", "connector_id");

-- CreateIndex
CREATE INDEX "webhook_event_processed_at_idx" ON "webhook_event"("processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_event_connection_id_external_id_key" ON "webhook_event"("connection_id", "external_id");

-- AddForeignKey
ALTER TABLE "system_setting" ADD CONSTRAINT "system_setting_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role" ADD CONSTRAINT "role_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_config" ADD CONSTRAINT "department_config_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run" ADD CONSTRAINT "run_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run" ADD CONSTRAINT "run_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run" ADD CONSTRAINT "run_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run" ADD CONSTRAINT "run_parent_run_id_fkey" FOREIGN KEY ("parent_run_id") REFERENCES "run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_step" ADD CONSTRAINT "run_step_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_call" ADD CONSTRAINT "tool_call_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_call" ADD CONSTRAINT "tool_call_run_step_id_fkey" FOREIGN KEY ("run_step_id") REFERENCES "run_step"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_tool_call_id_fkey" FOREIGN KEY ("tool_call_id") REFERENCES "tool_call"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal" ADD CONSTRAINT "goal_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi" ADD CONSTRAINT "kpi_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi" ADD CONSTRAINT "kpi_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_snapshot" ADD CONSTRAINT "kpi_snapshot_kpi_id_fkey" FOREIGN KEY ("kpi_id") REFERENCES "kpi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_created_by_department_id_fkey" FOREIGN KEY ("created_by_department_id") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_blocked_by_task_id_fkey" FOREIGN KEY ("blocked_by_task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_event" ADD CONSTRAINT "task_event_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_document" ADD CONSTRAINT "memory_document_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_document" ADD CONSTRAINT "memory_document_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_chunk" ADD CONSTRAINT "memory_chunk_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_chunk" ADD CONSTRAINT "memory_chunk_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "memory_document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_link" ADD CONSTRAINT "memory_link_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "memory_document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_fact" ADD CONSTRAINT "memory_fact_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_connection" ADD CONSTRAINT "integration_connection_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_credential" ADD CONSTRAINT "integration_credential_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_event" ADD CONSTRAINT "webhook_event_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════════
-- Memory retrieval — the part Prisma cannot express
-- ═══════════════════════════════════════════════════════════════════
--
-- Prisma emitted `embedding` and `fts` above as plain columns because
-- `Unsupported(...)` carries no expression, index type or operator class.
-- Everything that makes them useful is below.

-- ─── Full text ─────────────────────────────────────────────────────
-- `fts` becomes a stored generated column so it can never drift from the
-- content it indexes. A plain column cannot be converted in place, so it is
-- dropped and recreated — safe here because the table is created in this same
-- migration and holds no rows.
--
-- 'english' is the stemmer. unaccent is applied at query time rather than in
-- the generated expression, because an IMMUTABLE wrapper would be required here
-- and that is a foot-gun across dictionary updates.

ALTER TABLE "memory_chunk" DROP COLUMN "fts";

ALTER TABLE "memory_chunk"
  ADD COLUMN "fts" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce("content", ''))) STORED;

CREATE INDEX "memory_chunk_fts_idx" ON "memory_chunk" USING GIN ("fts");

-- ─── Semantic ──────────────────────────────────────────────────────
-- HNSW with cosine distance. Cosine matches how text-embedding-3-small is
-- trained and makes magnitude irrelevant, so a long chunk is not penalised.
--
-- m = 16 / ef_construction = 64 are pgvector's defaults and are the right
-- starting point at this corpus size; raising them costs build time and memory
-- for recall we do not yet need.

CREATE INDEX "memory_chunk_embedding_idx"
  ON "memory_chunk"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Scope filtering happens on every search, so the overlap operator needs support.
CREATE INDEX "memory_chunk_scopes_idx" ON "memory_chunk" USING GIN ("scopes");
CREATE INDEX "memory_document_scopes_idx" ON "memory_document" USING GIN ("scopes");
CREATE INDEX "memory_fact_scopes_idx" ON "memory_fact" USING GIN ("scopes");

-- Trigram index for fuzzy title lookup in the memory browser.
CREATE INDEX "memory_document_title_idx"
  ON "memory_document" USING GIN ("title" gin_trgm_ops);

-- ─── Hybrid search ─────────────────────────────────────────────────
-- Reciprocal Rank Fusion over both signals.
--
-- Why fuse rather than pick one: semantic search alone misses exact tokens
-- (a person's name, an invoice number, a flag like `--turbopack`), and keyword
-- search alone misses paraphrase ("what did we decide about pricing" against a
-- note that says "settled on EUR 49/month"). RRF combines the two by RANK
-- rather than by score, which matters because a cosine distance and a ts_rank
-- are not on comparable scales and normalising them is guesswork.
--
-- Each source contributes 1/(k + rank). k = 50 damps the top of each list so a
-- single confident-but-wrong hit cannot dominate the fused ordering.

CREATE OR REPLACE FUNCTION nexus_hybrid_search(
  p_workspace_id     uuid,
  p_query_text       text,
  p_query_embedding  vector(1536),
  p_scopes           text[] DEFAULT NULL,
  p_match_count      int    DEFAULT 10,
  p_full_text_weight float  DEFAULT 1.0,
  p_semantic_weight  float  DEFAULT 1.0,
  p_rrf_k            int    DEFAULT 50
)
RETURNS TABLE (
  id            uuid,
  document_id   uuid,
  chunk_index   int,
  content       text,
  headings      text[],
  scopes        text[],
  metadata      jsonb,
  token_count   int,
  score         double precision,
  fts_rank      int,
  semantic_rank int
)
LANGUAGE sql
STABLE
AS $$
  WITH
  -- Candidate pool from each source, deliberately wider than match_count so the
  -- fusion has something to actually fuse. Capped at 200 so a huge match_count
  -- cannot turn this into a sequential scan.
  candidate_limit AS (
    SELECT least(greatest(p_match_count, 1), 100) * 4 AS n
  ),
  scoped AS (
    SELECT c.id
    FROM memory_chunk c
    WHERE c.workspace_id = p_workspace_id
      AND (
        p_scopes IS NULL
        OR cardinality(p_scopes) = 0
        OR c.scopes && p_scopes
      )
  ),
  full_text AS (
    SELECT
      c.id,
      row_number() OVER (
        ORDER BY ts_rank_cd(c.fts, websearch_to_tsquery('english', p_query_text)) DESC, c.id
      )::int AS rank_ix
    FROM memory_chunk c
    JOIN scoped s ON s.id = c.id
    WHERE p_query_text IS NOT NULL
      AND p_query_text <> ''
      AND c.fts @@ websearch_to_tsquery('english', p_query_text)
    ORDER BY rank_ix
    LIMIT (SELECT n FROM candidate_limit)
  ),
  semantic AS (
    SELECT
      c.id,
      row_number() OVER (ORDER BY c.embedding <=> p_query_embedding, c.id)::int AS rank_ix
    FROM memory_chunk c
    JOIN scoped s ON s.id = c.id
    WHERE p_query_embedding IS NOT NULL
      AND c.embedding IS NOT NULL
    ORDER BY rank_ix
    LIMIT (SELECT n FROM candidate_limit)
  )
  SELECT
    mc.id,
    mc.document_id,
    mc."index"      AS chunk_index,
    mc.content,
    mc.headings,
    mc.scopes,
    mc.metadata,
    mc.token_count,
    (
      coalesce(1.0 / (p_rrf_k + ft.rank_ix), 0.0) * p_full_text_weight
      + coalesce(1.0 / (p_rrf_k + sm.rank_ix), 0.0) * p_semantic_weight
    )::double precision AS score,
    ft.rank_ix AS fts_rank,
    sm.rank_ix AS semantic_rank
  FROM full_text ft
  FULL OUTER JOIN semantic sm ON ft.id = sm.id
  JOIN memory_chunk mc ON mc.id = coalesce(ft.id, sm.id)
  ORDER BY score DESC, mc.id
  LIMIT least(greatest(p_match_count, 1), 100);
$$;

COMMENT ON FUNCTION nexus_hybrid_search IS
  'Hybrid retrieval over memory_chunk: full-text and vector candidates fused by Reciprocal Rank Fusion. Pass p_scopes = NULL or an empty array to search every scope.';

-- ─── Approval-gate safety net ──────────────────────────────────────
-- The executor refuses to run an external or financial tool without an approved
-- approval_request. This trigger is the second lock: a bug in that code path
-- cannot record a high-risk call as succeeded unless an approval actually
-- exists and was actually approved.
--
-- A trigger rather than a CHECK constraint because the rule spans two tables,
-- and CHECK cannot contain a subquery.

CREATE OR REPLACE FUNCTION nexus_enforce_approval_gate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.risk IN ('external', 'financial') AND NEW.status = 'succeeded' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM approval_request a
      WHERE a.tool_call_id = NEW.id
        AND a.status = 'approved'
        AND (a.requires_second_confirmation = false OR a.second_confirmed_at IS NOT NULL)
    ) THEN
      RAISE EXCEPTION
        'Refused: tool_call % is risk % and cannot be marked succeeded without an approved approval_request.',
        NEW.id, NEW.risk
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "tool_call_approval_gate"
  BEFORE INSERT OR UPDATE ON "tool_call"
  FOR EACH ROW
  EXECUTE FUNCTION nexus_enforce_approval_gate();

COMMENT ON FUNCTION nexus_enforce_approval_gate IS
  'Database-level guarantee that external and financial tool calls cannot be recorded as succeeded without an approved approval_request.';
