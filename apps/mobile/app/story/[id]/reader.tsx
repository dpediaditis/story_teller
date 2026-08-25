import { useLocalSearchParams } from 'expo-router';
import { ReaderScreen } from '../../../src/features/reader/ReaderScreen';

export default function ReaderRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ReaderScreen storyId={id} />;
}
