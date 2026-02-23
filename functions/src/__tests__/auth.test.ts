/**
 * Tez — Auth Middleware Tests
 */

import * as functions from 'firebase-functions';

// Must import after firebase-functions is available
import { assertAuth, assertRole, getCompanyId } from '../middleware/auth';

const makeContext = (overrides: Partial<functions.https.CallableContext> = {}): functions.https.CallableContext => ({
  rawRequest: {} as never,
  ...overrides,
});

describe('assertAuth()', () => {
  it('should throw when no auth context', () => {
    const ctx = makeContext({ auth: undefined });
    expect(() => assertAuth(ctx)).toThrow('Must be signed in.');
  });

  it('should return auth when present', () => {
    const ctx = makeContext({
      auth: {
        uid: 'user-1',
        token: { uid: 'user-1' } as never,
      },
    });
    const result = assertAuth(ctx);
    expect(result.uid).toBe('user-1');
  });
});

describe('assertRole()', () => {
  it('should throw when role missing', () => {
    const ctx = makeContext({
      auth: {
        uid: 'user-1',
        token: { uid: 'user-1', companyId: 'c1' } as never,
      },
    });
    expect(() => assertRole(ctx, ['admin'])).toThrow('Requires role');
  });

  it('should throw when role does not match', () => {
    const ctx = makeContext({
      auth: {
        uid: 'user-1',
        token: { uid: 'user-1', role: 'viewer', companyId: 'c1' } as never,
      },
    });
    expect(() => assertRole(ctx, ['admin', 'operator'])).toThrow('Requires role');
  });

  it('should return AuthContext when role matches', () => {
    const ctx = makeContext({
      auth: {
        uid: 'user-1',
        token: { uid: 'user-1', role: 'admin', companyId: 'c1', email: 'a@b.com' } as never,
      },
    });
    const result = assertRole(ctx, ['admin']);
    expect(result.uid).toBe('user-1');
    expect(result.role).toBe('admin');
    expect(result.companyId).toBe('c1');
  });

  it('should throw when no companyId', () => {
    const ctx = makeContext({
      auth: {
        uid: 'user-1',
        token: { uid: 'user-1', role: 'admin' } as never,
      },
    });
    expect(() => assertRole(ctx, ['admin'])).toThrow('no company assigned');
  });
});

describe('getCompanyId()', () => {
  it('should return companyId from token', () => {
    const ctx = makeContext({
      auth: {
        uid: 'user-1',
        token: { uid: 'user-1', companyId: 'company-42' } as never,
      },
    });
    expect(getCompanyId(ctx)).toBe('company-42');
  });

  it('should throw when no companyId', () => {
    const ctx = makeContext({
      auth: {
        uid: 'user-1',
        token: { uid: 'user-1' } as never,
      },
    });
    expect(() => getCompanyId(ctx)).toThrow('no company assigned');
  });
});
