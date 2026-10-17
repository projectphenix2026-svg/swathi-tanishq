// Sending queue. BullMQ on Redis when REDIS_URL is set (production, survives restarts,
// can run several workers); otherwise the in-process queue for one machine.
// Job id = the message's idempotency key, so the same message is never queued twice.
import { config } from '../config.js';
import { createMemoryQueue } from './memory.js';

let queue = null;

export async function startQueue(handler) {
  if (queue) return queue;
  if (config.redisUrl) {
    const { Queue, Worker, UnrecoverableError } = await import('bullmq');
    const connection = { url: config.redisUrl, maxRetriesPerRequest: null };
    const q = new Queue('whatsapp-send', { connection });
    const worker = new Worker(
      'whatsapp-send',
      async (job) => {
        try {
          return await handler(job.data, {
            attempt: job.attemptsMade + 1,
            maxAttempts: config.maxAttempts,
            jobId: job.id,
          });
        } catch (err) {
          if (!err?.retryable) throw new UnrecoverableError(err.message);
          throw err;
        }
      },
      {
        connection,
        concurrency: 4,
        limiter: { max: Math.max(1, Math.floor(config.sendRatePerSecond)), duration: 1000 },
      },
    );
    worker.on('error', (err) => console.error('[queue] worker error', err.message));
    queue = {
      kind: 'bullmq',
      async add(id, data, { delay = 0 } = {}) {
        await q.add('send', data, {
          jobId: id.replace(/:/g, '_'), // BullMQ job ids cannot contain ':'
          delay,
          attempts: config.maxAttempts,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { age: 7 * 24 * 3600 },
          removeOnFail: { age: 30 * 24 * 3600 },
        });
        return true;
      },
      async close() {
        await worker.close();
        await q.close();
      },
    };
  } else {
    queue = createMemoryQueue({
      handler,
      ratePerSecond: config.sendRatePerSecond,
      maxAttempts: config.maxAttempts,
    });
  }
  console.log(`[queue] using ${queue.kind} queue`);
  return queue;
}

export function getQueue() {
  if (!queue) throw new Error('Queue not started');
  return queue;
}

export function setQueue(q) {
  queue = q;
}

export async function stopQueue() {
  if (queue) await queue.close();
  queue = null;
}
