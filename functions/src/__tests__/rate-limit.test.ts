/**
 * Tez — Rate Limiting Tests
 */

import { checkRateLimitSync } from '../middleware/rate-limit';

describe('checkRateLimitSync()', () => {
  it('should allow requests within limit', () => {
    // Use a unique UID for each test to avoid interference
    const uid = `test-user-${Date.now()}-${Math.random()}`;
    expect(() => {
      for (let i = 0; i < 30; i++) {
        checkRateLimitSync(uid);
      }
    }).not.toThrow();
  });

  it('should throw when rate limit exceeded', () => {
    const uid = `rate-limit-exceeded-${Date.now()}`;
    // Fill up the limit
    for (let i = 0; i < 30; i++) {
      checkRateLimitSync(uid);
    }
    // 31st should throw
    expect(() => checkRateLimitSync(uid)).toThrow('Too many requests');
  });

  it('should track different users independently', () => {
    const uid1 = `user-a-${Date.now()}`;
    const uid2 = `user-b-${Date.now()}`;

    // Max out user 1
    for (let i = 0; i < 30; i++) {
      checkRateLimitSync(uid1);
    }

    // User 2 should be fine
    expect(() => checkRateLimitSync(uid2)).not.toThrow();
  });
});
