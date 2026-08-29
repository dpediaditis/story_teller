-- Narration voice becomes a per-story choice, gated by tier.
--
-- Until now the voice was hardcoded in services/worker (`papercub_default`).
-- Premium voices are a subscription benefit, so the CHOICE has to be recorded on
-- the story and the ENTITLEMENT enforced where it cannot be bypassed.
-- DECISIONS.md §8: the client never asserts entitlement, so the check lives in
-- `claim_story_quota` next to the story-length check — see the NEXT migration,
-- which carries the function body.
--
-- WHY THE FUNCTION IS NOT IN THIS FILE: it was, and it shipped a regression.
-- The body was rebuilt from 20260826120000, which predates the free-story
-- bypass fix in 20260826130000, so it silently reverted it and a free account
-- could claim unlimited stories. Caught live within minutes. The function now
-- lives in exactly one later migration so there is no stale copy in this repo
-- for anyone to rebuild from again. See DECISIONS.md §21.

create type public.narration_voice as enum (
  'papercub_default',
  'papercub_bramble',
  'papercub_pip',
  'papercub_juniper',
  'papercub_marlow',
  'papercub_fig'
);

alter table public.stories
  add column if not exists voice_id public.narration_voice not null default 'papercub_default';

comment on column public.stories.voice_id is
  'Narration voice, chosen at claim time and validated against the tier there. '
  'Free tier is papercub_default only (packages/shared/src/voices.ts).';
