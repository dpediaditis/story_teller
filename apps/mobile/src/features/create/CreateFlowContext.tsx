import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { IsolateResult } from '@papercub/vision-module';
import type {
  DrawingSource,
  NarrationVoiceId,
  StoryLocale,
  StoryLength,
  StoryMood,
  StoryTheme,
} from '@papercub/shared';
import { DEFAULT_NARRATION_VOICE_ID, DEFAULT_STORY_LOCALE } from '@papercub/shared';

/**
 * In-memory scratch state for one pass through the create flow (Camera →
 * Isolation → Name → Character card → Adventure → Confirm → Generating →
 * Cover reveal). Expo Router screens are separate components, so this is the
 * shared draft between them — nothing here is persisted, and it resets on
 * `reset()` once a character/story is actually created via apiClient.
 */
interface Draft {
  childId: string | null;
  /**
   * One key per create-flow attempt, generated when the flow starts and stable
   * for its whole life — that is what makes it an idempotency key rather than a
   * request id. Regenerating it per call would defeat the point
   * (DECISIONS.md §15 finding 11): a retried create would mint a second
   * character and burn a second slot, and on the free tier that is the only
   * slot the family gets. Cleared by `reset()`, so the NEXT character is a
   * genuinely new intent and gets its own key.
   */
  idempotencyKey: string;
  capturedImageUri: string | null;
  /** Where the drawing came from. Recorded on original_drawings.source. */
  source: DrawingSource;
  /** Measured off the decoded image, never assumed. */
  capturedWidthPx: number | null;
  capturedHeightPx: number | null;
  isolation: IsolateResult | null;
  manualCropUsed: boolean;
  characterName: string;
  characterType: string | null;
  personalityTraits: string[];
  characterId: string | null;
  /** Server key for an EXISTING character's cut-out, when the flow started
   *  from the Characters tab rather than the camera. Signed for display. */
  characterCutoutKey: string | null;
  theme: StoryTheme | null;
  mood: StoryMood;
  length: StoryLength;
  voiceId: NarrationVoiceId;
  locale: StoryLocale;
  storyId: string | null;
  jobId: string | null;
}

function newIdempotencyKey(): string {
  // IdempotencyKey is min 8 / max 128 chars in the contract.
  return `char-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const initialDraft: Draft = {
  childId: null,
  idempotencyKey: newIdempotencyKey(),
  capturedImageUri: null,
  source: 'camera',
  capturedWidthPx: null,
  capturedHeightPx: null,
  isolation: null,
  manualCropUsed: false,
  characterName: '',
  characterType: null,
  personalityTraits: [],
  characterId: null,
  characterCutoutKey: null,
  theme: null,
  mood: 'adventurous',
  length: 'short',
  voiceId: DEFAULT_NARRATION_VOICE_ID,
  locale: DEFAULT_STORY_LOCALE,
  storyId: null,
  jobId: null,
};

interface CreateFlowState {
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  reset: () => void;
}

const CreateFlowCtx = createContext<CreateFlowState | null>(null);

export function CreateFlowProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const value = useMemo<CreateFlowState>(
    () => ({
      draft,
      update: (patch) => setDraft((d) => ({ ...d, ...patch })),
      // A fresh key too: reset() means "that character is done, start another",
      // which is a new intent and must not reuse the previous key.
      reset: () => setDraft({ ...initialDraft, idempotencyKey: newIdempotencyKey() }),
    }),
    [draft],
  );
  return <CreateFlowCtx.Provider value={value}>{children}</CreateFlowCtx.Provider>;
}

export function useCreateFlow() {
  const ctx = useContext(CreateFlowCtx);
  if (!ctx) throw new Error('useCreateFlow must be used within CreateFlowProvider');
  return ctx;
}
