/**
 * Worker entrypoint.
 *
 * Two loops run side by side:
 *   the generation consumer   drains papercub_generation
 *   the entitlement reconciler drains revenuecat_event_inbox
 *
 * They are separate on purpose. A RevenueCat outage must not stop stories from
 * being generated, and a provider outage must not stop a family's subscription
 * from being recognised.
 *
 * Shutdown is graceful: SIGTERM stops both loops but lets the in-flight job
 * finish. Killing a job mid-pipeline would leave money spent with the
 * reservation unsettled until the visibility timeout redelivered it.
 */

import { QUEUE_NAMES } from '@papercub/shared';
import { loadConfig } from './config';
import { createServiceClient, createWorkerDb, createWorkerQueue } from './db';
import { createLogger } from './logger';
import type { PipelineDeps } from './pipeline/context';
import { createProviderBundle } from './providers';
import { createQueueConsumer } from './queue';
import { createRevenueCatClient, reconcileOnce } from './revenuecat/reconciler';
import { createEntitlementStore } from './revenuecat/store';
import { runJob } from './runner';

const RECONCILE_INTERVAL_MS = 30_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ service: 'papercub-worker', env: config.WORKER_ENV });

  const client = createServiceClient(config);
  const db = createWorkerDb(client);
  const queue = createWorkerQueue(client, QUEUE_NAMES.generation, QUEUE_NAMES.generationDlq);
  const { bundle, moderator } = createProviderBundle(config);

  const deps: PipelineDeps = {
    db,
    providers: bundle,
    moderator,
    logger,
    modelBundleVersion: config.MODEL_BUNDLE_VERSION,
  };

  const consumer = createQueueConsumer({
    queue,
    db,
    logger,
    visibilityTimeoutSeconds: config.QUEUE_VISIBILITY_TIMEOUT_SECONDS,
    pollIntervalMs: config.QUEUE_POLL_INTERVAL_MS,
    batchSize: config.QUEUE_BATCH_SIZE,
    handle: async (job) => {
      const outcome = await runJob({
        job,
        deps,
        globalDailySpendCapCents: config.GLOBAL_DAILY_SPEND_CAP_CENTS,
      });
      return { kind: outcome.kind };
    },
  });

  /* ── Entitlement reconciliation ─────────────────────────────────────── */

  let reconciling = false;
  let reconcileTimer: NodeJS.Timeout | null = null;

  if (config.REVENUECAT_SECRET_API_KEY) {
    const store = createEntitlementStore(client);
    const rcClient = createRevenueCatClient({
      secretApiKey: config.REVENUECAT_SECRET_API_KEY,
      baseUrl: config.REVENUECAT_API_BASE_URL,
    });

    reconciling = true;
    const tick = async () => {
      if (!reconciling) return;
      try {
        const result = await reconcileOnce({ store, client: rcClient, logger });
        if (result.processed + result.failed > 0) {
          logger.info('revenuecat reconcile pass', { ...result });
        }
      } catch (err) {
        logger.error('revenuecat reconcile pass failed', {
          reason: err instanceof Error ? err.message : String(err),
        });
      }
      if (reconciling) reconcileTimer = setTimeout(tick, RECONCILE_INTERVAL_MS);
    };
    reconcileTimer = setTimeout(tick, RECONCILE_INTERVAL_MS);
  } else {
    logger.warn(
      'REVENUECAT_SECRET_API_KEY is not set: entitlement reconciliation is DISABLED. ' +
        'The inbox will fill and no subscription change will be applied.',
    );
  }

  await consumer.start();
  logger.info('worker ready', {
    concurrency: config.WORKER_CONCURRENCY,
    modelBundleVersion: config.MODEL_BUNDLE_VERSION,
    globalDailySpendCapCents: config.GLOBAL_DAILY_SPEND_CAP_CENTS,
  });

  const shutdown = async (signal: string) => {
    logger.info('shutting down', { signal });
    reconciling = false;
    if (reconcileTimer) clearTimeout(reconcileTimer);
    await consumer.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  process.stderr.write(
    JSON.stringify({
      level: 'error',
      msg: 'worker failed to start',
      reason: err instanceof Error ? err.message : String(err),
    }) + '\n',
  );
  process.exit(1);
});
