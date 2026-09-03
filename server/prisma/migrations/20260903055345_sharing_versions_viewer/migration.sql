-- Sharing (people + organizations), the read-only `viewer` role, and the index
-- the share dialog's link list reads.
--
-- Additive only: no column is dropped or retyped, so it is safe to apply to a
-- database that already holds drawings.

-- AlterEnum
--
-- `BEFORE 'member'` keeps the Postgres enum sort order aligned with privilege
-- (`ORDER BY role DESC` in `listMembers` must still put owners first and
-- viewers last). Adding the value is legal inside Prisma's transaction because
-- nothing in this migration *uses* it.
ALTER TYPE "org_role" ADD VALUE 'viewer' BEFORE 'member';

-- CreateTable
CREATE TABLE "shares" (
    "id" TEXT NOT NULL,
    "drawing_id" TEXT,
    "folder_id" TEXT,
    "target_email" TEXT,
    "target_organization_id" TEXT,
    "permission" "share_permission" NOT NULL DEFAULT 'view',
    "created_by_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shares_drawing_id_idx" ON "shares"("drawing_id");

-- CreateIndex
CREATE INDEX "shares_folder_id_idx" ON "shares"("folder_id");

-- CreateIndex
CREATE INDEX "shares_target_email_idx" ON "shares"("target_email");

-- CreateIndex
CREATE INDEX "shares_target_organization_id_idx" ON "shares"("target_organization_id");

-- CreateIndex
CREATE INDEX "share_links_drawing_id_revoked_at_idx" ON "share_links"("drawing_id", "revoked_at");

-- AddForeignKey
ALTER TABLE "shares" ADD CONSTRAINT "shares_drawing_id_fkey" FOREIGN KEY ("drawing_id") REFERENCES "drawings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shares" ADD CONSTRAINT "shares_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shares" ADD CONSTRAINT "shares_target_organization_id_fkey" FOREIGN KEY ("target_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shares" ADD CONSTRAINT "shares_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written invariants Prisma cannot express (`prisma db pull` will not
-- round-trip them; see the note on the `Share` model in schema.prisma).
-- ---------------------------------------------------------------------------

-- Exactly one subject and exactly one target. Without these a row could grant
-- nothing (all NULL) or grant a drawing *and* a folder at once, and every
-- reader would have to defend against both shapes.
ALTER TABLE "shares" ADD CONSTRAINT "shares_one_subject"
  CHECK (("drawing_id" IS NOT NULL) <> ("folder_id" IS NOT NULL));

ALTER TABLE "shares" ADD CONSTRAINT "shares_one_target"
  CHECK (("target_email" IS NOT NULL) <> ("target_organization_id" IS NOT NULL));

-- One live grant per (subject, target): these four partial unique indexes are
-- what make `PUT /drawings/:id/shares` an upsert — re-sharing with the same
-- person changes the permission instead of stacking a second row that would
-- silently win on a `MAX`.
CREATE UNIQUE INDEX "shares_drawing_email_key"
  ON "shares" ("drawing_id", "target_email")
  WHERE "drawing_id" IS NOT NULL AND "target_email" IS NOT NULL;

CREATE UNIQUE INDEX "shares_drawing_org_key"
  ON "shares" ("drawing_id", "target_organization_id")
  WHERE "drawing_id" IS NOT NULL AND "target_organization_id" IS NOT NULL;

CREATE UNIQUE INDEX "shares_folder_email_key"
  ON "shares" ("folder_id", "target_email")
  WHERE "folder_id" IS NOT NULL AND "target_email" IS NOT NULL;

CREATE UNIQUE INDEX "shares_folder_org_key"
  ON "shares" ("folder_id", "target_organization_id")
  WHERE "folder_id" IS NOT NULL AND "target_organization_id" IS NOT NULL;
