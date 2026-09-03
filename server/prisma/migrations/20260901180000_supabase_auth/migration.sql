-- Clerk -> Supabase auth.
--
-- `users.clerk_id` held Clerk ids (`user_…`); Supabase issues UUIDs, so no
-- existing row could ever match a Supabase sign-in again. Truncating is the
-- deliberate choice for pre-release data: the alternative is a dead row per old
-- user with their drawings orphaned behind it.
--
-- CASCADE clears user_preferences, folders, drawings, drawing_versions,
-- share_links and notifications. `feedback.user_id` is ON DELETE SET NULL, so
-- feedback survives as anonymous rather than being destroyed.
TRUNCATE TABLE "users" CASCADE;

-- Rename in place (not drop/add) so the column keeps its type and NOT NULL.
ALTER TABLE "users" RENAME COLUMN "clerk_id" TO "auth_id";
ALTER INDEX "users_clerk_id_key" RENAME TO "users_auth_id_key";

-- The Svix idempotency ledger has no producer left: Supabase has no outbound
-- user webhook, so profile changes are mirrored from the access token instead.
DROP TABLE IF EXISTS "webhook_events";
