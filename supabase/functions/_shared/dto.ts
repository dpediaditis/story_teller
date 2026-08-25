// Row -> wire-DTO mappers shared across functions, so the shape only exists
// in one place. Never `select *` on story_pages (leaks scene_description) —
// callers of toStoryPageDto must have selected columns explicitly.

import type { z } from 'zod';
import type { CharacterDto, JobStatusDto } from '@papercub/shared';
import { CharacterAssetDto, PageIllustrationDto, StoryPageDto } from '@papercub/shared';

type PageIllustrationDtoT = z.infer<typeof PageIllustrationDto>;
type StoryPageDtoT = z.infer<typeof StoryPageDto>;
type CharacterAssetDtoT = z.infer<typeof CharacterAssetDto>;

export function toJobStatusDto(row: {
  id: string;
  type: string;
  status: string;
  stage: string;
  pages_completed: number;
  pages_total: number;
  story_id: string | null;
  character_id: string | null;
  error_code: string | null;
  quota_refunded: boolean;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}): JobStatusDto {
  const startedAtMs = row.started_at ? Date.parse(row.started_at) : Date.parse(row.created_at);
  const endMs = row.finished_at ? Date.parse(row.finished_at) : Date.now();
  return {
    id: row.id,
    type: row.type as JobStatusDto['type'],
    status: row.status as JobStatusDto['status'],
    stage: row.stage as JobStatusDto['stage'],
    stageCopyKey: `generation.stage.${row.stage}`,
    pagesCompleted: row.pages_completed,
    pagesTotal: row.pages_total,
    storyId: row.story_id,
    characterId: row.character_id,
    errorCode: row.error_code as JobStatusDto['errorCode'],
    quotaRefunded: row.quota_refunded,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    elapsedMs: Math.max(0, endMs - startedAtMs),
  };
}

export function toPageIllustrationDto(row: {
  id: string;
  page_index: number;
  storage_key: string;
  width: number;
  height: number;
} | null): PageIllustrationDtoT | null {
  if (!row) return null;
  return {
    id: row.id,
    pageIndex: row.page_index,
    storageKey: row.storage_key,
    width: row.width,
    height: row.height,
  };
}

/** `scene_description` must never be a field on the row passed in here. */
export function toStoryPageDto(
  row: {
    id: string;
    index: number;
    text: string;
    status: string;
    regen_count: number;
  },
  illustration: Parameters<typeof toPageIllustrationDto>[0],
): StoryPageDtoT {
  return {
    id: row.id,
    index: row.index,
    text: row.text,
    status: row.status as StoryPageDtoT['status'],
    regenCount: row.regen_count,
    illustration: toPageIllustrationDto(illustration),
  };
}

export function toCharacterDto(args: {
  character: {
    id: string;
    child_id: string;
    drawing_id: string;
    name: string;
    character_type: string | null;
    personality_traits: string[];
    palette: string[];
    status: string;
    created_at: string;
    archived_at: string | null;
  };
  drawing: { cutout_storage_key: string; storage_key: string | null };
  primaryAsset: {
    id: string;
    kind: string;
    storage_key: string;
    is_primary: boolean;
    version: number;
    width_px: number;
    height_px: number;
  } | null;
  storyCount: number;
}): CharacterDto {
  const { character, drawing, primaryAsset, storyCount } = args;
  return {
    id: character.id,
    childId: character.child_id,
    drawingId: character.drawing_id,
    name: character.name,
    characterType: character.character_type,
    personalityTraits: character.personality_traits,
    palette: character.palette as CharacterDto['palette'],
    status: character.status as CharacterDto['status'],
    storyCount,
    primaryAsset: primaryAsset
      ? ({
          id: primaryAsset.id,
          kind: primaryAsset.kind,
          storageKey: primaryAsset.storage_key,
          isPrimary: primaryAsset.is_primary,
          version: primaryAsset.version,
          widthPx: primaryAsset.width_px,
          heightPx: primaryAsset.height_px,
        } as CharacterAssetDtoT)
      : null,
    cutoutStorageKey: drawing.cutout_storage_key,
    originalStorageKey: drawing.storage_key,
    createdAt: character.created_at,
    archivedAt: character.archived_at,
  };
}
