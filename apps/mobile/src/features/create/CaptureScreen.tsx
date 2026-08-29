import { useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { Screen, Text, EyebrowLabel } from '../../components';
import { useCreateFlow } from './CreateFlowContext';
import { pickDrawingFromLibrary, prepareCapturedPhoto } from './prepareDrawing';
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
  const [captureFailed, setCaptureFailed] = useState(false);
  const { update } = useCreateFlow();

  async function capture() {
    if (!cameraRef.current) return;
    setCapturing(true);
    setCaptureFailed(false);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8, skipProcessing: true });
      // Only advance if there is actually a photo. This used to push to
      // isolation-preview unconditionally, so a failed shutter landed the user
      // on a preview of nothing with no way to tell what had gone wrong.
      if (!photo?.uri) {
        setCaptureFailed(true);
        return;
      }
      // Stripped BEFORE it enters the draft, so nothing downstream can upload
      // the original by accident — DECISIONS.md §10.
      const prepared = await prepareCapturedPhoto(photo.uri);
      update({
        capturedImageUri: prepared.uri,
        source: prepared.source,
        capturedWidthPx: prepared.widthPx,
        capturedHeightPx: prepared.heightPx,
      });
      router.push('/create/isolation-preview');
    } catch {
      setCaptureFailed(true);
    } finally {
      setCapturing(false);
    }
  }

  async function chooseFromLibrary() {
    setCaptureFailed(false);
    try {
      const prepared = await pickDrawingFromLibrary();
      // null = cancelled, or library access declined. Both are ordinary; stay put.
      if (!prepared) return;
      update({
        capturedImageUri: prepared.uri,
        source: prepared.source,
        capturedWidthPx: prepared.widthPx,
        capturedHeightPx: prepared.heightPx,
      });
      router.push('/create/isolation-preview');
    } catch {
      setCaptureFailed(true);
    }
  }

  if (!permission) return <Screen />;

  if (!permission.granted) {
    /* iOS shows the system camera prompt ONCE, ever. After a decline,
     * `requestPermission()` resolves immediately with granted:false and no
     * dialog appears — so the "Allow camera" button here was dead forever, with
     * nothing on screen to say why or what to do instead. The only route back
     * is the Settings app, and the user has to be told that.
     *
     * `canAskAgain` is what distinguishes the two states. Never show a button
     * that cannot do anything. */
    const canPrompt = permission.canAskAgain;

    return (
      <Screen background={colour.ink}>
        <View style={styles.permissionPrompt}>
          <Text variant="body" color={colour.paperElevated} style={{ textAlign: 'center' }}>
            {canPrompt
              ? 'Camera access is needed to photograph the drawing.'
              : 'Papercub needs camera access to photograph the drawing. You can turn it on in Settings.'}
          </Text>
          <Pressable
            style={styles.allowBtn}
            onPress={() => {
              if (canPrompt) void requestPermission();
              else void Linking.openSettings();
            }}
          >
            <Text variant="button" color={colour.ink}>
              {canPrompt ? 'Allow camera' : 'Open Settings'}
            </Text>
          </Pressable>
          {/* The real way past a declined camera. Sending the parent to
              Settings and nowhere else makes the drawing unreachable for
              anyone who does not want to grant the camera at all. */}
          <Pressable hitSlop={12} onPress={chooseFromLibrary}>
            <Text variant="button" color={colour.paperElevated}>Choose from Photos</Text>
          </Pressable>
          <Pressable hitSlop={12} onPress={() => router.back()}>
            <Text variant="body" color="rgba(246,241,231,.7)">Not now</Text>
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
      {captureFailed ? (
        <View style={styles.captureError} pointerEvents="none">
          <Text variant="body" color={colour.paperElevated} style={{ textAlign: 'center' }}>
            That photo didn’t save. Try once more.
          </Text>
        </View>
      ) : null}
      <View style={styles.bottomRow}>
        <Pressable hitSlop={12} onPress={chooseFromLibrary} style={styles.libraryBtn}>
          <Text variant="captionMono" color={colour.paperElevated}>Photos</Text>
        </Pressable>
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
  libraryBtn: { width: 68, alignItems: 'center', justifyContent: 'center' },
  permissionPrompt: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.section, gap: spacing.huge },
  captureError: {
    position: 'absolute',
    left: spacing.section,
    right: spacing.section,
    bottom: 130,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: radius.card,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  allowBtn: { backgroundColor: colour.paperElevated, paddingHorizontal: spacing.huge, paddingVertical: spacing.md, borderRadius: radius.pill },
});
