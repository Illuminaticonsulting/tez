/**
 * Tez — Auth Middleware Stress Tests
 *
 * Exhaustive boundary testing for assertAuth, assertRole, getCompanyId.
 * Tests: invalid roles, missing claims, edge-case tokens, ROLES validation.
 */

import * as functions from 'firebase-functions';
import { assertAuth, assertRole, getCompanyId } from '../middleware/auth';
import { ROLES } from '../types';

const makeContext = (overrides: Partial<functions.https.CallableContext> = {}): functions.https.CallableContext => ({
  rawRequest: {} as never,
  ...overrides,
});

// ═══════════════════════════════════════════════════════════════════════
//  assertAuth — Stress Tests
// ═══════════════════════════════════════════════════════════════════════

describe('assertAuth() stress tests', () => {
  it('should throw on undefined auth', () => {
    expect(() => assertAuth(makeContext())).toThrow();
  });

  it('should throw on null auth', () => {
    expect(() => assertAuth(makeContext({ auth: undefined }))).toThrow();
  });

  it('should return auth data with minimal token', () => {
    const ctx = makeContext({
      auth: { uid: 'u1', token: { uid: 'u1' } as never },
    });
    const result = assertAuth(ctx);
    expect(result.uid).toBe('u1');
  });

  it('should handle UIDs with special characters', () => {
    const specialUids = [
      'user@example.com',
      'user+tag@example.com',
      '123456789',
      'a'.repeat(128),
      'unicode-用户-test',
    ];
    for (const uid of specialUids) {
      const ctx = makeContext({
        auth: { uid, token: { uid } as never },
      });
      const result = assertAuth(ctx);
      expect(result.uid).toBe(uid);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  assertRole — Stress Tests
// ═══════════════════════════════════════════════════════════════════════

describe('assertRole() stress tests', () => {
  const validCtx = (role: string, companyId = 'c1') =>
    makeContext({
      auth: {
        uid: 'u1',
        token: { uid: 'u1', role, companyId, email: 'a@b.com' } as never,
      },
    });

  it('should accept each valid ROLES value', () => {
    for (const role of ROLES) {
      const ctx = validCtx(role);
      const result = assertRole(ctx, [role]);
      expect(result.role).toBe(role);
      expect(result.companyId).toBe('c1');
    }
  });

  it('should reject invalid role strings that are not in ROLES', () => {
    const invalidRoles = ['Admin', 'ADMIN', 'superadmin', 'root', '', 'operator ', ' admin'];
    for (const role of invalidRoles) {
      const ctx = validCtx(role);
      expect(() => assertRole(ctx, ['admin'])).toThrow('Requires role');
    }
  });

  it('should reject when role is undefined in token', () => {
    const ctx = makeContext({
      auth: {
        uid: 'u1',
        token: { uid: 'u1', companyId: 'c1' } as never,
      },
    });
    expect(() => assertRole(ctx, ['admin'])).toThrow();
  });

  it('should reject when role is null in token', () => {
    const ctx = makeContext({
      auth: {
        uid: 'u1',
        token: { uid: 'u1', role: null, companyId: 'c1' } as never,
      },
    });
    expect(() => assertRole(ctx, ['admin'])).toThrow();
  });

  it('should accept when role matches any in the allowed array', () => {
    const ctx = validCtx('operator');
    const result = assertRole(ctx, ['admin', 'operator']);
    expect(result.role).toBe('operator');
  });

  it('should reject when role is valid but not in allowed array', () => {
    const ctx = validCtx('viewer');
    expect(() => assertRole(ctx, ['admin', 'operator'])).toThrow('Requires role');
  });

  it('should throw with descriptive message including allowed roles', () => {
    const ctx = validCtx('viewer');
    try {
      assertRole(ctx, ['admin', 'operator']);
      fail('Should have thrown');
    } catch (err: any) {
      expect(err.message).toContain('admin');
      expect(err.message).toContain('operator');
    }
  });

  it('should throw on missing companyId', () => {
    const ctx = makeContext({
      auth: {
        uid: 'u1',
        token: { uid: 'u1', role: 'admin' } as never,
      },
    });
    expect(() => assertRole(ctx, ['admin'])).toThrow('company');
  });

  it('should throw on empty string companyId', () => {
    const ctx = makeContext({
      auth: {
        uid: 'u1',
        token: { uid: 'u1', role: 'admin', companyId: '' } as never,
      },
    });
    expect(() => assertRole(ctx, ['admin'])).toThrow('company');
  });

  it('should handle all ROLES permutations for multi-role access', () => {
    // Every combination should succeed if role is in allowed list
    for (const allowed of ROLES) {
      for (const actual of ROLES) {
        const ctx = validCtx(actual);
        if (actual === allowed) {
          expect(assertRole(ctx, [allowed]).role).toBe(actual);
        } else {
          expect(() => assertRole(ctx, [allowed])).toThrow();
        }
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  getCompanyId — Edge Cases
// ═══════════════════════════════════════════════════════════════════════

describe('getCompanyId() stress tests', () => {
  it('should extract companyId from token', () => {
    const ctx = makeContext({
      auth: {
        uid: 'u1',
        token: { uid: 'u1', companyId: 'comp-123' } as never,
      },
    });
    expect(getCompanyId(ctx)).toBe('comp-123');
  });

  it('should return companyId with special characters', () => {
    const specialIds = ['company_with_underscores', 'company-with-dashes', '123numeric'];
    for (const id of specialIds) {
      const ctx = makeContext({
        auth: {
          uid: 'u1',
          token: { uid: 'u1', companyId: id } as never,
        },
      });
      expect(getCompanyId(ctx)).toBe(id);
    }
  });

  it('should throw when no auth context for getCompanyId', () => {
    const ctx = makeContext();
    expect(() => getCompanyId(ctx)).toThrow();
  });
});
