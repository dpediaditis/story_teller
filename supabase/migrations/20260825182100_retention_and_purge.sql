-- Soft-delete purge, per RETENTION_DAYS in packages/shared/src/constants.ts:
--   characterAssetsAfterSoftDelete: 30  -- character_assets of an archived character
--   accountHardDelete: 30               -- parent_accounts.deleted_at
--   orphanedAnonymousContent: 30        -- also parent_accounts.deleted_at, set by
--                                          merge_accounts('keep_account_only') —
--                                          DECISIONS.md §12a adds no new schema
--                                          state, so it reuses the same column
--                                          and the same purge path.
--   promptDebugArtefacts: 30            -- NOT represented: no table in domain.ts
--                                          holds prompt debug artefacts. Those
--                                          live wherever services/worker logs
--                                          them, outside B1's schema. Flagged in
--                                          the handover report, not invented here.
--
-- NOTE: all four figures happen to be 30 days today. Each purge step below
-- uses its own named constant in the function body so a future divergence in
-- constants.ts only requires editing one line, not re-deriving the logic.

create or replace function public.purge_expired_soft_deletes()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c_character_assets_after_archive_days constant integer := 30;
  c_account_hard_delete_days            constant integer := 30;
begin
  -- character_assets of a character archived long enough ago.
  delete from public.character_assets ca
  using public.characters c
  where ca.character_id = c.id
    and c.archived_at is not null
    and c.archived_at < now() - make_interval(days => c_character_assets_after_archive_days);

  -- parent_accounts soft-deleted (directly, or retired by merge_accounts)
  -- long enough ago. Cascades: child_profiles -> original_drawings ->
  -- characters -> character_assets, stories -> story_characters /
  -- story_pages / page_illustrations -> narrations, generation_jobs,
  -- subscriptions, usage_records, moderation_events, worlds -> world_facts /
  -- places. auth.users is the root FK, deleting it cascades into
  -- parent_accounts too, but we drive this from parent_accounts since that is
  -- the column this schema controls.
  delete from auth.users u
  using public.parent_accounts pa
  where u.id = pa.id
    and pa.deleted_at is not null
    and pa.deleted_at < now() - make_interval(days => c_account_hard_delete_days);
end;
$$;

revoke all on function public.purge_expired_soft_deletes() from public;
grant execute on function public.purge_expired_soft_deletes() to postgres, service_role;

-- Daily at 03:17 UTC — off the hour, avoiding the thundering-herd of jobs
-- scheduled exactly on the hour.
select cron.schedule(
  'papercub-purge-expired-soft-deletes',
  '17 3 * * *',
  $$select public.purge_expired_soft_deletes();$$
);
