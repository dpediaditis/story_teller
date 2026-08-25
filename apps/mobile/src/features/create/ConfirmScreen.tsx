import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { STORY_SHAPE } from '@papercub/shared';
import { Screen, Text, TopBar, Button } from '../../components';
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

  async function makeStory() {
    if (!draft.characterId || !draft.theme) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiClient.call('createStory', {
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
          {draft.characterName} goes to {THEME_LABEL[draft.theme ?? 'space']} — a {draft.length} {draft.mood} story.
        </Text>

        <View style={styles.card}>
          <Row label="Pages" value={String(shape.pageCount)} />
          <Row label="Read aloud" value="Included" />
          <Row label="Usually takes" value="About a minute" />
        </View>

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
  body: { flex: 1, padding: spacing.xxl },
  card: { backgroundColor: colour.paperCard, borderRadius: radius.cardLg, padding: spacing.huge, marginTop: spacing.section, gap: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  footer: { padding: spacing.xxl },
});
