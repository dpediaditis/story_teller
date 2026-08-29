import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { asUntrustedText } from '@papercub/shared';
import { Screen, Text, TopBar, Button, EyebrowLabel } from '../../components';
import { useCreateFlow } from './CreateFlowContext';
import { useSession } from '../session/SessionProvider';
import { apiClient, ApiCallError, errorCopy } from '../../lib/api';
import { DrawingTooLargeError, uploadDrawing } from '../../lib/api/uploadDrawing';
import { colour, inkAlpha, radius, spacing } from '../../theme';

/**
 * B4 — Name your character. The character name is user free text that WILL
 * reach a prompt later — validated here with `asUntrustedText` so an
 * injection attempt or disallowed character is caught at entry, the same
 * gate the server re-runs (CLAUDE.md rule 2 is about ChildDisplayName, a
 * different, unrelated field — this input is never that one).
 */
export function NameCharacterScreen() {
  const { draft, update } = useCreateFlow();
  const { session } = useSession();
  const [name, setName] = useState('');
  const [type, setType] = useState<string | null>('Purple monster');
  const [traits, setTraits] = useState<string[]>(['Funny and brave']);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function confirm() {
    const check = asUntrustedText(name);
    if (!check.ok) {
      setError(
        check.reason === 'empty'
          ? "Let's give them a name."
          : check.reason === 'too_long'
            ? 'A little shorter, please.'
            : "Let's try a different name.",
      );
      return;
    }
    setError(null);
    setSaving(true);
    const childId = session?.children[0]?.id;
    if (!childId || !draft.isolation) {
      setSaving(false);
      return;
    }
    try {
      /* The cut-out goes to Storage FIRST, and `createCharacter` is called with
       * the key the server minted for it. This used to send
       * `drawings/local/<timestamp>-cutout.png`, a key that named nothing: the
       * character and job were created and the worker then failed at gate 1
       * against an empty bucket.
       *
       * Upload before create, deliberately. The other order would leave a
       * character row and a paid-for job pointing at a file that never
       * arrived; this order can at worst leave an orphaned object, which the
       * retention sweep collects and which costs nothing. */
      const cutout = await uploadDrawing({
        childId,
        fileUri: draft.isolation.cutoutUri,
        purpose: 'cutout',
        // The cut-out carries alpha (vision-module: "file:// PNG with alpha"),
        // so it must stay PNG — a JPEG round-trip would fill the transparent
        // background with black.
        contentType: 'image/png',
      });

      /* DECISIONS.md §10: "Upload the isolated cut-out by default. The full
       * photo only if the parent opts to keep the original." Nothing in the
       * flow offers that opt-in yet, so the original stays on the device and
       * `retentionPolicy` says so. When the toggle exists, this is where the
       * second upload goes — not a change to the server. */
      const retentionPolicy = 'delete_after_cutout' as const;

      const res = await apiClient.call('createCharacter', {
        childId,
        // Stable for this create-flow attempt — see CreateFlowContext.
        idempotencyKey: draft.idempotencyKey,
        name: check.value,
        characterType: type,
        personalityTraits: traits,
        drawing: {
          cutoutStorageKey: cutout.storageKey,
          originalStorageKey: null,
          source: 'camera',
          retentionPolicy,
          exifStripped: true,
          isolationMethod: draft.isolation.method,
          isolationConfidence: draft.isolation.confidence,
          faceDetected: draft.isolation.faceDetected,
          textDetected: draft.isolation.nameLikeTextDetected,
          capturedAt: new Date().toISOString(),
          widthPx: draft.isolation.widthPx,
          heightPx: draft.isolation.heightPx,
        },
        palette: draft.isolation.palette,
      });
      update({ characterId: res.character.id, characterName: check.value, characterType: type, personalityTraits: traits });
      router.push('/create/character-card');
    } catch (err) {
      // CLAUDE.md: never swallow. This whole block used to have only a
      // `finally`, so an upload or create failure left the button un-stuck and
      // the screen silent — the parent taps again and burns another slot.
      if (err instanceof DrawingTooLargeError) {
        setError('That photo is a bit too big. Try taking it again.');
      } else if (err instanceof ApiCallError) {
        setError(errorCopy(err.apiError.copyKey));
      } else {
        setError(errorCopy(undefined));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <TopBar onBack={() => router.back()} />
      <View style={styles.body}>
        <EyebrowLabel>CUT-OUT</EyebrowLabel>
        <Text variant="sectionHeading" style={{ marginTop: spacing.sm }}>What's their name?</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Bobo"
          placeholderTextColor={inkAlpha.textFaint}
          style={styles.input}
          maxLength={40}
          autoFocus
        />
        {error ? (
          <Text variant="label" color={colour.danger} style={{ marginTop: spacing.xs }}>{error}</Text>
        ) : null}

        <EyebrowLabel style={{ marginTop: spacing.section }}>SUGGESTIONS — KEEP, EDIT, OR DROP</EyebrowLabel>
        <View style={styles.suggestions}>
          {type ? <Suggestion label={type} onRemove={() => setType(null)} /> : null}
          {traits.map((t) => (
            <Suggestion key={t} label={t} onRemove={() => setTraits((ts) => ts.filter((x) => x !== t))} />
          ))}
        </View>
      </View>

      <View style={styles.footer}>
        <Button label="That's the name" onPress={confirm} loading={saving} disabled={!name.trim()} />
      </View>
    </Screen>
  );
}

function Suggestion({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <View style={styles.suggestionChip}>
      <Text variant="label" color={colour.violetDeep}>{label}</Text>
      <Pressable hitSlop={10} onPress={onRemove}>
        <Text variant="label" color={colour.violetDeep}>×</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: spacing.xxl },
  input: {
    marginTop: spacing.lgPlus,
    borderWidth: 1.5,
    borderColor: inkAlpha.borderStrong,
    borderRadius: radius.input,
    paddingHorizontal: spacing.lgPlus,
    paddingVertical: spacing.md,
    fontSize: 20,
    color: colour.ink,
  },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colour.violetTint,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lgPlus,
    paddingVertical: spacing.sm,
  },
  footer: { padding: spacing.xxl },
});
