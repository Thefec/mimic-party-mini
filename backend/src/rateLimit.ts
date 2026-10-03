/** Close a socket after this many rejected messages. */
export const MAX_DROPPED = 100;

export class TokenBucket {
  private tokens: number;
  private last: number;
  dropped = 0;

  constructor(private readonly rate = 10, private readonly burst = 20, now = Date.now()) {
    this.tokens = burst;
    this.last = now;
  }

  take(now = Date.now()): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    this.dropped++;
    return false;
  }
}
