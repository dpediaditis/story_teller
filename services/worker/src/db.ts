/**
 * The service-role Supabase client and the real WorkerDb / WorkerQueue.
 *
 * docs/ARCHITECTURE.md, "The service-role rule": this key bypasses RLS
 * completely and lives in exactly one place. Every ownership check that RLS
 * would have made for us must therefore be made explicitly here — the queue
 * payload names the parent, and rows are written against ids the payload
 * supplied, which the Edge Function already validated against the caller's JWT
 * before enqueueing.
 *
 * Writes that touch money or quota go through the security-definer functions
 * (record_cost, refund_story_quota) rather than raw UPDATEs, so the arithmetic
 * lives in one audited place and cannot drift between callers.
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { STORAGE_BUCKETS, parseStorageKey } from '@papercub/shared';
import type { Database, JobProgressEvent, StoryPageStatus, StoryStatus } from '@papercub/shared';
import type { WorkerConfig } from './config';
import type {
  CharacterRecord,
  IllustrationRow,
  JobPatch,
  NarrationRow,
  QueueMessage,
  RecordCostArgs,
  ModerationEventRecord,
  StoryPageRow,
  StoryRecord,
  WorkerDb,
  WorkerQueue,
} from './ports';

export type ServiceClient = SupabaseClient<Database>;

export function createServiceClient(config: WorkerConfig): ServiceClient {
  return createClient<Database>(
    config.EXPO_PUBLIC_SUPABASE_URL,
    config.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** Storage keys carry their bucket as the first segment; the API wants it split. */
function splitKey(storageKey: string): { bucket: string; path: string } {
  const parsed = parseStorageKey(storageKey);
  if (!parsed) throw new Error(`Malformed storage key: ${storageKey}`);
  const path = storageKey.slice(parsed.bucket.length + 1);
  return { bucket: parsed.bucket, path };
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  if (result.data === null) throw new Error(`${what}: no rows returned`);
  return result.data;
}

export function createWorkerDb(client: ServiceClient): WorkerDb {
  // The generated Database type does not describe the security-definer RPCs'
  // return shapes, and typing every call site around that adds noise without
  // adding safety.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpc = (name: string, args: Record<string, unknown>) => (client as any).rpc(name, args);

  return {
    async recordCost({ request, costCentsDelta, final }: RecordCostArgs) {
      // record_cost takes only (job, cents, final): the DB is the ledger of
      // money, and per-call provider/model/token detail has no column. It is
      // still carried on RecordCostRequest and logged here, because "which
      // model spent this" is the first question asked when a cost/story average
      // drifts past COST_PER_STORY_ALERT_CENTS (DECISIONS.md §6).
      const { error } = await rpc('record_cost', {
        p_job_id: request.jobId,
        p_cost_cents: costCentsDelta,
        p_final: final,
      });
      if (error) throw new Error(`record_cost failed: ${error.message}`);
    },

    async refundStoryQuota(jobId: string) {
      const { data, error } = await rpc('refund_story_quota', { p_job_id: jobId });
      if (error) throw new Error(`refund_story_quota failed: ${error.message}`);
      const result = (data ?? {}) as { refunded?: boolean; alreadyRefunded?: boolean };
      return {
        refunded: result.refunded === true,
        alreadyRefunded: result.alreadyRefunded === true,
      };
    },

    async globalSpendTodayCents() {
      // Measured spend across every account since midnight UTC. generation_jobs
      // .cost_cents is the per-job measured total maintained by record_cost, so
      // this is real spend, not an estimate — which is the whole point of the
      // cap (DECISIONS.md §3.3).
      const since = new Date();
      since.setUTCHours(0, 0, 0, 0);

      const { data, error } = await client
        .from('generation_jobs')
        .select('cost_cents')
        .gte('created_at', since.toISOString());

      if (error) throw new Error(`globalSpendTodayCents failed: ${error.message}`);
      return (data ?? []).reduce((sum, row) => sum + (row.cost_cents ?? 0), 0);
    },

    async recordModeration(req: ModerationEventRecord) {
      const { error } = await client.from('moderation_events').insert({
        parent_id: req.parentId,
        subject_type: req.subjectType,
        subject_id: req.subjectId,
        stage: req.stage,
        verdict: req.verdict,
        categories: req.categories,
        action_taken: req.actionTaken,
        provider: req.provider,
        raw_score: req.rawScore,
      });
      if (error) throw new Error(`moderation_events insert failed: ${error.message}`);
    },

    async updateJob(jobId: string, patch: JobPatch) {
      const row: Record<string, unknown> = {};
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.stage !== undefined) row.stage = patch.stage;
      if (patch.pagesCompleted !== undefined) row.pages_completed = patch.pagesCompleted;
      if (patch.pagesTotal !== undefined) row.pages_total = patch.pagesTotal;
      if (patch.errorCode !== undefined) row.error_code = patch.errorCode;
      if (patch.startedAt !== undefined) row.started_at = patch.startedAt;
      if (patch.finishedAt !== undefined) row.finished_at = patch.finishedAt;
      if (patch.attempts !== undefined) row.attempts = patch.attempts;
      if (patch.latencyMs !== undefined) row.latency_ms = patch.latencyMs;
      if (Object.keys(row).length === 0) return;

      const { error } = await client.from('generation_jobs').update(row as never).eq('id', jobId);
      if (error) throw new Error(`generation_jobs update failed: ${error.message}`);
    },

    async emitProgress(event: JobProgressEvent) {
      // Realtime channel `job:{jobId}`, per docs/ARCHITECTURE.md. The client
      // also polls GET jobs/:id every 2s, so a dropped broadcast degrades to
      // slightly staler progress rather than a stuck screen — which is why a
      // send failure is not allowed to fail the job.
      const channel = client.channel(`job:${event.jobId}`);
      try {
        await channel.send({ type: 'broadcast', event: 'progress', payload: event });
      } finally {
        await client.removeChannel(channel);
      }
    },

    async loadCharacters(characterIds: string[]): Promise<CharacterRecord[]> {
      const { data, error } = await client
        .from('characters')
        .select(
          'id, name, character_type, personality_traits, palette, feature_anchor, ' +
            'drawing_id, original_drawings(cutout_storage_key), ' +
            'character_assets(id, storage_key, kind, is_primary)',
        )
        .in('id', characterIds);

      if (error) throw new Error(`characters select failed: ${error.message}`);

      // Embedded selects are not described by the generated Database type.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((row: any) => ({
        id: row.id,
        name: row.name,
        characterType: row.character_type,
        personalityTraits: row.personality_traits ?? [],
        palette: row.palette ?? [],
        featureAnchor: row.feature_anchor,
        cutoutStorageKey: row.original_drawings?.cutout_storage_key ?? '',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        referenceAssets: (row.character_assets ?? []).map((a: any) => ({
          id: a.id,
          storageKey: a.storage_key,
          kind: a.kind,
        })),
      }));
    },

    async loadStory(storyId: string): Promise<StoryRecord> {
      const { data, error } = await client
        .from('stories')
        .select(
          'id, child_id, render_technique, ' +
            'child_profiles(age_band), ' +
            'story_characters(character_id, order_index), ' +
            // scene_description is selected HERE and only here: the worker needs
            // it to redraw a page. It must never appear in a client-facing
            // select — StoryPageDto has no field for it.
            'story_pages(index, text, scene_description, regen_count)',
        )
        .eq('id', storyId)
        .single();

      if (error) throw new Error(`stories select failed: ${error.message}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = data as any;

      return {
        id: row.id,
        childId: row.child_id,
        ageBand: row.child_profiles?.age_band,
        locale: 'en-GB',
        renderTechnique: row.render_technique,
        characterIds: (row.story_characters ?? [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .sort((a: any, b: any) => a.order_index - b.order_index)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((c: any) => c.character_id),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pages: (row.story_pages ?? []).map((p: any) => ({
          index: p.index,
          text: p.text,
          sceneDescription: p.scene_description,
          regenCount: p.regen_count,
        })),
      };
    },

    async downloadObject(storageKey: string) {
      const { bucket, path } = splitKey(storageKey);
      const { data, error } = await client.storage.from(bucket).download(path);
      if (error) throw new Error(`storage download failed for ${storageKey}: ${error.message}`);
      return new Uint8Array(await data.arrayBuffer());
    },

    async uploadObject(storageKey: string, bytes: Uint8Array, contentType: string) {
      const { bucket, path } = splitKey(storageKey);
      const { error } = await client.storage
        .from(bucket)
        .upload(path, bytes, { contentType, upsert: true });
      if (error) throw new Error(`storage upload failed for ${storageKey}: ${error.message}`);
    },

    async setStoryStatus(storyId: string, status: StoryStatus, extra) {
      const row: Record<string, unknown> = { status };
      if (extra?.title !== undefined) row.title = extra.title;
      if (extra?.completedAt !== undefined) row.completed_at = extra.completedAt;
      if (extra?.coverAssetId !== undefined) row.cover_asset_id = extra.coverAssetId;

      const { error } = await client.from('stories').update(row as never).eq('id', storyId);
      if (error) throw new Error(`stories update failed: ${error.message}`);
    },

    async insertStoryPages(storyId: string, pages: StoryPageRow[]) {
      const { error } = await client.from('story_pages').insert(
        pages.map((p) => ({
          story_id: storyId,
          index: p.index,
          text: p.text,
          scene_description: p.sceneDescription,
          status: p.status,
          // parent_id is set by the story_pages_set_parent_id trigger. The
          // worker must not supply it — the trigger is what guarantees the
          // denormalised RLS column can never disagree with the real owner.
        })) as never,
      );
      if (error) throw new Error(`story_pages insert failed: ${error.message}`);
    },

    async setStoryPageStatus(storyId: string, index: number, status: StoryPageStatus) {
      const { error } = await client
        .from('story_pages')
        .update({ status })
        .eq('story_id', storyId)
        .eq('index', index);
      if (error) throw new Error(`story_pages status update failed: ${error.message}`);
    },

    async insertIllustration(row: IllustrationRow) {
      const result = await client
        .from('page_illustrations')
        .insert({
          story_id: row.storyId,
          page_index: row.pageIndex,
          storage_key: row.storageKey,
          width: row.width,
          height: row.height,
          model_id: row.modelId,
          seed: row.seed,
          reference_asset_ids: row.referenceAssetIds,
          cost_cents: row.costCents,
        } as never)
        .select('id')
        .single();

      return unwrap(result, 'page_illustrations insert').id;
    },

    async replaceIllustration(row: IllustrationRow) {
      // A regeneration supersedes the previous image for this page. The unique
      // (story_id, page_index) index makes this an upsert, not an insert.
      const result = await client
        .from('page_illustrations')
        .upsert(
          {
            story_id: row.storyId,
            page_index: row.pageIndex,
            storage_key: row.storageKey,
            width: row.width,
            height: row.height,
            model_id: row.modelId,
            seed: row.seed,
            reference_asset_ids: row.referenceAssetIds,
            cost_cents: row.costCents,
          } as never,
          { onConflict: 'story_id,page_index' },
        )
        .select('id')
        .single();

      return unwrap(result, 'page_illustrations upsert').id;
    },

    async linkPageIllustration(storyId: string, pageIndex: number, illustrationId: string) {
      const { error } = await client
        .from('story_pages')
        .update({ illustration_asset_id: illustrationId })
        .eq('story_id', storyId)
        .eq('index', pageIndex);
      if (error) throw new Error(`story_pages illustration link failed: ${error.message}`);
    },

    async insertNarration(row: NarrationRow) {
      const { error } = await client.from('narrations').insert({
        story_id: row.storyId,
        voice_id: row.voiceId,
        provider: row.provider,
        storage_key: row.storageKey,
        duration_ms: row.durationMs,
        word_timings_key: row.wordTimingsKey,
        sentence_level_only: row.sentenceLevelOnly,
        language: row.language,
      } as never);
      if (error) throw new Error(`narrations insert failed: ${error.message}`);
    },

    async incrementPageRegenCount(storyId: string, pageIndex: number) {
      const current = await client
        .from('story_pages')
        .select('regen_count')
        .eq('story_id', storyId)
        .eq('index', pageIndex)
        .single();

      const next = (unwrap(current, 'story_pages regen_count select').regen_count ?? 0) + 1;

      const { error } = await client
        .from('story_pages')
        .update({ regen_count: next })
        .eq('story_id', storyId)
        .eq('index', pageIndex);
      if (error) throw new Error(`story_pages regen_count update failed: ${error.message}`);
      return next;
    },

    async updateCharacterFromAnalysis(characterId, patch) {
      const { error } = await client
        .from('characters')
        .update({
          feature_anchor: patch.featureAnchor,
          palette: patch.palette,
          status: patch.status,
        })
        .eq('id', characterId);
      if (error) throw new Error(`characters update failed: ${error.message}`);
    },

    async insertCharacterAsset(row) {
      const { error } = await client.from('character_assets').insert({
        character_id: row.characterId,
        kind: row.kind,
        storage_key: row.storageKey,
        model_id: row.modelId,
        prompt_hash: row.promptHash,
        is_primary: row.isPrimary,
        width_px: row.widthPx,
        height_px: row.heightPx,
      } as never);
      if (error) throw new Error(`character_assets insert failed: ${error.message}`);
    },
  };
}

/* ── Queue ────────────────────────────────────────────────────────────── */

/**
 * pgmq lives in its own schema and is not exposed through PostgREST by default.
 * Supabase ships a `pgmq_public` wrapper for this; some projects instead add
 * `pgmq` to the exposed schemas. We try the wrapper first and fall back, so the
 * worker runs against either configuration without a migration.
 */
export function createWorkerQueue(
  client: ServiceClient,
  queueName: string,
  dlqName: string,
): WorkerQueue {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyClient = client as any;

  /**
   * Three ways a Supabase project can expose pgmq, in preference order:
   *
   *   'public'       queue_read/queue_send/... wrappers (migration
   *                  20260826180000). Needs NO dashboard configuration, so this
   *                  is tried first — a stock project exposes only `public` and
   *                  `graphql_public`, which is why the other two failed.
   *   'pgmq_public'  Supabase's Queues integration, if enabled.
   *   'pgmq'         projects that added pgmq to Exposed schemas directly.
   *
   * The public wrappers use different function names AND argument labels, so
   * the call is translated rather than just re-pointed at another schema.
   */
  type QueueFlavour = 'public' | 'pgmq_public' | 'pgmq';
  let flavour: QueueFlavour | null = null;

  const PUBLIC_QUEUE_FN: Record<string, string> = {
    read: 'queue_read',
    send: 'queue_send',
    delete: 'queue_delete',
    archive: 'queue_archive',
  };

  function toPublicArgs(fn: string, a: Record<string, unknown>): Record<string, unknown> {
    if (fn === 'read') {
      return { queue_name: a.queue_name, visibility_seconds: a.sleep_seconds, batch_size: a.n };
    }
    if (fn === 'send') {
      return { queue_name: a.queue_name, message: a.message, delay_seconds: 0 };
    }
    return { queue_name: a.queue_name, message_id: a.message_id };
  }

  async function call(fn: string, args: Record<string, unknown>) {
    const order: QueueFlavour[] = flavour ? [flavour] : ['public', 'pgmq_public', 'pgmq'];
    let lastError: unknown = null;

    for (const candidate of order) {
      const name = candidate === 'public' ? (PUBLIC_QUEUE_FN[fn] ?? fn) : fn;
      const payload = candidate === 'public' ? toPublicArgs(fn, args) : args;
      const q = candidate === 'public' ? anyClient : anyClient.schema(candidate);
      const { data, error } = await q.rpc(name, payload);
      if (!error) {
        flavour = candidate;
        return data;
      }
      lastError = error;
    }
    throw new Error(
      `queue.${fn} failed (tried public, pgmq_public, pgmq): ` +
        (lastError && typeof lastError === 'object' && 'message' in lastError
          ? String((lastError as { message: unknown }).message)
          : String(lastError)),
    );
  }

  return {
    async read(visibilityTimeoutSeconds: number, batchSize: number): Promise<QueueMessage[]> {
      const rows = await call('read', {
        queue_name: queueName,
        sleep_seconds: visibilityTimeoutSeconds,
        n: batchSize,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((rows ?? []) as any[]).map((r) => ({
        msgId: Number(r.msg_id),
        readCt: Number(r.read_ct),
        message: r.message,
      }));
    },

    async delete(msgId: number) {
      await call('delete', { queue_name: queueName, message_id: msgId });
    },

    async moveToDlq(msg: QueueMessage) {
      // Send first, then delete. The other order can lose a message entirely if
      // the process dies between the two; this order can at worst duplicate one
      // into the DLQ, which is a table nobody bills against.
      await call('send', { queue_name: dlqName, message: msg.message });
      await call('delete', { queue_name: queueName, message_id: msg.msgId });
    },
  };
}

export { STORAGE_BUCKETS };
