import { useLocalSearchParams } from 'expo-router';
import { AdventureScreen } from '../../src/features/create/AdventureScreen';

export default function AdventureRoute() {
  const { characterId } = useLocalSearchParams<{ characterId?: string }>();
  return <AdventureScreen characterIdParam={characterId} />;
}
