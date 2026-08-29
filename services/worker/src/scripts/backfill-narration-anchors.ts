/**
 * Give narrations that already exist their measured sentence boundaries.
 *
 * New narrations get anchored in the pipeline, where the PCM is already in
 * memory. Stories made before that have audio in storage and no timings, and
 * re-narrating them would cost money and change the voice a family already
 * knows. Downloading and analysing is free, so this does that instead.
 *
 *   pnpm --filter @papercub/worker backfill:anchors -- --dry-run
 *   pnpm --filter @papercub/worker backfill:anchors
 *
 * `--dry-run` writes nothing and prints where each page turn moves to, which is
 * also how the detector was checked against real audio in the first place.
 */

import { createClient } from '@supabase/supabase-js';
import { buildNarrationTimeline, splitStorySentences } from '@papercub/shared';
import { loadConfig } from '../config.ts';
import { alignNarration } from '../narration-alignment.ts';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const config = loadConfig();
  const db = createClient(config.EXPO_PUBLIC_SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: narrations, error } = await db
    .from('narrations')
    .select('id, story_id, storage_key, duration_ms, word_timings_key');
  if (error) throw error;

  /* Every narration, not just the ones missing timings: this re-runs to upgrade
   * a file written by an older version of the detector. Uploads are upsert and
   * the key is derived, so re-running is safe and idempotent. */
  console.log(`${narrations?.length ?? 0} narration(s)\n`);

  for (const narration of narrations ?? []) {
    const { data: pages, error: pagesError } = await db
      .from('story_pages')
      .select('index, text')
      .eq('story_id', narration.story_id)
      .order('index', { ascending: true });
    if (pagesError) throw pagesError;
    if (!pages || pages.length === 0) {
      console.log(`${narration.story_id}  SKIP no pages`);
      continue;
    }

    const { data: file, error: downloadError } = await db.storage
      .from('narration')
      .download(narration.storage_key.replace(/^narration\//, ''));
    if (downloadError || !file) {
      console.log(`${narration.story_id}  SKIP download failed`);
      continue;
    }
    const wav = new Uint8Array(await file.arrayBuffer());

    const alignment = alignNarration(wav, pages, narration.duration_ms);
    const sentences = splitStorySentences(pages);
    if (!alignment) {
      console.log(
        `${narration.story_id}  SKIP no alignment (${sentences.length} sentences) — the reader keeps the modelled fallback`,
      );
      continue;
    }

    if (dryRun) {
      const before = buildNarrationTimeline(pages, narration.duration_ms);
      const after = buildNarrationTimeline(pages, narration.duration_ms, alignment.timings);
      console.log(
        `${narration.story_id}  ${sentences.length} sentences, ${pages.length} pages, ` +
          `${alignment.anchoredCount}/${alignment.boundaryCount} sentence boundaries + ` +
          `${alignment.clauseAnchoredCount} clauses measured`,
      );
      for (let i = 0; i < after.pages.length; i += 1) {
        const b = before.pages[i]!;
        const a = after.pages[i]!;
        const delta = a.startMs - b.startMs;
        console.log(
          `    page ${a.pageIndex} starts ${String(b.startMs).padStart(6)}ms modelled -> ` +
            `${String(a.startMs).padStart(6)}ms measured  (${delta >= 0 ? '+' : ''}${delta}ms)`,
        );
      }
      console.log('');
      continue;
    }

    const timingsKey = narration.storage_key.replace(/\.[^.]+$/, '') + '.timings.json';
    const { error: uploadError } = await db.storage
      .from('narration')
      .upload(timingsKey.replace(/^narration\//, ''), JSON.stringify(alignment.timings), {
        contentType: 'application/json',
        upsert: true,
      });
    if (uploadError) throw uploadError;

    const { error: updateError } = await db
      .from('narrations')
      .update({ word_timings_key: timingsKey, sentence_level_only: true })
      .eq('id', narration.id);
    if (updateError) throw updateError;

    console.log(
      `${narration.story_id}  anchored ${alignment.anchoredCount}/${alignment.boundaryCount} ` +
        `sentence boundaries + ${alignment.clauseAnchoredCount} clauses`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
