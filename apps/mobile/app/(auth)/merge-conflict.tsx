import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import type { MergeStrategy } from '@papercub/shared';
import { Screen, Text, TopBar, Button, EyebrowLabel } from '../../src/components';
import { colour, inkAlpha, radius, spacing } from '../../src/theme';
import { confirmMerge } from '../../src/lib/auth';
import { takePendingMerge, type PendingMerge } from '../../src/lib/auth/mergeFlowState';
import { ApiCallError, errorCopy } from '../../src/lib/api';

/**
 * "That account already has a library" — the first-class merge-conflict
 * screen (DECISIONS.md §7, docs/ARCHITECTURE.md). Reached only from
 * `sign-in.tsx` after `linkIdentity` came back `identity_already_exists` and
 * session B is already established; `preview` is session B's
 * `mergePreview` result.
 *
 * Default action is "Put them together" (`merge` — DECISIONS.md §7 /
 * B5 brief item 4). `keep_account_only` is framed as retaining THIS PHONE's
 * content, never as deleting it — it stays on uid A for
 * RETENTION_DAYS.orphanedAnonymousContent.
 */
export default function MergeConflictScreen() {
  const [pending, setPending] = useState<PendingMerge | null>(null);
  const [strategy, setStrategy] = useState<MergeStrategy>('merge');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const value = takePendingMerge();
    if (!value) {
      // No merge in flight (stale reload / deep link) — nothing to show.
      router.replace('/(auth)/sign-in');
      return;
    }
    setPending(value);
  }, []);

  if (!pending) return <Screen />;

  const { preview } = pending;

  async function choose(next: MergeStrategy) {
    if (!pending) return;
    setStrategy(next);
    setBusy(true);
    try {
      const result = await confirmMerge(pending.mergeToken, next);
      router.replace({
        pathname: '/(auth)/merge-success',
        params: {
          merged: next === 'merge' ? '1' : '0',
          characters: String(result.movedCharacters),
          stories: String(result.movedStories),
        },
      });
    } catch (e) {
      // Includes the server's own authorisation re-check (42501 ->
      // `forbidden`) — the client's flow is not the only guard, and a
      // rejection here is not assumed to be recoverable by retrying
      // client-side.
      const copyKey = e instanceof ApiCallError ? e.apiError.copyKey : undefined;
      router.replace({ pathname: '/(auth)/sign-in-failed', params: { message: errorCopy(copyKey) } });
    }
  }

  return (
    <Screen>
      <TopBar title="That account already has a library" />
      <View style={styles.body}>
        <EyebrowLabel>TWO LIBRARIES FOUND</EyebrowLabel>
        <Text variant="body" color={inkAlpha.textBody} style={{ marginTop: spacing.sm }}>
          Nothing here is ever thrown away. Choose how to bring these together.
        </Text>

        <View style={styles.panels}>
          <Panel
            label="THIS PHONE"
            characters={preview.source.characters}
            stories={preview.source.stories}
            names={preview.source.characterNames}
          />
          <Panel
            label="THE ACCOUNT"
            characters={preview.target.characters}
            stories={preview.target.stories}
            names={preview.target.characterNames}
          />
        </View>

        {preview.wouldExceedCharacterQuota ? (
          <Text variant="captionMono" color={inkAlpha.textLabel} style={{ marginTop: spacing.md }}>
            Everything moves over even so — this only limits creating brand-new characters until you upgrade or
            archive some.
          </Text>
        ) : null}

        <View style={{ marginTop: spacing.huge, gap: spacing.md }}>
          <Button
            label={`Put them together (${preview.mergedCounts.characters} characters, ${preview.mergedCounts.stories} stories)`}
            kind="primary"
            loading={busy && strategy === 'merge'}
            disabled={busy && strategy !== 'merge'}
            onPress={() => choose('merge')}
          />
          <Button
            label="Keep the account's library only"
            kind="secondary"
            loading={busy && strategy === 'keep_account_only'}
            disabled={busy && strategy !== 'keep_account_only'}
            onPress={() => choose('keep_account_only')}
          />
        </View>
        <Text variant="captionMono" color={inkAlpha.textLabel} style={{ marginTop: spacing.md }}>
          "Keep the account's library only" doesn't delete what's on this phone — it stays here for 30 days in case
          you change your mind.
        </Text>
      </View>
    </Screen>
  );
}

function Panel({
  label,
  characters,
  stories,
  names,
}: {
  label: string;
  characters: number;
  stories: number;
  names: string[];
}) {
  return (
    <View style={styles.panel}>
      <EyebrowLabel>{label}</EyebrowLabel>
      <Text variant="sectionHeading" style={{ marginTop: spacing.xs }}>
        {characters} {characters === 1 ? 'character' : 'characters'}
      </Text>
      <Text variant="body" color={inkAlpha.textBody}>
        {stories} {stories === 1 ? 'story' : 'stories'}
      </Text>
      {names.length > 0 ? (
        <Text variant="captionMono" color={inkAlpha.textLabel} style={{ marginTop: spacing.xs }} numberOfLines={2}>
          {names.join(', ')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.xxl, flex: 1 },
  panels: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  panel: {
    flex: 1,
    backgroundColor: colour.paperCard,
    borderRadius: radius.card,
    padding: spacing.lg,
  },
});
