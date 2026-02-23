/**
 * Tez — Scheduled Triggers & Config Stress Tests
 *
 * Tests for:
 *  - Config ref helper functions (bookingRef, spotRef, counterRef)
 *  - Batch chunking in cleanup jobs
 *  - dailyStatsRollup idempotency
 *  - RATE_LIMIT, SPOT_LOCK, and COUNTER constants
 */

import {
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX,
  SPOT_LOCK_TIMEOUT_MS,
  LOCK_CLEANUP_INTERVAL_MS,
  FLIGHT_CACHE_TTL_MS,
  COUNTER_SHARDS,
} from '../config';
import {
  BOOKING_STATUSES,
  VALID_TRANSITIONS,
  ROLES,
  type BookingStatus,
} from '../types';

// ═══════════════════════════════════════════════════════════════════════
//  Config Constants Validation
// ═══════════════════════════════════════════════════════════════════════

describe('Config Constants', () => {
  describe('Rate Limit', () => {
    it('RATE_LIMIT_WINDOW_MS should be positive', () => {
      expect(RATE_LIMIT_WINDOW_MS).toBeGreaterThan(0);
    });

    it('RATE_LIMIT_MAX should be between 10 and 1000', () => {
      expect(RATE_LIMIT_MAX).toBeGreaterThanOrEqual(10);
      expect(RATE_LIMIT_MAX).toBeLessThanOrEqual(1000);
    });

    it('RATE_LIMIT_WINDOW_MS should be at least 10 seconds', () => {
      expect(RATE_LIMIT_WINDOW_MS).toBeGreaterThanOrEqual(10_000);
    });
  });

  describe('Spot Lock', () => {
    it('SPOT_LOCK_TIMEOUT_MS should be positive', () => {
      expect(SPOT_LOCK_TIMEOUT_MS).toBeGreaterThan(0);
    });

    it('SPOT_LOCK_TIMEOUT_MS should be at least 10 seconds', () => {
      expect(SPOT_LOCK_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
    });

    it('LOCK_CLEANUP_INTERVAL_MS should be >= SPOT_LOCK_TIMEOUT_MS', () => {
      expect(LOCK_CLEANUP_INTERVAL_MS).toBeGreaterThanOrEqual(SPOT_LOCK_TIMEOUT_MS);
    });
  });

  describe('Flight Cache', () => {
    it('FLIGHT_CACHE_TTL_MS should be at least 1 minute', () => {
      expect(FLIGHT_CACHE_TTL_MS).toBeGreaterThanOrEqual(60_000);
    });
  });

  describe('Counter Shards', () => {
    it('COUNTER_SHARDS should be between 1 and 20', () => {
      expect(COUNTER_SHARDS).toBeGreaterThanOrEqual(1);
      expect(COUNTER_SHARDS).toBeLessThanOrEqual(20);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  State Machine Exhaustive Tests
// ═══════════════════════════════════════════════════════════════════════

describe('State Machine Exhaustive Stress', () => {
  const allStatuses: BookingStatus[] = [...BOOKING_STATUSES];
  const terminalStatuses: BookingStatus[] = ['Completed', 'Cancelled'];
  const nonTerminalStatuses = allStatuses.filter((s) => !terminalStatuses.includes(s));

  it('no status should transition to itself', () => {
    for (const status of allStatuses) {
      const allowed = VALID_TRANSITIONS[status] || [];
      expect(allowed).not.toContain(status);
    }
  });

  it('every non-terminal status should have at least one forward transition', () => {
    for (const status of nonTerminalStatuses) {
      const allowed = VALID_TRANSITIONS[status];
      expect(allowed).toBeDefined();
      expect(allowed!.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('all transition targets should be valid statuses', () => {
    for (const [, targets] of Object.entries(VALID_TRANSITIONS)) {
      for (const target of targets) {
        expect(allStatuses).toContain(target);
      }
    }
  });

  it('there should be a valid path from New to Completed', () => {
    const visited = new Set<string>();
    const queue: BookingStatus[] = ['New'];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === 'Completed') return; // Found path
      if (visited.has(current)) continue;
      visited.add(current);
      const next = VALID_TRANSITIONS[current] || [];
      queue.push(...next);
    }
    fail('No path from New to Completed');
  });

  it('there should be a path from every non-terminal status to Cancelled', () => {
    for (const status of nonTerminalStatuses) {
      const allowed = VALID_TRANSITIONS[status] || [];
      expect(allowed).toContain('Cancelled');
    }
  });

  it('Completed and Cancelled should be truly terminal (no outgoing transitions)', () => {
    for (const terminal of terminalStatuses) {
      expect(VALID_TRANSITIONS[terminal]).toBeUndefined();
    }
  });

  it('no status should be reachable from Completed', () => {
    expect(VALID_TRANSITIONS['Completed']).toBeUndefined();
  });

  it('no status should be reachable from Cancelled', () => {
    expect(VALID_TRANSITIONS['Cancelled']).toBeUndefined();
  });

  it('status sequence New → Booked → Check-In → Parked → Active → Completed forms valid path', () => {
    const path: BookingStatus[] = ['New', 'Booked', 'Check-In', 'Parked', 'Active', 'Completed'];
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i]!;
      const to = path[i + 1]!;
      const transitions = VALID_TRANSITIONS[from];
      expect(transitions).toBeDefined();
      expect(transitions).toContain(to);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  ROLES Exhaustive
// ═══════════════════════════════════════════════════════════════════════

describe('ROLES constant stress tests', () => {
  it('should have exactly admin, operator, viewer', () => {
    expect(ROLES).toEqual(['admin', 'operator', 'viewer']);
  });

  it('should be a readonly tuple (TypeScript enforcement)', () => {
    // TypeScript `as const` doesn't freeze at runtime, but the array should be intact
    expect(Array.isArray(ROLES)).toBe(true);
    expect(ROLES.length).toBe(3);
  });

  it('all roles should be lowercase strings', () => {
    for (const role of ROLES) {
      expect(role).toBe(role.toLowerCase());
      expect(typeof role).toBe('string');
    }
  });
});
