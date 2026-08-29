import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { SLO, type JobProgressEvent } from '@papercub/shared';
import { Screen, Text, Button } from '../../components';
import { useCreateFlow } from './CreateFlowContext';
import { StoryWorkshop } from './StoryWorkshop';
import { useSignedMedia } from '../../lib/api/useSignedMedia';
import { apiClient, generationStageCopy, GENERATION_STAGE_ORDER } from '../../lib/api';
import { colour, inkAlpha, spacing } from '../../theme';

/**
 * C3 — Generating, folding in C3b (slow, after 60s) and G4 (failed, quota
 * refunded) as states of the same screen rather than three separate routes.
 * Renders ONLY `GenerationStage` copy keys the job has actually reported —
 * never a percentage, never an invented stage (RULES panel).
 */
export function GeneratingScreen() {
  const { draft, update } = useCreateFlow();
  const [event, setEvent] = useState<JobProgressEvent | null>(null);
  const [slow, setSlow] = useState(false);
  const startRef = useRef(Date.now());

  useEffect(() => {
    if (!draft.jobId) return;
    const unsubscribe = apiClient.subscribeJob(draft.jobId, setEvent);
    return unsubscribe;
  }, [draft.jobId]);

  useEffect(() => {
    const t = setInterval(() => {
      if (Date.now() - startRef.current > SLO.showSlowStateAfterMs && !event?.readablePageIndexes.length) {
        setSlow(true);
      }
    }, 2000);
    return () => clearInterval(t);
  }, [event]);

  useEffect(() => {
    if (event?.status === 'succeeded' && event.stage === 'done') {
      router.replace('/create/cover-reveal');
    }
  }, [event]);

  const characterName = draft.characterName || 'your character';

  /* Their drawing, from wherever this flow got it. The capture path has a local
   * file; entering from the Characters tab has only a server key, which has to
   * be signed like any other private object. */
  const { urls } = useSignedMedia([draft.characterCutoutKey]);
  const cutoutUri =
    draft.isolation?.cutoutUri ??
    (draft.characterCutoutKey ? (urls[draft.characterCutoutKey] ?? null) : null);

  if (event?.status === 'failed') {
    return (
      <Screen>
        <View style={styles.center}>
          <Text variant="sectionHeading" style={{ textAlign: 'center' }}>That one didn't finish.</Text>
          <Text variant="body" color={inkAlpha.textBody} style={{ marginTop: spacing.md, textAlign: 'center' }}>
            Your free story is back in the bank.
          </Text>
          <View style={{ marginTop: spacing.section, alignSelf: 'stretch', gap: spacing.sm }}>
            <Button label="Try again" onPress={() => router.back()} />
            <Button label="Not now" kind="ghost" onPress={() => router.replace('/tabs')} />
          </View>
        </View>
      </Screen>
    );
  }

  const currentStage = event?.stage ?? 'queued';
  const currentIndex = GENERATION_STAGE_ORDER.indexOf(currentStage);
  const readable = event?.readablePageIndexes ?? [];

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body}>
        <Text variant="sectionHeading">Making {characterName}'s book.</Text>

        {/* The book being assembled, driven by the SAME event the list below
            reads. Nothing in it is on a timer — see StoryWorkshop. */}
        <StoryWorkshop event={event} cutoutUri={cutoutUri} />

        {slow ? (
          <Text variant="body" color={inkAlpha.textBody} style={{ marginTop: spacing.sm }}>
            Still going. Waiting since{' '}
            {new Date(startRef.current).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
          </Text>
        ) : null}

        <View style={styles.stageList}>
          {GENERATION_STAGE_ORDER.filter((s) => s !== 'done').map((stage, i, all) => {
            const done = i < currentIndex;
            const active = i === currentIndex;
            if (!done && !active) return null; // never show a stage the server hasn't reached
            // Several stages share a copy line (the copy is written for the
            // child, not for the pipeline), which printed the same sentence
            // twice in a row. Collapse the repeat — the stage still ran, and
            // the workshop above is the real progress.
            const previous = i > 0 ? all[i - 1] : null;
            if (
              previous &&
              generationStageCopy(previous, characterName) ===
                generationStageCopy(stage, characterName)
            ) {
              return null;
            }
            return (
              <View key={stage} style={styles.stageRow}>
                <Text variant="label" color={done ? colour.violet : colour.ink}>
                  {done ? '✓' : '·'}
                </Text>
                <Text variant="body" color={active ? colour.ink : inkAlpha.textBody}>
                  {generationStageCopy(stage, characterName)}
                </Text>
              </View>
            );
          })}
        </View>

        {readable.length > 0 ? (
          <Text variant="body" color={inkAlpha.textBody} style={{ marginTop: spacing.huge }}>
            {readable.length === 1 ? 'Page 1 is' : `Pages 1–${readable.length} are`} already readable.
          </Text>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {readable.length > 0 ? (
          <Button
            label={`Start reading page ${readable[0]}`}
            kind="secondary"
            onPress={() => draft.storyId && router.push(`/story/${draft.storyId}/reader`)}
          />
        ) : slow ? (
          <>
            <Button label="Notify me and close" onPress={() => router.replace('/tabs')} />
          </>
        ) : (
          <Button label="Tell me when it's ready" kind="ghost" onPress={() => router.replace('/tabs')} />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.xxl, paddingBottom: spacing.section },
  stageList: { marginTop: spacing.section, gap: spacing.md },
  stageRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  footer: { padding: spacing.xxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.section },
});
