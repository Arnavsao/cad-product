-- Organizations, and real name uniqueness for drawings.
--
-- Two changes that have to land together, because the second one's uniqueness
-- key includes the column the first one adds:
--
--   1. Organizations: `organizations` + `org_memberships` + `org_invites`, and a
--      nullable `organization_id` on `folders`/`drawings`. NULL means the
--      owner's personal workspace (every existing row), so the backfill is a
--      no-op. `owner_id` keeps meaning "creator" and still roots the storage
--      prefix `users/{owner_id}/...`, so nothing has to be copied in S3.
--
--   2. Sibling-name uniqueness, which the schema never had for drawings. It is
--      expressed as partial expression indexes rather than Prisma `@@unique`
--      because none of the three things it needs are expressible there:
--        - the key changes per workspace (`owner_id` vs `organization_id`);
--        - `COALESCE(folder_id, '')`, because a plain index over a nullable
--          column lets unlimited rows share a name at the root (SQL treats
--          every NULL as distinct — the same trap documented in
--          `FoldersService`, which is why that service pre-checks by hand);
--        - `WHERE deleted_at IS NULL`, so binning a drawing frees its name.
--
-- `folders_owner_id_parent_id_name_key` is dropped for the same reason: keyed on
-- `owner_id` alone it would report a false conflict between a user's personal
-- "Site plans" and an identically-named folder in an org they belong to, while
-- still failing to catch two *different* members colliding inside one org.

-- ---------------------------------------------------------------------------
-- 1. Organizations
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "org_role" AS ENUM ('member', 'admin', 'owner');

-- AlterTable
ALTER TABLE "drawings" ADD COLUMN     "organization_id" TEXT;

-- AlterTable
ALTER TABLE "folders" ADD COLUMN     "organization_id" TEXT;

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "join_code" TEXT NOT NULL,
    "image_url" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_memberships" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "org_role" NOT NULL DEFAULT 'member',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_invites" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "org_role" NOT NULL DEFAULT 'member',
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_join_code_key" ON "organizations"("join_code");

-- CreateIndex
CREATE INDEX "org_memberships_user_id_idx" ON "org_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "org_memberships_organization_id_user_id_key" ON "org_memberships"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "org_invites_token_key" ON "org_invites"("token");

-- CreateIndex
CREATE INDEX "org_invites_organization_id_idx" ON "org_invites"("organization_id");

-- CreateIndex
CREATE INDEX "org_invites_email_idx" ON "org_invites"("email");

-- CreateIndex
CREATE UNIQUE INDEX "org_invites_organization_id_email_key" ON "org_invites"("organization_id", "email");

-- CreateIndex
CREATE INDEX "drawings_organization_id_updated_at_idx" ON "drawings"("organization_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "drawings_organization_id_last_opened_at_idx" ON "drawings"("organization_id", "last_opened_at" DESC);

-- CreateIndex
CREATE INDEX "drawings_organization_id_deleted_at_idx" ON "drawings"("organization_id", "deleted_at");

-- CreateIndex
CREATE INDEX "folders_organization_id_parent_id_idx" ON "folders"("organization_id", "parent_id");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_invites" ADD CONSTRAINT "org_invites_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_invites" ADD CONSTRAINT "org_invites_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folders" ADD CONSTRAINT "folders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drawings" ADD CONSTRAINT "drawings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. De-duplicate existing names
--
-- Nothing stopped duplicates before this migration, so any that exist have to
-- be renamed before the unique indexes can be built — otherwise CREATE UNIQUE
-- INDEX aborts and the whole migration rolls back.
--
-- Oldest row of each group keeps the bare name; the rest get " (2)", " (3)" …
-- in `created_at` order. The suffix is chosen to match what the API now hands
-- back for a colliding create, so the two are indistinguishable after the fact.
-- The `WHERE rn > 1` means the common case (no duplicates) updates no rows.
-- ---------------------------------------------------------------------------

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "owner_id", COALESCE("organization_id", ''), COALESCE("folder_id", ''), "name"
      ORDER BY "created_at", "id"
    ) AS rn
  FROM "drawings"
  WHERE "deleted_at" IS NULL
)
UPDATE "drawings" AS d
SET "name" = d."name" || ' (' || ranked.rn || ')'
FROM ranked
WHERE d."id" = ranked."id" AND ranked.rn > 1;

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "owner_id", COALESCE("organization_id", ''), COALESCE("parent_id", ''), "name"
      ORDER BY "created_at", "id"
    ) AS rn
  FROM "folders"
)
UPDATE "folders" AS f
SET "name" = f."name" || ' (' || ranked.rn || ')'
FROM ranked
WHERE f."id" = ranked."id" AND ranked.rn > 1;

-- ---------------------------------------------------------------------------
-- 3. Name uniqueness
--
-- Two indexes per table, one per workspace kind, so a personal "Site plan" and
-- an org "Site plan" never collide while two members of one org do. Services
-- still pre-check to return a friendly 409 `NAME_TAKEN`; these indexes are the
-- backstop that makes the check race-proof.
-- ---------------------------------------------------------------------------

DROP INDEX "folders_owner_id_parent_id_name_key";

CREATE UNIQUE INDEX "drawings_personal_name_key"
  ON "drawings" ("owner_id", COALESCE("folder_id", ''), "name")
  WHERE "organization_id" IS NULL AND "deleted_at" IS NULL;

CREATE UNIQUE INDEX "drawings_org_name_key"
  ON "drawings" ("organization_id", COALESCE("folder_id", ''), "name")
  WHERE "organization_id" IS NOT NULL AND "deleted_at" IS NULL;

CREATE UNIQUE INDEX "folders_personal_name_key"
  ON "folders" ("owner_id", COALESCE("parent_id", ''), "name")
  WHERE "organization_id" IS NULL;

CREATE UNIQUE INDEX "folders_org_name_key"
  ON "folders" ("organization_id", COALESCE("parent_id", ''), "name")
  WHERE "organization_id" IS NOT NULL;
