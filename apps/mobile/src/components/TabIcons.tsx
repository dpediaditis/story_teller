import { View, type ColorValue } from 'react-native';

/**
 * The design's own tab icons are drawn with plain divs/borders, not SVG — no
 * icon font or `react-native-svg` dependency is installed, so this mirrors
 * that approach with plain Views. Keeps Expo Go happy with zero extra deps.
 */
export function BookIcon({ color }: { color: ColorValue }) {
  return (
    <View style={{ width: 22, height: 18 }}>
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 10,
          height: 18,
          borderWidth: 2,
          borderColor: color,
          borderTopLeftRadius: 3,
          borderBottomLeftRadius: 3,
        }}
      />
      <View
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          width: 10,
          height: 18,
          borderWidth: 2,
          borderColor: color,
          borderTopRightRadius: 3,
          borderBottomRightRadius: 3,
        }}
      />
    </View>
  );
}

export function CharacterIcon({ color }: { color: ColorValue }) {
  return (
    <View style={{ width: 22, height: 19 }}>
      <View
        style={{
          position: 'absolute',
          left: 6,
          top: 0,
          width: 11,
          height: 11,
          borderWidth: 2.4,
          borderColor: color,
          borderRadius: 6,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          width: 22,
          height: 10,
          borderWidth: 2.4,
          borderColor: color,
          borderBottomWidth: 0,
          borderTopLeftRadius: 11,
          borderTopRightRadius: 11,
        }}
      />
    </View>
  );
}

export function FamilyIcon({ color }: { color: ColorValue }) {
  return (
    <View style={{ width: 26, height: 19 }}>
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: 2,
          width: 13,
          height: 13,
          borderWidth: 2.4,
          borderColor: color,
          borderRadius: 7,
        }}
      />
      <View
        style={{
          position: 'absolute',
          right: 0,
          top: 5,
          width: 10,
          height: 10,
          borderWidth: 2.4,
          borderColor: color,
          borderRadius: 5,
        }}
      />
    </View>
  );
}
