import { Queue } from 'bull';

import { randomUUID } from 'crypto';

import {
  RedlineDigestScheduler,
  REDLINE_DIGEST_JOB,
} from '../schedulers/redline-digest.scheduler';

/**
 * 7.19 Slice 4 — the digest sweeper is actually SCHEDULED.
 *
 * WHY THIS EXISTS: the app-boot smoke test uses `.compile()`, which resolves the
 * DI graph but deliberately does NOT run `onModuleInit`. So nothing else in the
 * suite proves the repeatable job is ever registered — and a sweeper that never
 * fires fails SILENTLY: every digest would simply never arrive, with no error
 * anywhere. Phase 0 recon also flagged that this repo had never exercised a
 * Bull `repeat: { every: … }` on a NEW queue, so "the API works here" was an
 * assumption rather than a fact.
 *
 * ⚠️ RUNS AGAINST A THROWAWAY, UNIQUELY-NAMED QUEUE — never the real
 * `redline-notifications` queue. The scheduler takes its queue by constructor
 * injection, so the logic under test (scan repeatables → remove ours by name →
 * add with `repeat`) is exercised identically on any queue name.
 *
 * This isolation is a correctness requirement, not tidiness. The spec both
 * REMOVES repeatables by job name and (previously) obliterated the queue; run
 * against the shared queue AFTER this branch ships, that would delete the live
 * backend's registered sweeper — the repeatable is only ever registered in
 * `onModuleInit`, so it would not come back until someone restarted the app,
 * and digests would stop silently. Backend tests run against the shared dev
 * Redis by convention, so the hazard is routine, not hypothetical.
 *
 * The real queue NAME wiring is guaranteed structurally instead: registerQueue,
 * @Processor and @InjectQueue all read the same exported constant, and the
 * app-boot smoke test compiles the module graph.
 */
const REDIS_URL = process.env.REDIS_URL;
const SKIP = !REDIS_URL;
if (SKIP) {
  // eslint-disable-next-line no-console
  console.warn(
    '[redline-digest-scheduler] SKIPPING: REDIS_URL unset — the sweeper ' +
      'registration is NOT proven. A sweeper that never registers fails silently.',
  );
}
const describeReal = SKIP ? describe.skip : describe;

jest.setTimeout(30000);

describeReal('RedlineDigestScheduler — registers the sweeper (real Redis)', () => {
  let queue: Queue;
  // Per-run name — cannot collide with the real queue or a parallel run.
  const throwawayQueueName = `redline-notifications-spec-${randomUUID()}`;

  beforeAll(async () => {
    // `bull` is a CommonJS `export =`; this tsconfig has no esModuleInterop, so
    // a default import resolves to undefined at runtime (the same gotcha
    // CLAUDE.md documents for sanitize-html).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const BullQueue = require('bull');
    queue = new BullQueue(throwawayQueueName, REDIS_URL as string);
    await queue.isReady();
  });

  afterAll(async () => {
    if (queue) {
      // Safe here ONLY because the queue is this run's throwaway.
      await queue.obliterate({ force: true }).catch(() => undefined);
      await queue.close();
    }
  });

  it('onModuleInit registers exactly one repeatable digest job', async () => {
    const scheduler = new RedlineDigestScheduler(queue);
    await scheduler.onModuleInit();

    const jobs = (await queue.getRepeatableJobs()).filter(
      (j) => j.name === REDLINE_DIGEST_JOB,
    );
    expect(jobs).toHaveLength(1);
    // 60s cadence against the 3-minute debounce window.
    expect(jobs[0].every).toBe(60_000);
  });

  it('is idempotent across restarts — a second boot does not duplicate it', async () => {
    const scheduler = new RedlineDigestScheduler(queue);
    await scheduler.onModuleInit();
    await scheduler.onModuleInit();
    await scheduler.onModuleInit();

    const jobs = (await queue.getRepeatableJobs()).filter(
      (j) => j.name === REDLINE_DIGEST_JOB,
    );
    expect(jobs).toHaveLength(1);
  });
});
