import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { isAvailable, isolateDrawing, IsolationUnavailableError } from '@papercub/vision-module';
import { Screen, Text, TopBar, Button, EyebrowLabel } from '../../components';
import { useCreateFlow } from './CreateFlowContext';
import { colour, inkAlpha, radius, spacing } from '../../theme';

type Mode = 'loading' | 'ready' | 'unavailable';

/**
 * B2 — Isolation preview, folding in G5 ("Isolation failed or unsure") as a
 * state rather than a separate dead-end screen. The vision-module stub
 * always throws `IsolationUnavailableError` today (B4 hasn't shipped the
 * native module yet), so this screen's manual-fallback path is exercised on
 * every run — by design, per the brief: "handle that as the manual-crop
 * path. Do not work around it."
 */
export function IsolationPreviewScreen() {
  const { draft, update } = useCreateFlow();
  const [mode, setMode] = useState<Mode>('loading');

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!draft.capturedImageUri) {
        setMode('unavailable');
        return;
      }
      if (!isAvailable()) {
        if (!cancelled) setMode('unavailable');
        return;
      }
      try {
        const result = await isolateDrawing({ imageUri: draft.capturedImageUri });
        if (cancelled) return;
        update({ isolation: result });
        setMode('ready');
      } catch (err) {
        if (cancelled) return;
        if (err instanceof IsolationUnavailableError) {
          setMode('unavailable');
        } else {
          setMode('unavailable');
        }
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.capturedImageUri]);

  /**
   * Back to the camera for another shot.
   *
   * `router.back()` rather than a push, so the preview is POPPED — a retake
   * must not stack another preview on top of the last one.
   *
   * The stale capture is cleared first, and that is not tidiness. `acceptAsIs`
   * falls back to `draft.isolation` when the new isolate does not produce one,
   * so a leftover cut-out from the PREVIOUS photo would be silently attached to
   * the new one — the child's character would be built from a drawing they had
   * just replaced.
   */
  function retake() {
    update({ capturedImageUri: null, isolation: null, manualCropUsed: false });
    router.back();
  }

  function acceptAsIs() {
    update({
      manualCropUsed: true,
      isolation: draft.isolation ?? {
        cutoutUri: draft.capturedImageUri ?? '',
        processedOriginalUri: draft.capturedImageUri ?? '',
        confidence: 0.5,
        method: 'manual_repair',
        palette: ['#6d47bd', '#efe7fb'],
        // Measured when the image entered the flow (prepareDrawing), not
        // assumed. These land in original_drawings.width_px/height_px, and 1024
        // square was a number nothing had ever looked at.
        widthPx: draft.capturedWidthPx ?? 1024,
        heightPx: draft.capturedHeightPx ?? 1024,
        faceDetected: false,
        nameLikeTextDetected: false,
        exifStripped: true,
      },
    });
    router.push('/create/name-character');
  }

  if (mode === 'loading') {
    return (
      <Screen>
        <TopBar onBack={() => router.back()} />
        <View style={styles.center}>
          <Text variant="body" color={inkAlpha.textBody}>Looking at the drawing…</Text>
        </View>
      </Screen>
    );
  }

  if (mode === 'unavailable') {
    return (
      <Screen>
        <TopBar onBack={() => router.back()} title="Isolation preview" />
        <View style={styles.body}>
          <View style={styles.photoFrame}>
            {draft.capturedImageUri ? (
              <Image source={{ uri: draft.capturedImageUri }} style={styles.photo} resizeMode="cover" />
            ) : (
              <View style={[styles.photo, { backgroundColor: colour.kraftLight }]} />
            )}
          </View>
          <EyebrowLabel style={{ marginTop: spacing.huge }}>NOT SURE</EyebrowLabel>
          <Text variant="sectionHeading" style={{ marginTop: spacing.xs }}>
            We can't tell which one is the character.
          </Text>
          <View style={{ marginTop: spacing.section, gap: spacing.sm }}>
            <Button label="Draw round the one I mean" onPress={() => router.push('/create/edge-repair')} />
            <Button label="Use the whole picture" kind="secondary" onPress={acceptAsIs} />
            <Button label="Take it again in better light" kind="ghost" onPress={retake} />
          </View>
        </View>
      </Screen>
    );
  }

  // mode === 'ready': a real IsolateResult came back from the native module.
  return (
    <Screen>
      <TopBar onBack={() => router.back()} title="Isolation preview" />
      <View style={styles.body}>
        <View style={styles.comparisonRow}>
          <View style={styles.photoFrame}>
            <EyebrowLabel style={styles.frameLabel}>CUT-OUT</EyebrowLabel>
            {draft.isolation ? (
              <Image source={{ uri: draft.isolation.cutoutUri }} style={styles.photo} resizeMode="contain" />
            ) : null}
          </View>
        </View>
        <Text variant="sectionHeading" style={{ marginTop: spacing.huge }}>Got it right?</Text>
        <Text variant="body" color={inkAlpha.textBody} style={{ marginTop: spacing.xs }}>
          Check the arms and the legs. Anything missing?
        </Text>
        <View style={{ marginTop: spacing.section, gap: spacing.sm }}>
          <Button label="Looks good" onPress={acceptAsIs} />
          <Button label="Fix edges" kind="secondary" onPress={() => router.push('/create/edge-repair')} />
          {/* The retake lived ONLY on the "not sure" state below, which is the
              state the Vision stub always produces — so it looked covered. On a
              device where isolation actually works, this is the state a parent
              lands on, and it had no way to take the photo again except an
              unlabelled chevron. A bad photo is the most likely thing to go
              wrong at this step; it needs a named way out. */}
          <Button label="Take it again" kind="ghost" onPress={retake} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, padding: spacing.xxl },
  comparisonRow: { gap: spacing.lgPlus },
  photoFrame: {
    aspectRatio: 1,
    borderRadius: radius.cardLg,
    backgroundColor: colour.paperCard,
    borderWidth: 1,
    borderColor: inkAlpha.border,
    overflow: 'hidden',
  },
  frameLabel: { position: 'absolute', top: spacing.sm, left: spacing.sm, zIndex: 1 },
  photo: { width: '100%', height: '100%' },
});
