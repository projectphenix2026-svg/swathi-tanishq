// In-process queue with the same behaviour the app relies on from BullMQ:
// one job per id (adding the same id twice does nothing), delayed jobs,
// a send-rate limit, and retries with exponential back-off.
// Jobs live in memory, so on restart the app re-queues unsent messages from the database.

export function createMemoryQueue({
  handler,
  ratePerSecond = 5,
  concurrency = 2,
  maxAttempts = 4,
  backoffMs = (attempt) => 2000 * 2 ** (attempt - 1),
}) {
  const known = new Set();
  const ready = [];
  const timers = new Set();
  const idleWaiters = [];
  const interval = ratePerSecond > 0 ? 1000 / ratePerSecond : 0;
  let nextSlot = 0;
  let active = 0;
  let pumpTimer = null;
  let closed = false;
  const stats = { added: 0, completed: 0, retried: 0, failed: 0 };

  function add(id, data, { delay = 0 } = {}) {
    if (closed) return false;
    if (known.has(id)) return false;
    known.add(id);
    stats.added += 1;
    schedule({ id, data, attemptsMade: 0 }, delay);
    return true;
  }

  function schedule(job, delay) {
    if (delay > 0) {
      const t = setTimeout(() => {
        timers.delete(t);
        ready.push(job);
        pump();
      }, delay);
      timers.add(t);
    } else {
      ready.push(job);
      pump();
    }
  }

  function pump() {
    if (closed || pumpTimer) return;
    while (ready.length && active < concurrency) {
      const now = Date.now();
      if (nextSlot > now) {
        pumpTimer = setTimeout(() => {
          pumpTimer = null;
          pump();
        }, nextSlot - now);
        return;
      }
      nextSlot = Math.max(now, nextSlot) + interval;
      run(ready.shift());
    }
    checkIdle();
  }

  async function run(job) {
    active += 1;
    job.attemptsMade += 1;
    try {
      await handler(job.data, { attempt: job.attemptsMade, maxAttempts, jobId: job.id });
      stats.completed += 1;
    } catch (err) {
      if (err?.retryable && job.attemptsMade < maxAttempts && !closed) {
        stats.retried += 1;
        schedule(job, backoffMs(job.attemptsMade));
      } else {
        stats.failed += 1;
      }
    } finally {
      active -= 1;
      pump();
    }
  }

  function isIdle() {
    return !ready.length && !active && !timers.size && !pumpTimer;
  }

  function checkIdle() {
    if (isIdle()) while (idleWaiters.length) idleWaiters.shift()();
  }

  return {
    kind: 'memory',
    add,
    stats,
    /** Resolves when nothing is waiting, running or scheduled (used by tests). */
    onIdle() {
      return isIdle() ? Promise.resolve() : new Promise((resolve) => idleWaiters.push(resolve));
    },
    async close() {
      closed = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      if (pumpTimer) clearTimeout(pumpTimer);
    },
  };
}
