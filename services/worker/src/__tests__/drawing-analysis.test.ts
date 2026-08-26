/**
 * CLAUDE.md: "if a bug costs money or leaks data, it gets a regression test."
 *
 * This one cost money on every attempt. `character_build` had never once
 * succeeded: the vision call was billed, the response failed
 * `DrawingAnalysis.safeParse`, and the job died at `analysing_drawing` with
 * `invalid_structured_output` — a paid call for nothing, and on the free tier
 * potentially the user's only character slot.
 *
 * The fixture is not invented. It is the verbatim response from
 * `gemini-3.1-flash-lite` for a real cut-out on 26 Aug 2026.
 */

import { describe, expect, it } from 'vitest';
import { DrawingAnalysis } from '@papercub/shared';
import { normaliseDrawingAnalysis, toHexColour } from '../providers/drawing-analysis';

/** Verbatim from the live provider. Do not tidy it — that is the point. */
const LIVE_RESPONSE = {
  subjectGuess: 'a purple circular character with two eyes and a curved mouth',
  dominantColours: ['purple', 'white', 'dark grey'],
  distinguishingFeatures: [
    'circular purple body',
    'two white circular eyes with dark grey pupils',
    'three small bumps on the top of the head',
    'two small rectangular protrusions at the bottom',
    'a dark grey curved line representing a mouth',
  ],
  medium: 'unknown',
  lineQuality: 'bold',
  suggestedTraits: ['minimalist', 'symmetrical', 'cartoonish', 'flat design'],
  suggestedType: 'digital illustration',
};

describe('normaliseDrawingAnalysis', () => {
  it('makes the real live response parse, which it did not before', () => {
    expect(DrawingAnalysis.safeParse(LIVE_RESPONSE).success).toBe(false);
    expect(DrawingAnalysis.safeParse(normaliseDrawingAnalysis(LIVE_RESPONSE)).success).toBe(true);
  });

  it('converts colour names to hex and keeps the palette in order', () => {
    expect(normaliseDrawingAnalysis(LIVE_RESPONSE).dominantColours).toEqual([
      '#800080',
      '#ffffff',
      '#a9a9a9',
    ]);
  });

  it('slices suggestedTraits to the cap, keeping the first three', () => {
    expect(normaliseDrawingAnalysis(LIVE_RESPONSE).suggestedTraits).toEqual([
      'minimalist',
      'symmetrical',
      'cartoonish',
    ]);
  });

  it('clamps subjectGuess on a word boundary, never mid-word', () => {
    // The live value is 59 chars against a 60 cap — a coin flip run to run.
    const long = { ...LIVE_RESPONSE, subjectGuess: 'x'.repeat(40) + ' and a very long tail indeed' };
    const out = normaliseDrawingAnalysis(long).subjectGuess;
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith(' ')).toBe(false);
    expect(long.subjectGuess.startsWith(out)).toBe(true);
  });

  it('drops unparseable colours rather than failing the build', () => {
    const out = normaliseDrawingAnalysis({
      ...LIVE_RESPONSE,
      dominantColours: ['rainbow', 'sparkly', '#7b4fc4', 'not a colour'],
    });
    expect(out.dominantColours).toEqual(['#7b4fc4']);
    expect(DrawingAnalysis.safeParse(out).success).toBe(true);
  });

  it('de-duplicates colours that normalise to the same hex', () => {
    const out = normaliseDrawingAnalysis({
      ...LIVE_RESPONSE,
      dominantColours: ['grey', 'gray', 'GREY', '#808080'],
    });
    expect(out.dominantColours).toEqual(['#808080']);
  });

  it('falls back on an out-of-enum medium or line quality', () => {
    const out = normaliseDrawingAnalysis({
      ...LIVE_RESPONSE,
      medium: 'digital',
      lineQuality: 'wobbly',
    });
    expect(out.medium).toBe('unknown');
    expect(out.lineQuality).toBe('mixed');
  });

  it('never throws on junk', () => {
    for (const junk of [{}, null, undefined, [], 'a string', 42]) {
      expect(() => normaliseDrawingAnalysis(junk)).not.toThrow();
      expect(DrawingAnalysis.safeParse(normaliseDrawingAnalysis(junk)).success).toBe(true);
    }
  });

  it('can return no distinguishing features, which the contract permits', () => {
    // `distinguishingFeatures` is capped but has no minimum, so an empty
    // analysis parses cleanly. That is why runCharacterBuild rejects an empty
    // feature anchor itself rather than relying on the schema — it is the
    // string every later illustration prompt is conditioned on.
    expect(normaliseDrawingAnalysis({}).distinguishingFeatures).toEqual([]);
  });
});

describe('toHexColour', () => {
  it.each([
    ['#7b4fc4', '#7b4fc4'],
    ['#7B4FC4', '#7b4fc4'],
    ['7b4fc4', '#7b4fc4'],
    ['#7b4', '#77bb44'],
    ['#7b4fc4ff', '#7b4fc4'],
    ['#7b4f', '#77bb44'],
    ['rgb(124, 79, 196)', '#7c4fc4'],
    ['rgba(124 79 196 / 0.5)', '#7c4fc4'],
    ['rgb(100%, 0%, 0%)', '#ff0000'],
    ['Dark Grey', '#a9a9a9'],
    ['dark_gray', '#a9a9a9'],
    ['light-blue', '#add8e6'],
    ['  PURPLE  ', '#800080'],
  ])('%s -> %s', (input, expected) => {
    expect(toHexColour(input)).toBe(expected);
  });

  it.each([['rainbow'], ['multicoloured'], ['sparkly'], [''], ['#12345'], [null], [42]])(
    'rejects %s',
    (input) => {
      expect(toHexColour(input)).toBeNull();
    },
  );
});
