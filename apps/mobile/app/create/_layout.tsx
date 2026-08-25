import { Stack } from 'expo-router';
import { CreateFlowProvider } from '../../src/features/create/CreateFlowContext';

/** B1–C4: the whole create flow shares one CreateFlowProvider draft. */
export default function CreateLayout() {
  return (
    <CreateFlowProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </CreateFlowProvider>
  );
}
