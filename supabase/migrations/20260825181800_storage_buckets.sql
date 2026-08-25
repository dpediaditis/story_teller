-- Four private storage buckets, matching packages/shared/src/storage.ts
-- STORAGE_BUCKETS. A storage_key column value is `<bucket>/<uid>/<scope>/<id>.<ext>`,
-- but within Supabase Storage the bucket is a separate dimension — the object
-- `name` (path) inside the bucket is `<uid>/<scope>/<id>.<ext>`. Policies match
-- the uid path prefix via storage.foldername(name).
--
-- All reads go through a signed URL minted by the media-sign Edge Function
-- (docs/ARCHITECTURE.md) — these policies exist so that function (running with
-- the caller's JWT) and any direct client SDK call are both scoped to the
-- caller's own uid prefix, never anyone else's.

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('drawings',          'drawings',          false, 12582912),
  ('character-assets',  'character-assets',  false, 12582912),
  ('illustrations',     'illustrations',     false, 12582912),
  ('narration',         'narration',         false, 12582912)
on conflict (id) do nothing;

create policy "drawings_owner_rw" on storage.objects
  for all
  using (bucket_id = 'drawings' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'drawings' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "character_assets_owner_rw" on storage.objects
  for all
  using (bucket_id = 'character-assets' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'character-assets' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "illustrations_owner_rw" on storage.objects
  for all
  using (bucket_id = 'illustrations' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'illustrations' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "narration_owner_rw" on storage.objects
  for all
  using (bucket_id = 'narration' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'narration' and (storage.foldername(name))[1] = auth.uid()::text);
