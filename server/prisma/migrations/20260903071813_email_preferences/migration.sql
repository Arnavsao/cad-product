-- Per-type email opt-outs on `user_preferences`.
--
-- Additive and safe on a populated database: two columns with NOT NULL DEFAULT
-- true, so existing rows are backfilled to "yes, send me this" in place — the
-- right default, because a user who has never opened Settings should still hear
-- that something was shared with them.
--
-- Two typed booleans rather than one JSON blob: both are read on the send path
-- (`MailService.wants`), where a column is cheaper than parsing JSON and cannot
-- be typo'd. Organization INVITATIONS are gated by neither — see `MailService`.

-- AlterTable
ALTER TABLE "user_preferences" ADD COLUMN     "email_on_org_activity" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "email_on_share" BOOLEAN NOT NULL DEFAULT true;
