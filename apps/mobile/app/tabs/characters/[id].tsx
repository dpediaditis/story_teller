import { useLocalSearchParams } from 'expo-router';
import { CharacterDetailScreen } from '../../../src/features/characters/CharacterDetailScreen';

export default function CharacterDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CharacterDetailScreen characterId={id} />;
}
