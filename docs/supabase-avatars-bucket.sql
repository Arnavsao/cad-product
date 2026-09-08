-- Profile-picture storage setup — run once per Supabase project.
--
-- Prerequisite: create the bucket first (Storage → New bucket):
--   name:   avatars
--   public: ON
--
-- The bucket must be PUBLIC-read because the object URL is stored in
-- `user_metadata.avatar_url` (so it rides in the access token and is mirrored
-- to `users.image_url`) and is rendered by a plain <img>. A signed URL would
-- expire while still referenced by both the token and our database.
--
-- Write access is NOT public: the policies below scope every insert/update/
-- delete to the caller's own folder, so object keys are `{auth.uid()}/{file}`
-- and one user can never overwrite another's picture. This matches the key
-- shape produced by `SupabaseAuthService.uploadAvatar()`.
--
-- Idempotent: safe to re-run.

-- Anyone may READ an avatar. Public-read is the point of the bucket; the
-- policy is still scoped to this one bucket rather than all of storage.
drop policy if exists "avatar public read" on storage.objects;
create policy "avatar public read"
  on storage.objects for select
  to public
  using (bucket_id = 'avatars');

-- A signed-in user may CREATE objects only inside their own folder.
drop policy if exists "avatar upload own folder" on storage.objects;
create policy "avatar upload own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ...and OVERWRITE only their own (the client uploads with `upsert: true`).
-- `using` gates which rows are visible to the update, `with check` gates the
-- result — both are needed, or a user could move an object out of their folder.
drop policy if exists "avatar update own folder" on storage.objects;
create policy "avatar update own folder"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ...and DELETE only their own. Used by "Remove photo" and by the best-effort
-- cleanup of the previous object after a re-upload.
drop policy if exists "avatar delete own folder" on storage.objects;
create policy "avatar delete own folder"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
