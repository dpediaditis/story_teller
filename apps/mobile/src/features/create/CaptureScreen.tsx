import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { Screen, Text, EyebrowLabel } from '../../components';
import { useCreateFlow } from './CreateFlowContext';
import { colour, radius, spacing } from '../../theme';

/**
 * B1 / B1b — Camera. Live capture with a steady/glare guidance line. Real
 * per-frame guidance (paper/glare/edge/steadiness) is `subscribeCaptureGuidance`
 * from `@papercub/vision-module`, which is a no-op until B4 lands — this
 * screen subscribes to it so the wiring is correct, but does not fake data
 * from it in the meantime; the copy below is static.
 */
export function CaptureScreen() {
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [capturing, setCapturing] = useState(false);
  const { update } = useCreateFlow();

  async function capture() {
    if (!cameraRef.current) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8, skipProcessing: true });
      if (photo) update({ capturedImageUri: photo.uri });
      router.push('/create/isolation-preview');
    } finally {
      setCapturing(false);
    }
  }

  if (!permission) return <Screen />;

  if (!permission.granted) {
    return (
      <Screen background={colour.ink}>
        <View style={styles.permissionPrompt}>
          <Text variant="body" color={colour.paperElevated} style={{ textAlign: 'center' }}>
            Camera access is needed to photograph the drawing.
          </Text>
          <Pressable style={styles.allowBtn} onPress={requestPermission}>
            <Text variant="button" color={colour.ink}>Allow camera</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  return (
    <Screen background={colour.ink} edges={['top', 'bottom']}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
      <View style={styles.topRow}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={styles.closeBtn}>
          <Text variant="button" color={colour.paperElevated}>×</Text>
        </Pressable>
      </View>
      <View style={styles.guidance}>
        <EyebrowLabel color="rgba(246,241,231,.7)">LIVE VIEW</EyebrowLabel>
        <Text variant="sectionHeading" color={colour.paperElevated} style={{ marginTop: spacing.sm }}>
          Hold still…
        </Text>
      </View>
      <View style={styles.frame} pointerEvents="none" />
      <View style={styles.bottomRow}>
        <View style={{ width: 68 }} />
        <Pressable
          onPress={capture}
          disabled={capturing}
          style={[styles.shutter, capturing && { opacity: 0.6 }]}
        />
        <View style={{ width: 68 }} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topRow: { position: 'absolute', top: spacing.xxl, left: spacing.xxl, zIndex: 2 },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  guidance: { position: 'absolute', top: 90, left: 0, right: 0, alignItems: 'center' },
  frame: {
    position: 'absolute',
    left: spacing.section,
    right: spacing.section,
    top: 150,
    bottom: 170,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.5)',
    borderRadius: radius.card,
    borderStyle: 'dashed',
  },
  bottomRow: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: spacing.section,
  },
  shutter: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colour.paperElevated,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  permissionPrompt: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.section, gap: spacing.huge },
  allowBtn: { backgroundColor: colour.paperElevated, paddingHorizontal: spacing.huge, paddingVertical: spacing.md, borderRadius: radius.pill },
});
