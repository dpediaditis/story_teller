import { useLocalSearchParams } from 'expo-router';
import { TheEndScreen } from '../../../src/features/reader/TheEndScreen';

export default function EndRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TheEndScreen storyId={id} />;
}
