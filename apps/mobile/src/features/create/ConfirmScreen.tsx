import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { NARRATION_VOICE_LIST, STORY_SHAPE, isVoiceAllowedForTier } from '@papercub/shared';
import { Screen, Text, TopBar, Button, EyebrowLabel } from '../../components';
import { useCreateFlow } from './CreateFlowContext';
import { useSession } from '../session/SessionProvider';
import { apiClient, ApiCallError, errorCopy } from '../../lib/api';
import { colour, inkAlpha, radius, spacing } from '../../theme';

const THEME_LABEL: Record<string, string> = {
  space: 'Space',
  dinosaurs: 'Dinosaurs',
  underwater: 'Underwater',
  magic: 'Magic',
  pirates: 'Pirates',
  jungle: 'Jungle',
};

/** C2 — Confirm. */
export function ConfirmScreen() {
  const { draft, update } = useCreateFlow();
  const { session, refresh } = useSession();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shape = STORY_SHAPE[draft.length];
  const isFreeStory = session?.quota.freeTierConsumed === false && session.entitlement.tier === 'free';
  // Straight from the server's session — the client never decides this.
  const tier = session?.entitlement.tier === 'family' ? 'family' : 'free';

  async function makeStory() {
    if (!draft.characterId || !draft.theme) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiClient.call('createStory', {
        voiceId: draft.voiceId,
        childId: session?.children[0]?.id ?? '',
        characters: [{ characterId: draft.characterId, role: 'lead' }],
        theme: draft.theme,
        mood: draft.mood,
        length: draft.length,
        idempotencyKey: `create-story-${draft.characterId}-${Date.now()}`,
      });
      update({ storyId: res.story.id, jobId: res.job.id });
      await refresh();
      router.push('/create/generating');
    } catch (err) {
      if (err instanceof ApiCallError) {
        if (err.apiError.code === 'quota_exceeded' || err.apiError.code === 'cost_ceiling_exceeded') {
          router.push('/paywall/quota-reached');
          return;
        }
        setError(errorCopy(err.apiError.copyKey));
      } else {
        setError(errorCopy(undefined));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <TopBar onBack={() => router.back()} />
      <View style={styles.body}>
        <Text variant="sectionHeading">
          {/* Fallback matches AdventureScreen's. Without it an empty name
              renders a leading space and the sentence starts mid-air. */}
          {draft.characterName || 'Your character'} goes to{' '}
          {THEME_LABEL[draft.theme ?? 'space']} — a {draft.length} {draft.mood} story.
        </Text>

        <View style={styles.card}>
          <Row label="Pages" value={String(shape.pageCount)} />
          <Row label="Read aloud" value="Included" />
          <Row label="Usually takes" value="About a minute" />
        </View>

        {/* VOICE. The lock is drawn from the shared catalogue, but it is not
            what enforces anything — claim_story_quota re-checks the tier in SQL
            and refuses, so a client that ignored this could still not get a
            premium voice (DECISIONS.md §8). */}
        <EyebrowLabel style={{ marginTop: spacing.section }}>READ ALOUD BY</EyebrowLabel>
        <ScrollView
          horizontal
          style={{ flexGrow: 0 }}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.voiceRow}
        >
          {NARRATION_VOICE_LIST.map((voice) => {
            const unlocked = isVoiceAllowedForTier(voice.id, tier);
            const selected = draft.voiceId === voice.id;
            return (
              <Pressable
                key={voice.id}
                onPress={() =>
                  unlocked
                    ? update({ voiceId: voice.id })
                    : // Locked voices are a reason to show the paywall, not a
                      // dead tap. The story config survives — the draft is
                      // untouched, so coming back lands here unchanged.
                      router.push('/paywall')
                }
                style={[styles.voice, selected && styles.voiceSelected]}
              >
                <Text variant="label" color={selected ? colour.paperElevated : colour.ink}>
                  {voice.displayName}
                  {unlocked ? '' : ' ·'}
                </Text>
                <Text
                  variant="captionMono"
                  color={selected ? 'rgba(246,241,231,.7)' : inkAlpha.textLabel}
                >
                  {unlocked ? voice.description : 'Full plan'}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {isFreeStory ? (
          <Text variant="body" color={inkAlpha.textBody} style={{ marginTop: spacing.lgPlus }}>
            This is your free story. Nothing to pay, nothing to cancel.
          </Text>
        ) : null}

        {error ? (
          <Text variant="label" color={colour.danger} style={{ marginTop: spacing.lgPlus }}>{error}</Text>
        ) : null}
      </View>
      <View style={styles.footer}>
        <Button label="Make the story" onPress={makeStory} loading={submitting} />
      </View>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text variant="body" color={inkAlpha.textBody}>{label}</Text>
      <Text variant="label">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // alignItems keeps the cards sized to their text; without it the row
  // inherits stretch and each card grows to the scroll view's full height.
  voiceRow: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingRight: spacing.xxl,
    alignItems: 'flex-start',
  },
  voice: {
    paddingHorizontal: spacing.lgPlus,
    paddingVertical: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: inkAlpha.border,
    backgroundColor: colour.paperCard,
    minWidth: 132,
    gap: 2,
  },
  voiceSelected: { backgroundColor: colour.ink, borderColor: colour.ink },
  body: { flex: 1, padding: spacing.xxl },
  card: { backgroundColor: colour.paperCard, borderRadius: radius.cardLg, padding: spacing.huge, marginTop: spacing.section, gap: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  footer: { padding: spacing.xxl },
});
