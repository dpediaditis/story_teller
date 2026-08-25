-- OriginalDrawing — domain.ts. Split storage_key / cutout_storage_key: the
-- cut-out and the full photo have different retention rules (DECISIONS.md §10),
-- so one column cannot express both. See docs/ARCHITECTURE.md deviation #3.

create table public.original_drawings (
  id                   uuid primary key default gen_random_uuid(),
  child_id             uuid not null references public.child_profiles (id) on delete cascade,
  storage_key          text null,
  cutout_storage_key   text not null,
  captured_at          timestamptz not null,
  source               public.drawing_source not null,
  retention_policy     public.retention_policy not null,
  exif_stripped        boolean not null default false,
  isolation_method     public.isolation_method not null,
  isolation_confidence numeric not null check (isolation_confidence >= 0 and isolation_confidence <= 1),
  face_detected        boolean not null default false,
  text_detected        boolean not null default false,
  width_px             integer not null check (width_px > 0),
  height_px            integer not null check (height_px > 0),
  created_at           timestamptz not null default now(),
  deleted_at           timestamptz null,
  constraint original_drawings_storage_key_required_when_kept
    check (retention_policy <> 'keep_original' or storage_key is not null)
);

comment on column public.original_drawings.storage_key is
  'The full photo. Present only when retention_policy = keep_original.';
comment on column public.original_drawings.cutout_storage_key is
  'The isolated cut-out (PNG with alpha). Always present.';
comment on column public.original_drawings.exif_stripped is
  'Must be true before any upload. Enforced on-device; mirrored here for audit.';

create index original_drawings_child_id_idx on public.original_drawings (child_id);

alter table public.original_drawings enable row level security;

create policy "original_drawings_owner" on public.original_drawings
  for all
  using (
    child_id in (select id from public.child_profiles where parent_id = auth.uid())
  )
  with check (
    child_id in (select id from public.child_profiles where parent_id = auth.uid())
  );
