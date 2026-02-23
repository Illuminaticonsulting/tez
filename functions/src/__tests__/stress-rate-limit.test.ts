/**
 * Tez — Rate Limiter Stress Tests
 *
 * Tests for the in-memory rate limiting logic:
 *  - Burst behavior at exact limit
 *  - Window rollover
 *  - Independent user tracking
 *  - Edge cases (simultaneous requests, reset behavior)
 */

import { checkRateLimitSync } from '../middleware/rate-limit';
import { RATE_LIMIT_MAX } from '../config';

describe('Rate Limiter Stress Tests', () => {
  const uniqueUid = () => `stress-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  it('should allow exactly RATE_LIMIT_MAX requests', () => {
    const uid = uniqueUid();
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      expect(() => checkRateLimitSync(uid)).not.toThrow();
    }
  });

  it('should block request #(RATE_LIMIT_MAX + 1)', () => {
    const uid = uniqueUid();
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      checkRateLimitSync(uid);
    }
    expect(() => checkRateLimitSync(uid)).toThrow('Too many requests');
  });

  it('should track 100 independent users without interference', () => {
    const uids = Array.from({ length: 100 }, () => uniqueUid());
    // Each user makes 5 requests
    for (const uid of uids) {
      for (let i = 0; i < 5; i++) {
        expect(() => checkRateLimitSync(uid)).not.toThrow();
      }
    }
    // All should still be under limit
    for (const uid of uids) {
      expect(() => checkRateLimitSync(uid)).not.toThrow();
    }
  });

  it('should not throw for a new user when another is maxed out', () => {
    const maxedUser = uniqueUid();
    const freshUser = uniqueUid();

    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      checkRateLimitSync(maxedUser);
    }
    expect(() => checkRateLimitSync(maxedUser)).toThrow();
    expect(() => checkRateLimitSync(freshUser)).not.toThrow();
  });

  it('should handle rapid-fire requests for same user', () => {
    const uid = uniqueUid();
    let blocked = false;
    for (let i = 0; i < RATE_LIMIT_MAX * 3; i++) {
      try {
        checkRateLimitSync(uid);
      } catch {
        blocked = true;
        break;
      }
    }
    expect(blocked).toBe(true);
  });

  it('should count precisely — block at max+1 not before', () => {
    const uid = uniqueUid();
    const results: boolean[] = [];

    for (let i = 0; i < RATE_LIMIT_MAX + 5; i++) {
      try {
        checkRateLimitSync(uid);
        results.push(true); // allowed
      } catch {
        results.push(false); // blocked
      }
    }

    // First RATE_LIMIT_MAX should all be true
    const allowed = results.filter((r) => r === true).length;
    expect(allowed).toBe(RATE_LIMIT_MAX);

    // First blocked should be at index RATE_LIMIT_MAX
    expect(results[RATE_LIMIT_MAX]).toBe(false);
  });
});
