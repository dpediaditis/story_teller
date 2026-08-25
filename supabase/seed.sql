-- Local dev seed: one parent, one child, two characters (Bobo, Luna), one
-- completed ('ready') story starring Bobo. Run automatically by
-- `supabase db reset`.
--
-- Inserting into auth.users fires handle_new_auth_user(), which creates the
-- matching parent_accounts row and its one free-tier usage_records row — do
-- not insert into parent_accounts / usage_records directly here.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, is_anonymous, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'a0000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'seed-parent@papercub.test',
  crypt('papercub-seed-password', gen_salt('bf')),
  now(), false,
  '{"provider":"apple","providers":["apple"]}'::jsonb,
  '{}'::jsonb,
  '', '', '', '',
  now(), now()
);

-- handle_new_auth_user() made this row is_anonymous = false / linked_providers
-- = {} to match raw_app_meta_data above; give the seed parent a locale.
update public.parent_accounts
  set locale = 'en-GB', linked_providers = array['apple']::public.auth_provider[]
  where id = 'a0000000-0000-4000-8000-000000000001';

insert into public.child_profiles (id, parent_id, display_name, age_band)
values (
  'a0000000-0000-4000-8000-000000000002',
  'a0000000-0000-4000-8000-000000000001',
  'Mia',
  '6_7'
);

-- ── Bobo ─────────────────────────────────────────────────────────────────
insert into public.original_drawings (
  id, child_id, cutout_storage_key, captured_at, source, retention_policy,
  exif_stripped, isolation_method, isolation_confidence, face_detected,
  text_detected, width_px, height_px
) values (
  'a0000000-0000-4000-8000-000000000003',
  'a0000000-0000-4000-8000-000000000002',
  'drawings/a0000000-0000-4000-8000-000000000001/bobo/cutout.png',
  now(), 'camera', 'delete_after_cutout', true, 'vision_subject_lift', 0.94,
  false, false, 1200, 1600
);

insert into public.characters (
  id, child_id, drawing_id, name, character_type, personality_traits,
  palette, feature_anchor, status
) values (
  'a0000000-0000-4000-8000-000000000004',
  'a0000000-0000-4000-8000-000000000002',
  'a0000000-0000-4000-8000-000000000003',
  'Bobo', 'dinosaur', array['brave', 'silly'],
  array['#4CAF50', '#FFC107', '#2E7D32'],
  'stubby green dinosaur, three yellow back spikes, crayon texture', 'ready'
);

insert into public.character_assets (
  id, character_id, kind, storage_key, model_id, version, is_primary,
  width_px, height_px
) values (
  'a0000000-0000-4000-8000-000000000005',
  'a0000000-0000-4000-8000-000000000004',
  'reference_sheet',
  'character-assets/a0000000-0000-4000-8000-000000000001/bobo/reference-sheet-v1.png',
  'seed-model', 1, true, 1024, 1024
);

update public.child_profiles
  set avatar_character_id = 'a0000000-0000-4000-8000-000000000004'
  where id = 'a0000000-0000-4000-8000-000000000002';

-- ── Luna ─────────────────────────────────────────────────────────────────
-- retention_policy = keep_original requires storage_key to be present too.
insert into public.original_drawings (
  id, child_id, storage_key, cutout_storage_key, captured_at, source,
  retention_policy, exif_stripped, isolation_method, isolation_confidence,
  face_detected, text_detected, width_px, height_px
) values (
  'a0000000-0000-4000-8000-000000000006',
  'a0000000-0000-4000-8000-000000000002',
  'drawings/a0000000-0000-4000-8000-000000000001/luna/original.jpg',
  'drawings/a0000000-0000-4000-8000-000000000001/luna/cutout.png',
  now(), 'photos', 'keep_original', true, 'ink_extraction', 0.81,
  false, false, 1200, 1600
);

insert into public.characters (
  id, child_id, drawing_id, name, character_type, personality_traits,
  palette, feature_anchor, status
) values (
  'a0000000-0000-4000-8000-000000000007',
  'a0000000-0000-4000-8000-000000000002',
  'a0000000-0000-4000-8000-000000000006',
  'Luna', 'cat', array['curious', 'gentle'],
  array['#B39DDB', '#FFFFFF', '#607D8B'],
  'small purple cat, oversized ears, one white paw', 'ready'
);

insert into public.character_assets (
  id, character_id, kind, storage_key, model_id, version, is_primary,
  width_px, height_px
) values (
  'a0000000-0000-4000-8000-000000000008',
  'a0000000-0000-4000-8000-000000000007',
  'reference_sheet',
  'character-assets/a0000000-0000-4000-8000-000000000001/luna/reference-sheet-v1.png',
  'seed-model', 1, true, 1024, 1024
);

-- ── One completed short story starring Bobo ─────────────────────────────
-- STORY_SHAPE.short = 6 pages, 7 images (cover + 6). Keep in sync with
-- packages/shared/src/constants.ts.
insert into public.stories (
  id, child_id, title, theme, mood, length, status, render_technique,
  model_bundle_version, completed_at
) values (
  'a0000000-0000-4000-8000-000000000009',
  'a0000000-0000-4000-8000-000000000002',
  'Bobo and the Lost Star',
  'space', 'adventurous', 'short', 'ready', 'cutout_rerender',
  'papercub-2026.08.1', now()
);

insert into public.story_characters (story_id, character_id, role, order_index)
values (
  'a0000000-0000-4000-8000-000000000009',
  'a0000000-0000-4000-8000-000000000004',
  'lead', 0
);

insert into public.page_illustrations (
  id, story_id, page_index, storage_key, width, height, model_id,
  moderation_verdict, cost_cents
) values
  ('a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000009', 0,
   'illustrations/a0000000-0000-4000-8000-000000000001/a0000000-0000-4000-8000-000000000009/cover.png',
   1024, 1280, 'seed-model-premium', 'pass', 9),
  ('a0000000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-000000000009', 1,
   'illustrations/a0000000-0000-4000-8000-000000000001/a0000000-0000-4000-8000-000000000009/page-1.png',
   1024, 768, 'seed-model-fast', 'pass', 6),
  ('a0000000-0000-4000-8000-0000000000c2', 'a0000000-0000-4000-8000-000000000009', 2,
   'illustrations/a0000000-0000-4000-8000-000000000001/a0000000-0000-4000-8000-000000000009/page-2.png',
   1024, 768, 'seed-model-fast', 'pass', 6),
  ('a0000000-0000-4000-8000-0000000000c3', 'a0000000-0000-4000-8000-000000000009', 3,
   'illustrations/a0000000-0000-4000-8000-000000000001/a0000000-0000-4000-8000-000000000009/page-3.png',
   1024, 768, 'seed-model-fast', 'pass', 6),
  ('a0000000-0000-4000-8000-0000000000c4', 'a0000000-0000-4000-8000-000000000009', 4,
   'illustrations/a0000000-0000-4000-8000-000000000001/a0000000-0000-4000-8000-000000000009/page-4.png',
   1024, 768, 'seed-model-fast', 'pass', 6),
  ('a0000000-0000-4000-8000-0000000000c5', 'a0000000-0000-4000-8000-000000000009', 5,
   'illustrations/a0000000-0000-4000-8000-000000000001/a0000000-0000-4000-8000-000000000009/page-5.png',
   1024, 768, 'seed-model-fast', 'pass', 6),
  ('a0000000-0000-4000-8000-0000000000c6', 'a0000000-0000-4000-8000-000000000009', 6,
   'illustrations/a0000000-0000-4000-8000-000000000001/a0000000-0000-4000-8000-000000000009/page-6.png',
   1024, 768, 'seed-model-fast', 'pass', 6);

update public.stories
  set cover_asset_id = 'a0000000-0000-4000-8000-00000000000a'
  where id = 'a0000000-0000-4000-8000-000000000009';

insert into public.story_pages (
  story_id, index, text, scene_description, illustration_asset_id, status
) values
  ('a0000000-0000-4000-8000-000000000009', 1,
   'Bobo the dinosaur looked up at the night sky and saw one star had gone out.',
   'Small green dinosaur standing on a hill at night, looking up at a dark patch in a starry sky, crayon-cutout style',
   'a0000000-0000-4000-8000-0000000000c1', 'ready'),
  ('a0000000-0000-4000-8000-000000000009', 2,
   '"I will find it," said Bobo, and he packed his tiny rocket bag.',
   'Bobo packing a small cloth bag with a rocket patch on it, determined expression, crayon-cutout style',
   'a0000000-0000-4000-8000-0000000000c2', 'ready'),
  ('a0000000-0000-4000-8000-000000000009', 3,
   'He climbed aboard a paper rocket and zoomed past sleepy planets.',
   'Bobo inside a paper-cutout rocket flying past round cutout planets, motion lines, crayon-cutout style',
   'a0000000-0000-4000-8000-0000000000c3', 'ready'),
  ('a0000000-0000-4000-8000-000000000009', 4,
   'Behind a friendly moon, Bobo found the star, shy and dim.',
   'Bobo peeking behind a large cutout moon, a small dim star hiding, crayon-cutout style',
   'a0000000-0000-4000-8000-0000000000c4', 'ready'),
  ('a0000000-0000-4000-8000-000000000009', 5,
   '"Come back and shine with your friends," said Bobo, and the star smiled.',
   'Bobo gently holding out a paw toward a small star, both smiling, crayon-cutout style',
   'a0000000-0000-4000-8000-0000000000c5', 'ready'),
  ('a0000000-0000-4000-8000-000000000009', 6,
   'The star zoomed home, and the whole sky sparkled again.',
   'Wide night sky full of bright cutout stars, Bobo waving from his rocket below, crayon-cutout style',
   'a0000000-0000-4000-8000-0000000000c6', 'ready');

insert into public.narrations (
  story_id, voice_id, provider, storage_key, duration_ms, sentence_level_only, language
) values (
  'a0000000-0000-4000-8000-000000000009',
  'seed-voice-warm-en-gb', 'seed-tts',
  'narration/a0000000-0000-4000-8000-000000000001/a0000000-0000-4000-8000-000000000009/narration.mp3',
  118000, false, 'en-GB'
);

-- Reflect the completed story's cost and quota in usage_records: one story
-- used against the free tier's one-off allowance, cost settled (nothing
-- reserved), consistent with the 'done' stage settlement described in
-- docs/ARCHITECTURE.md.
update public.usage_records
  set stories_used = 1, characters_used = 2, cost_cents_accrued = 45
  where parent_id = 'a0000000-0000-4000-8000-000000000001';
