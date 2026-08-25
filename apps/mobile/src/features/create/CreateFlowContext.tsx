import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { IsolateResult } from '@papercub/vision-module';
import type { StoryLength, StoryMood, StoryTheme } from '@papercub/shared';

/**
 * In-memory scratch state for one pass through the create flow (Camera →
 * Isolation → Name → Character card → Adventure → Confirm → Generating →
 * Cover reveal). Expo Router screens are separate components, so this is the
 * shared draft between them — nothing here is persisted, and it resets on
 * `reset()` once a character/story is actually created via apiClient.
 */
interface Draft {
  childId: string | null;
  capturedImageUri: string | null;
  isolation: IsolateResult | null;
  manualCropUsed: boolean;
  characterName: string;
  characterType: string | null;
  personalityTraits: string[];
  characterId: string | null;
  theme: StoryTheme | null;
  mood: StoryMood;
  length: StoryLength;
  storyId: string | null;
  jobId: string | null;
}

const initialDraft: Draft = {
  childId: null,
  capturedImageUri: null,
  isolation: null,
  manualCropUsed: false,
  characterName: '',
  characterType: null,
  personalityTraits: [],
  characterId: null,
  theme: null,
  mood: 'adventurous',
  length: 'short',
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
      reset: () => setDraft(initialDraft),
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
