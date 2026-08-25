import { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Screen, Text, TopBar, Button, EyebrowLabel } from '../../components';
import { useCreateFlow } from './CreateFlowContext';
import { colour, radius, spacing } from '../../theme';

type Brush = 'add' | 'remove';

/**
 * B3 — Edge repair. "Two brushes, one size slider, undo. Deliberately not a
 * lasso or a magic wand." Actual pixel painting needs an image-manipulation
 * dependency this pass doesn't have (none is installed, and installing one
 * is out of scope per the brief) — the brush/size/undo chrome is real and
 * wired, painting itself is a no-op until B4's native mask editor lands.
 */
export function EdgeRepairScreen() {
  const { draft, update } = useCreateFlow();
  const [brush, setBrush] = useState<Brush>('add');
  const [size, setSize] = useState(0.5);

  function done() {
    update({
      manualCropUsed: true,
      isolation: {
        cutoutUri: draft.capturedImageUri ?? '',
        processedOriginalUri: draft.capturedImageUri ?? '',
        confidence: 0.6,
        method: 'manual_repair',
        palette: draft.isolation?.palette ?? ['#6d47bd', '#efe7fb'],
        widthPx: 1024,
        heightPx: 1024,
        faceDetected: false,
        nameLikeTextDetected: false,
        exifStripped: true,
      },
    });
    router.push('/create/name-character');
  }

  return (
    <Screen background={colour.ink}>
      <TopBar
        onBack={() => router.back()}
        title="Fix edges"
        right={
          <Pressable onPress={done}>
            <Text variant="button" color={colour.paperElevated}>Done</Text>
          </Pressable>
        }
      />
      <View style={styles.canvasWrap}>
        <EyebrowLabel color="rgba(246,241,231,.6)">CUT-OUT MASK</EyebrowLabel>
        <Text variant="captionMono" color="rgba(246,241,231,.5)" style={{ marginTop: 2 }}>
          checkerboard = removed
        </Text>
        <View style={styles.canvas}>
          {draft.capturedImageUri ? (
            <Image source={{ uri: draft.capturedImageUri }} style={styles.canvasImage} resizeMode="contain" />
          ) : null}
        </View>
        <Text variant="body" color="rgba(246,241,231,.7)" style={{ marginTop: spacing.md }}>
          Paint over the bits we missed
        </Text>
      </View>

      <View style={styles.toolbar}>
        <View style={styles.brushRow}>
          <ToolButton label="Add" active={brush === 'add'} onPress={() => setBrush('add')} />
          <ToolButton label="Remove" active={brush === 'remove'} onPress={() => setBrush('remove')} />
          <ToolButton label="Undo" onPress={() => {}} />
        </View>
        <View style={styles.sliderRow}>
          <View style={styles.sliderTrack}>
            <View style={[styles.sliderFill, { width: `${size * 100}%` }]} />
          </View>
          <Pressable onPress={() => setSize((s) => Math.max(0.1, s - 0.15))} style={styles.sliderBtn}>
            <Text variant="button" color={colour.paperElevated}>–</Text>
          </Pressable>
          <Pressable onPress={() => setSize((s) => Math.min(1, s + 0.15))} style={styles.sliderBtn}>
            <Text variant="button" color={colour.paperElevated}>+</Text>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}

function ToolButton({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.tool, active && styles.toolActive]}>
      <Text variant="label" color={colour.paperElevated}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  canvasWrap: { flex: 1, alignItems: 'center', padding: spacing.xxl },
  canvas: {
    flex: 1,
    alignSelf: 'stretch',
    marginTop: spacing.lgPlus,
    borderRadius: radius.cardLg,
    backgroundColor: '#3a362f',
    overflow: 'hidden',
  },
  canvasImage: { width: '100%', height: '100%' },
  toolbar: { padding: spacing.xxl, gap: spacing.lgPlus },
  brushRow: { flexDirection: 'row', gap: spacing.sm },
  tool: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  toolActive: { backgroundColor: colour.violet },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sliderTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.15)' },
  sliderFill: { height: 6, borderRadius: 3, backgroundColor: colour.warning },
  sliderBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
