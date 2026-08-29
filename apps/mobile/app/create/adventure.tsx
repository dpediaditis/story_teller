import { useLocalSearchParams } from 'expo-router';
import { AdventureScreen } from '../../src/features/create/AdventureScreen';

export default function AdventureRoute() {
  const { characterId, characterName, cutoutKey } = useLocalSearchParams<{
    characterId?: string;
    characterName?: string;
    cutoutKey?: string;
  }>();
  return (
    <AdventureScreen
      characterIdParam={characterId}
      characterNameParam={characterName}
      cutoutKeyParam={cutoutKey}
    />
  );
}
