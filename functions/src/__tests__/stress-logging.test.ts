/**
 * Tez — Logging Middleware Stress Tests
 *
 * Tests for structured log output, severity levels, and audit log format.
 */

// Mock firebase-functions logger
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  log: jest.fn(),
};

jest.mock('firebase-functions', () => ({
  logger: mockLogger,
}));

jest.mock('../config', () => {
  const addMock = jest.fn().mockResolvedValue({ id: 'audit-1' });
  const auditCollRef = {
    add: addMock,
    doc: jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
      set: jest.fn().mockResolvedValue(undefined),
    }),
  };
  const companyDocRef = {
    collection: jest.fn(() => auditCollRef),
  };
  const companiesCollRef = {
    doc: jest.fn(() => companyDocRef),
  };

  return {
    db: {
      collection: jest.fn((path: string) => {
        if (path === 'companies') return companiesCollRef;
        return auditCollRef;
      }),
    },
    __addMock: addMock,
  };
});

import {
  logInfo,
  logWarn,
  logError,
  generateCorrelationId,
  writeAuditLog,
  type LogContext,
} from '../middleware/logging';
import { db } from '../config';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { __addMock } = require('../config');

describe('Logging Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const ctx: LogContext = {
    correlationId: 'corr-123',
    operation: 'testOp',
    companyId: 'comp-1',
    uid: 'u1',
  };

  describe('logInfo()', () => {
    it('should call logger.info with structured data', () => {
      logInfo(ctx, 'Test message', { key: 'value' });
      expect(mockLogger.info).toHaveBeenCalled();
      const args = mockLogger.info.mock.calls[0];
      expect(args[0]).toContain('Test message');
    });

    it('should include correlationId in log output', () => {
      logInfo(ctx, 'Correlated log');
      const args = mockLogger.info.mock.calls[0];
      const logStr = JSON.stringify(args);
      expect(logStr).toContain('corr-123');
    });

    it('should handle empty extra data', () => {
      expect(() => logInfo(ctx, 'No extra')).not.toThrow();
    });

    it('should handle null/undefined extra gracefully', () => {
      expect(() => logInfo(ctx, 'Null extra', undefined)).not.toThrow();
    });
  });

  describe('logWarn()', () => {
    it('should call logger.warn', () => {
      logWarn(ctx, 'Warning message');
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should include operation context', () => {
      logWarn(ctx, 'Warn with op');
      const args = mockLogger.warn.mock.calls[0];
      const logStr = JSON.stringify(args);
      expect(logStr).toContain('testOp');
    });
  });

  describe('logError()', () => {
    it('should call logger.error', () => {
      logError(ctx, 'Error occurred', new Error('test'));
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should handle non-Error objects', () => {
      expect(() => logError(ctx, 'Non-error', 'string error')).not.toThrow();
      expect(() => logError(ctx, 'Non-error', { code: 500 })).not.toThrow();
      expect(() => logError(ctx, 'Non-error', null)).not.toThrow();
    });

    it('should include error message in log', () => {
      logError(ctx, 'Something failed', new Error('disk full'));
      const logStr = JSON.stringify(mockLogger.error.mock.calls[0]);
      expect(logStr).toContain('Something failed');
    });
  });

  describe('generateCorrelationId()', () => {
    it('should return a non-empty string', () => {
      const id = generateCorrelationId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('should generate unique IDs for 1000 calls', () => {
      const ids = new Set(Array.from({ length: 1000 }, () => generateCorrelationId()));
      expect(ids.size).toBe(1000);
    });

    it('should generate IDs with reasonable length', () => {
      const id = generateCorrelationId();
      expect(id.length).toBeGreaterThanOrEqual(8);
      expect(id.length).toBeLessThanOrEqual(64);
    });
  });

  describe('writeAuditLog()', () => {
    it('should write to Firestore audit collection', async () => {
      await writeAuditLog(db as any, 'comp-1', {
        action: 'booking.create',
        uid: 'u1',
        resourceType: 'booking',
        resourceId: 'b1',
        correlationId: 'corr-1',
      });
      expect(db.collection).toHaveBeenCalled();
    });

    it('should include all required fields', async () => {
      __addMock.mockClear();

      await writeAuditLog(db as any, 'comp-1', {
        action: 'spot.assign',
        uid: 'u1',
        resourceType: 'spot',
        resourceId: 's1',
        details: { bookingId: 'b1' },
        correlationId: 'corr-2',
      });

      expect(__addMock).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'spot.assign',
          uid: 'u1',
          resourceType: 'spot',
          resourceId: 's1',
        }),
      );
    });

    it('should handle audit write failure gracefully', async () => {
      __addMock.mockRejectedValueOnce(new Error('Firestore error'));
      // Should not throw — fire-and-forget
      await expect(
        writeAuditLog(db as any, 'comp-1', {
          action: 'test.fail',
          uid: 'u1',
          resourceType: 'test',
          resourceId: 't1',
          correlationId: 'corr-3',
        }),
      ).resolves.not.toThrow();
    });
  });
});
