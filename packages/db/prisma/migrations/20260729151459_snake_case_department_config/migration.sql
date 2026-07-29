-- Bring department_config in line with the schema's stated convention.
--
-- The schema header says snake_case in the database, camelCase in TypeScript,
-- enforced by @map everywhere. These three columns were missed, which left the
-- convention documented but not true — worse than having no convention, because
-- every future query written from the schema would have been wrong.

ALTER TABLE "department_config" RENAME COLUMN "memoryScopes" TO "memory_scopes";
ALTER TABLE "department_config" RENAME COLUMN "maxSteps" TO "max_steps";
ALTER TABLE "department_config" RENAME COLUMN "autoApprove" TO "auto_approve";