export interface TokenBucketOpts {
  capacity: number;        // max tokens (burst)
  refillPerSec: number;    // sustained rate
  now?: () => number;      // for tests
}

export class TokenBucket {
  private tokens: number;
  private lastMs: number;
  private readonly capacity: number;
  private readonly refillPerSec: number;
  private readonly now: () => number;

  constructor(opts: TokenBucketOpts) {
    this.capacity = opts.capacity;
    this.refillPerSec = opts.refillPerSec;
    this.tokens = opts.capacity;
    this.now = opts.now ?? Date.now;
    this.lastMs = this.now();
  }

  tryConsume(): boolean {
    const t = this.now();
    const elapsed = (t - this.lastMs) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.lastMs = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
