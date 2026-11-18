import { createHash, randomBytes } from 'node:crypto';

export const emailAddress = (value: unknown) =>
  typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
    ? value.trim().toLowerCase() : null;

export const validPassword = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 12 && Buffer.byteLength(value) <= 72;

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('base64url');

const windowMs = 60_000;

// Serialize only matching IP/email pairs so concurrent failures count before the next attempt.
export class LoginLimiter {
  private attempts = new Map<string, number[]>();
  private pending = new Map<string, Promise<void>>();
  private nextCleanup = 0;

  async verify(key: string, check: () => Promise<boolean>): Promise<'allowed' | 'denied' | 'limited'> {
    const previous = this.pending.get(key);
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.pending.set(key, current);
    await previous;
    try {
      const now = Date.now();
      if (now >= this.nextCleanup) {
        for (const [entry, times] of this.attempts) {
          if (times.every((time) => now - time >= windowMs)) this.attempts.delete(entry);
        }
        this.nextCleanup = now + windowMs;
      }
      const failures = (this.attempts.get(key) ?? []).filter((time) => now - time < windowMs);
      if (failures.length >= 5) return 'limited';
      if (await check()) return 'allowed';
      this.attempts.set(key, [...failures, Date.now()]);
      return 'denied';
    } finally {
      if (this.pending.get(key) === current) this.pending.delete(key);
      release();
    }
  }
}
