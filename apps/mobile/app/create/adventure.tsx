import { useLocalSearchParams } from 'expo-router';
import { AdventureScreen } from '../../src/features/create/AdventureScreen';

export default function AdventureRoute() {
  const { characterId, characterName } = useLocalSearchParams<{
    characterId?: string;
    characterName?: string;
  }>();
  return <AdventureScreen characterIdParam={characterId} characterNameParam={characterName} />;
}
