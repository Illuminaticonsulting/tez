/**
 * Tez — Logging Middleware Tests
 */

import { generateCorrelationId } from '../middleware/logging';

describe('generateCorrelationId()', () => {
  it('should return a string', () => {
    const id = generateCorrelationId();
    expect(typeof id).toBe('string');
  });

  it('should return a UUID-like format', () => {
    const id = generateCorrelationId();
    // UUID v4 format: 8-4-4-4-12
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('should generate unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateCorrelationId()));
    expect(ids.size).toBe(100);
  });
});
