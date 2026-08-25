-- Extensions and closed-vocabulary enum types.
-- Every enum here mirrors packages/shared/src/enums.ts and packages/shared/src/errors.ts
-- exactly, same values, same order. Adding a value requires a new migration (append-only)
-- plus a corresponding change on the shared package side.

create extension if not exists pgcrypto;      -- gen_random_uuid()
create extension if not exists pgmq;          -- queues, see 20260825181900_pgmq_queues.sql
create extension if not exists pg_cron;       -- retention purge scheduling

-- ── Child ────────────────────────────────────────────────────────────────
-- DECISIONS.md §10 / CLAUDE.md rule 3: age BAND only. No birth date anywhere.
create type public.age_band as enum ('4_5', '6_7', '8_plus');

-- ── Drawing / character ─────────────────────────────────────────────────
create type public.drawing_source as enum ('camera', 'photos');
create type public.retention_policy as enum ('delete_after_cutout', 'keep_original');
create type public.isolation_method as enum ('vision_subject_lift', 'ink_extraction', 'manual_repair');
create type public.character_asset_kind as enum ('cutout', 'reference_sheet', 'pose', 'style_ref');
create type public.character_status as enum ('draft', 'building', 'ready', 'failed', 'archived');

-- ── Story ────────────────────────────────────────────────────────────────
create type public.story_theme as enum ('space', 'dinosaurs', 'underwater', 'magic', 'pirates', 'jungle');
create type public.story_mood as enum ('funny', 'adventurous', 'calm');
create type public.story_length as enum ('short', 'normal', 'bedtime');
create type public.story_status as enum (
  'draft', 'queued', 'generating', 'partial', 'ready', 'failed', 'deleted'
);
create type public.story_page_status as enum ('pending', 'text_ready', 'illustrating', 'ready', 'failed');
create type public.story_character_role as enum ('lead', 'companion');
create type public.render_technique as enum (
  'paper_cutout_composite', 'cutout_rerender', 'multi_reference'
);

-- ── Jobs ─────────────────────────────────────────────────────────────────
create type public.job_type as enum (
  'character_build', 'story_generate', 'page_regenerate', 'narration_generate'
);
create type public.job_status as enum (
  'queued', 'running', 'succeeded', 'failed', 'cancelled', 'dead_letter'
);
create type public.generation_stage as enum (
  'queued',
  'moderating_input',
  'analysing_drawing',
  'building_character_refs',
  'validating_request',
  'writing_story',
  'moderating_text',
  'illustrating_cover',
  'illustrating_pages',
  'moderating_images',
  'narrating',
  'assembling',
  'done'
);

-- packages/shared/src/errors.ts JobErrorCode
create type public.job_error_code as enum (
  'moderation_blocked_input_image', 'moderation_blocked_input_text',
  'moderation_blocked_output_text', 'moderation_blocked_output_image',
  'reading_level_failed', 'invalid_structured_output', 'provider_timeout',
  'provider_error', 'provider_rate_limited', 'provider_safety_refusal',
  'regen_budget_exhausted', 'cost_ceiling_exceeded', 'storage_error',
  'cancelled', 'internal'
);

-- ── Moderation (the four gates) ─────────────────────────────────────────
create type public.moderation_stage as enum ('input_image', 'input_text', 'output_text', 'output_image');
create type public.moderation_verdict as enum ('pass', 'flag', 'block');
create type public.moderation_subject_type as enum (
  'original_drawing', 'character_cutout', 'character_name', 'character_traits',
  'story_request', 'story_page_text', 'page_illustration', 'narration'
);
create type public.moderation_action as enum (
  'none', 'soft_retry', 'blocked_and_refunded', 'blocked_story_failed',
  'name_rejected', 'trait_dropped'
);

-- ── Money ────────────────────────────────────────────────────────────────
create type public.entitlement_tier as enum ('free', 'family');
create type public.product_id as enum (
  'papercub_family_monthly', 'papercub_family_annual', 'papercub_topup_3'
);
create type public.subscription_status as enum (
  'none', 'active', 'in_grace_period', 'in_billing_retry', 'expired', 'revoked', 'paused'
);
create type public.store_environment as enum ('sandbox', 'production');
create type public.quota_block_reason as enum (
  'story_quota_exhausted',
  'character_quota_exhausted',
  'cost_ceiling_reached',
  'global_spend_halt',
  'rate_limited',
  'free_tier_consumed'
);

-- ── Auth / account merge ─────────────────────────────────────────────────
create type public.auth_provider as enum ('anonymous', 'apple', 'google');
create type public.merge_strategy as enum ('merge', 'keep_account_only');
