import { View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Camera } from 'expo-camera';
import { Screen, Text, Button, EyebrowLabel } from '../../src/components';
import { inkAlpha, spacing } from '../../src/theme';

/** A4 — Camera permission. Plain-language explainer before the OS prompt. */
export default function CameraPermission() {
  async function allow() {
    await Camera.requestCameraPermissionsAsync();
    router.replace('/tabs');
  }

  return (
    <Screen>
      <View style={styles.content}>
        <EyebrowLabel>ABOUT THE PHOTO</EyebrowLabel>
        <Text variant="sectionHeading" style={{ marginTop: spacing.sm }}>
          The photo stays on this phone until you make a story with it.
        </Text>
        <Text variant="body" color={inkAlpha.textBody} style={{ marginTop: spacing.lgPlus }}>
          If we spot a face or a written name, we offer to crop it before anything is sent.
        </Text>
        <Text variant="body" color={inkAlpha.textBody} style={{ marginTop: spacing.md }}>
          Delete a drawing and the copy goes too.
        </Text>
      </View>

      <View style={styles.footer}>
        <Button label="Allow camera" onPress={allow} />
        <Button label="Choose from Photos instead" kind="ghost" onPress={() => router.replace('/tabs')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, padding: spacing.xxl, justifyContent: 'center' },
  footer: { padding: spacing.xxl, gap: spacing.sm },
});
