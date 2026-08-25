import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';
import { colour } from '../../theme';

/**
 * Bobo — the sample character, drawn as a child would draw him.
 *
 * This is the only illustration the interface is allowed to have, per the
 * design direction, and it is the product's entire premise: a wobbly purple
 * monster with uneven eyes and colour outside the lines.
 *
 * Everything here is deliberately imperfect. The outline does not close
 * cleanly, the crayon fill sits slightly off-register from the stroke, the two
 * eyes are different sizes and heights, and the horns lean at different angles.
 * A tidy, symmetrical monster would read as our artwork, not a child's — which
 * is exactly the thing the product promises not to do.
 *
 * `mood="paper"` renders it as it was drawn. `mood="book"` is the same
 * character lit for a night scene, so the before/after is unmistakably one
 * character in two places rather than two different drawings.
 */

type Props = {
  size?: number;
  mood?: 'paper' | 'book';
};

const CRAYON = '#7b4fc4';
const CRAYON_FILL = '#9b74dd';

export function BoboDrawing({ size = 180, mood = 'paper' }: Props) {
  const inBook = mood === 'book';
  const stroke = inBook ? '#c9a9ff' : CRAYON;
  const fill = inBook ? '#7f5bc9' : CRAYON_FILL;

  return (
    <Svg width={size} height={size} viewBox="0 0 200 200" fill="none">
      {/* Crayon fill, offset from the outline — a child colouring outside the
          lines. Drawn first so the stroke sits on top of it. */}
      <G opacity={inBook ? 0.95 : 0.85}>
        <Path
          d="M62 96 C58 70, 78 52, 103 53 C130 54, 146 72, 143 98
             C140 124, 128 140, 100 141 C74 142, 66 122, 62 96 Z"
          fill={fill}
          transform="translate(4, 3)"
        />
      </G>

      {/* Body outline — wobbly, and deliberately not closing cleanly at the
          bottom left, the way a crayon lifts off the paper. */}
      <Path
        d="M60 95 C55 68, 77 49, 102 50 C131 51, 148 71, 145 98
           C142 126, 127 143, 99 144 C71 145, 64 121, 60 95"
        stroke={stroke}
        strokeWidth={6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* Three horns, each leaning differently. */}
      <Path d="M78 54 L70 30 L90 47" stroke={stroke} strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round" fill={fill} />
      <Path d="M101 50 L104 22 L117 46" stroke={stroke} strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round" fill={fill} />
      <Path d="M124 55 L138 36 L136 60" stroke={stroke} strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round" fill={fill} />

      {/* Eyes — one big, one small, at different heights. */}
      <Ellipse cx={88} cy={90} rx={15} ry={16} fill={colour.paperElevated} stroke={stroke} strokeWidth={4.5} />
      <Ellipse cx={124} cy={95} rx={10} ry={11} fill={colour.paperElevated} stroke={stroke} strokeWidth={4.5} />
      <Circle cx={91} cy={92} r={6} fill={colour.ink} />
      <Circle cx={126} cy={97} r={4.5} fill={colour.ink} />

      {/* Smile, slightly off-centre. */}
      <Path
        d="M85 116 C95 128, 118 128, 128 114"
        stroke={stroke}
        strokeWidth={5}
        strokeLinecap="round"
        fill="none"
      />

      {/* Two arms at different lengths. */}
      <Path d="M60 100 L34 92" stroke={stroke} strokeWidth={5.5} strokeLinecap="round" />
      <Path d="M146 104 L170 114" stroke={stroke} strokeWidth={5.5} strokeLinecap="round" />

      {/* Stubby legs. */}
      <Path d="M84 142 L80 166" stroke={stroke} strokeWidth={6} strokeLinecap="round" />
      <Path d="M116 142 L121 165" stroke={stroke} strokeWidth={6} strokeLinecap="round" />
      <Path d="M70 168 L92 166" stroke={stroke} strokeWidth={6} strokeLinecap="round" />
      <Path d="M111 167 L133 169" stroke={stroke} strokeWidth={6} strokeLinecap="round" />

      {/* A stray crayon mark, because children do that. */}
      <Path
        d="M44 152 C52 146, 58 150, 54 158"
        stroke={stroke}
        strokeWidth={3.5}
        strokeLinecap="round"
        opacity={0.55}
        fill="none"
      />
    </Svg>
  );
}
