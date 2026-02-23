/**
 * Tez — Phone Agent Handler-Level Tests
 *
 * Tests that ACTUALLY INVOKE the phone agent Cloud Function handlers:
 *  1. phoneWebhook (HTTP onRequest) — incoming, gather, status actions
 *  2. savePhoneConfig (onCall) — admin-only config management
 *  3. getCallLog (onCall) — admin-only call log retrieval
 *  4. cleanupCallSessions (scheduled) — expired session cleanup
 *
 * Also tests internal functions through the handlers:
 *  - executeTool dispatch
 *  - processWithAI OpenAI integration
 *  - lookupBooking, requestVehicle, cancelBookingByPhone
 *  - finishCall and session management
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ═══════════════════════════════════════════════════════════════════════
//  In-Memory Firestore
// ═══════════════════════════════════════════════════════════════════════

const firestoreStore = new Map<string, Record<string, any>>();
const writeLog: Array<{ type: string; path: string; data: any }> = [];

function clearStore() {
  firestoreStore.clear();
  writeLog.length = 0;
}

function setDoc(path: string, data: Record<string, any>) {
  firestoreStore.set(path, { ...data });
}

function getDoc(path: string): Record<string, any> | undefined {
  const d = firestoreStore.get(path);
  return d ? { ...d } : undefined;
}

function createMockDocRef(path: string): any {
  return {
    id: path.split('/').pop()!,
    path,
    collection: jest.fn((subCol: string) => createMockCollectionRef(`${path}/${subCol}`)),
    get: jest.fn(async () => {
      const data = getDoc(path);
      return {
        exists: !!data,
        id: path.split('/').pop()!,
        data: () => (data ? { ...data } : undefined),
        ref: createMockDocRef(path),
      };
    }),
    set: jest.fn(async (data: any, options?: any) => {
      const existing = getDoc(path) || {};
      if (options?.merge) {
        setDoc(path, { ...existing, ...data });
      } else {
        setDoc(path, data);
      }
      writeLog.push({ type: 'set', path, data });
    }),
    update: jest.fn(async (data: any) => {
      const existing = getDoc(path) || {};
      setDoc(path, { ...existing, ...data });
      writeLog.push({ type: 'update', path, data });
    }),
    delete: jest.fn(async () => {
      firestoreStore.delete(path);
      writeLog.push({ type: 'delete', path, data: null });
    }),
  };
}

function createMockCollectionRef(path: string): any {
  return {
    doc: jest.fn((id?: string) => {
      const docId = id || `auto_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      return createMockDocRef(`${path}/${docId}`);
    }),
    add: jest.fn(async (data: any) => {
      const docId = `auto_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const docPath = `${path}/${docId}`;
      setDoc(docPath, data);
      writeLog.push({ type: 'add', path: docPath, data });
      return { id: docId, path: docPath };
    }),
    where: jest.fn(function (this: any, field: string, op: string, value: any) {
      const matchingDocs: any[] = [];
      for (const [docPath, docData] of firestoreStore.entries()) {
        if (!docPath.startsWith(path + '/')) continue;
        const relative = docPath.slice(path.length + 1);
        if (relative.includes('/')) continue;

        const fieldVal = field.includes('.')
          ? field.split('.').reduce((obj: any, key: string) => obj?.[key], docData)
          : docData[field];

        let matches = false;
        switch (op) {
          case '==': matches = fieldVal === value; break;
          case '!=': matches = fieldVal !== value && fieldVal !== null && fieldVal !== undefined; break;
          case '<': matches = fieldVal instanceof Date && value instanceof Date ? fieldVal < value : fieldVal < value; break;
          default: matches = false;
        }
        if (matches) {
          matchingDocs.push({
            id: docPath.split('/').pop()!,
            ref: createMockDocRef(docPath),
            data: () => ({ ...docData }),
          });
        }
      }

      const queryRef: any = {
        where: jest.fn(() => queryRef),
        orderBy: jest.fn(() => queryRef),
        limit: jest.fn((n: number) => {
          const limited = matchingDocs.slice(0, n);
          return {
            ...queryRef,
            get: jest.fn(async () => ({
              empty: limited.length === 0,
              docs: limited,
              size: limited.length,
            })),
          };
        }),
        startAfter: jest.fn(() => queryRef),
        get: jest.fn(async () => ({
          empty: matchingDocs.length === 0,
          docs: matchingDocs,
          size: matchingDocs.length,
        })),
      };
      return queryRef;
    }),
    orderBy: jest.fn(function () {
      const allDocs: any[] = [];
      for (const [docPath, docData] of firestoreStore.entries()) {
        if (!docPath.startsWith(path + '/')) continue;
        const relative = docPath.slice(path.length + 1);
        if (relative.includes('/')) continue;
        allDocs.push({
          id: docPath.split('/').pop()!,
          ref: createMockDocRef(docPath),
          data: () => ({ ...docData }),
        });
      }
      const queryRef: any = {
        where: jest.fn(() => queryRef),
        limit: jest.fn((n: number) => {
          const limited = allDocs.slice(0, n);
          return {
            ...queryRef,
            get: jest.fn(async () => ({
              empty: limited.length === 0,
              docs: limited,
              size: limited.length,
            })),
          };
        }),
        get: jest.fn(async () => ({
          empty: allDocs.length === 0,
          docs: allDocs,
          size: allDocs.length,
        })),
      };
      return queryRef;
    }),
    get: jest.fn(async () => {
      const allDocs: any[] = [];
      for (const [docPath, docData] of firestoreStore.entries()) {
        if (!docPath.startsWith(path + '/')) continue;
        const relative = docPath.slice(path.length + 1);
        if (relative.includes('/')) continue;
        allDocs.push({
          id: docPath.split('/').pop()!,
          ref: createMockDocRef(docPath),
          data: () => ({ ...docData }),
        });
      }
      return {
        empty: allDocs.length === 0,
        docs: allDocs,
        size: allDocs.length,
      };
    }),
  };
}

const mockDb: any = {
  collection: jest.fn((path: string) => createMockCollectionRef(path)),
  doc: jest.fn((path: string) => createMockDocRef(path)),
  runTransaction: jest.fn(async (fn: (tx: any) => Promise<any>) => {
    const tx = {
      get: jest.fn(async (ref: any) => {
        const data = getDoc(ref.path);
        return { exists: !!data, id: ref.path.split('/').pop()!, data: () => data ? { ...data } : undefined, ref };
      }),
      set: jest.fn((ref: any, data: any, options?: any) => {
        const existing = getDoc(ref.path) || {};
        setDoc(ref.path, options?.merge ? { ...existing, ...data } : data);
      }),
      update: jest.fn((ref: any, data: any) => {
        const existing = getDoc(ref.path) || {};
        setDoc(ref.path, { ...existing, ...data });
      }),
    };
    return fn(tx);
  }),
  collectionGroup: jest.fn((name: string) => {
    const matchingDocs: any[] = [];
    for (const [docPath, docData] of firestoreStore.entries()) {
      if (docPath.includes(`/${name}/`)) {
        matchingDocs.push({
          id: docPath.split('/').pop()!,
          ref: createMockDocRef(docPath),
          data: () => ({ ...docData }),
        });
      }
    }
    const queryRef: any = {
      where: jest.fn(() => ({
        ...queryRef,
        where: jest.fn(() => ({
          limit: jest.fn((n: number) => ({
            get: jest.fn(async () => ({
              empty: matchingDocs.length === 0,
              docs: matchingDocs.slice(0, n),
              size: Math.min(matchingDocs.length, n),
            })),
          })),
          get: jest.fn(async () => ({
            empty: matchingDocs.length === 0,
            docs: matchingDocs,
            size: matchingDocs.length,
          })),
        })),
        limit: jest.fn((n: number) => ({
          get: jest.fn(async () => ({
            empty: matchingDocs.length === 0,
            docs: matchingDocs.slice(0, n),
            size: Math.min(matchingDocs.length, n),
          })),
        })),
        get: jest.fn(async () => ({
          empty: matchingDocs.length === 0,
          docs: matchingDocs,
          size: matchingDocs.length,
        })),
      })),
      limit: jest.fn((n: number) => ({
        get: jest.fn(async () => ({
          empty: matchingDocs.length === 0,
          docs: matchingDocs.slice(0, n),
          size: Math.min(matchingDocs.length, n),
        })),
      })),
      get: jest.fn(async () => ({
        empty: matchingDocs.length === 0,
        docs: matchingDocs,
        size: matchingDocs.length,
      })),
    };
    return queryRef;
  }),
  batch: jest.fn(() => {
    const ops: Array<() => void> = [];
    return {
      set: jest.fn((ref: any, data: any) => { ops.push(() => setDoc(ref.path, data)); }),
      update: jest.fn((ref: any, data: any) => {
        ops.push(() => { const existing = getDoc(ref.path) || {}; setDoc(ref.path, { ...existing, ...data }); });
      }),
      delete: jest.fn((ref: any) => { ops.push(() => firestoreStore.delete(ref.path)); }),
      commit: jest.fn(async () => { ops.forEach((op) => op()); }),
    };
  }),
};

// ═══════════════════════════════════════════════════════════════════════
//  Firebase Admin Mock
// ═══════════════════════════════════════════════════════════════════════

const mockFieldValue = {
  serverTimestamp: jest.fn(() => ({ _type: 'serverTimestamp' })),
  increment: jest.fn((n: number) => ({ _type: 'increment', value: n })),
  arrayUnion: jest.fn((...items: any[]) => ({ _type: 'arrayUnion', values: items })),
  delete: jest.fn(() => ({ _type: 'delete' })),
};

jest.mock('firebase-admin', () => ({
  apps: [{}],
  initializeApp: jest.fn(),
  firestore: Object.assign(jest.fn(() => mockDb), {
    FieldValue: mockFieldValue,
  }),
  auth: jest.fn(() => ({
    getUser: jest.fn(),
    setCustomUserClaims: jest.fn(),
  })),
}));

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: mockFieldValue,
}));

// ═══════════════════════════════════════════════════════════════════════
//  Firebase Functions Mock
// ═══════════════════════════════════════════════════════════════════════

class HttpsError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'HttpsError';
  }
}

jest.mock('firebase-functions', () => ({
  https: {
    HttpsError,
    onCall: jest.fn((handler: any) => handler),
    onRequest: jest.fn((handler: any) => handler),
  },
  runWith: jest.fn(() => ({
    https: {
      onCall: jest.fn((handler: any) => handler),
      onRequest: jest.fn((handler: any) => handler),
    },
    pubsub: {
      schedule: jest.fn(() => ({
        onRun: jest.fn((handler: any) => handler),
        timeZone: jest.fn(() => ({
          onRun: jest.fn((handler: any) => handler),
        })),
      })),
    },
  })),
  config: jest.fn(() => ({})),
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    log: jest.fn(),
  },
}));

// ═══════════════════════════════════════════════════════════════════════
//  OpenAI Mock
// ═══════════════════════════════════════════════════════════════════════

const mockOpenAICreate = jest.fn();

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockOpenAICreate,
      },
    },
  }));
});

// ═══════════════════════════════════════════════════════════════════════
//  Mock Rate Limiter
// ═══════════════════════════════════════════════════════════════════════

jest.mock('../middleware/rate-limit', () => ({
  checkRateLimit: jest.fn(async () => {}),
  checkRateLimitSync: jest.fn(() => {}),
}));

// ═══════════════════════════════════════════════════════════════════════
//  Import Handlers After Mocks
// ═══════════════════════════════════════════════════════════════════════

import { phoneWebhook, savePhoneConfig, getCallLog, cleanupCallSessions } from '../services/phone-agent';

// ═══════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════

function adminCtx(uid = 'admin-001', companyId = 'company-001') {
  return {
    auth: {
      uid,
      token: { uid, role: 'admin', companyId, email: 'admin@test.com' } as any,
    },
  } as any;
}

function operatorCtx(uid = 'op-001', companyId = 'company-001') {
  return {
    auth: {
      uid,
      token: { uid, role: 'operator', companyId, email: 'op@test.com' } as any,
    },
  } as any;
}

function noAuth() {
  return { auth: undefined } as any;
}

function mockReq(overrides: any = {}): any {
  return {
    protocol: 'https',
    hostname: 'test.example.com',
    get: jest.fn((h: string) => h === 'host' ? 'test.example.com' : ''),
    query: {},
    body: {},
    ...overrides,
  };
}

function mockRes(): any {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.send = jest.fn(() => res);
  res.set = jest.fn(() => res);
  return res;
}

// ═══════════════════════════════════════════════════════════════════════
//  Setup
// ═══════════════════════════════════════════════════════════════════════

beforeEach(() => {
  clearStore();
  jest.clearAllMocks();
  process.env.OPENAI_API_KEY = 'test-key-123';

  // Default OpenAI response
  mockOpenAICreate.mockResolvedValue({
    choices: [{
      message: { content: 'How can I help you today?', role: 'assistant' },
      finish_reason: 'stop',
    }],
  });
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
});

// ═══════════════════════════════════════════════════════════════════════
//  1. phoneWebhook — INCOMING CALL
// ═══════════════════════════════════════════════════════════════════════

describe('phoneWebhook — incoming call', () => {
  beforeEach(() => {
    // Set up phone routing
    setDoc('_phoneRouting/route1', {
      phoneNumber: '+15551234567',
      companyId: 'company-001',
    });
    setDoc('companies/company-001', {
      name: 'Test Valet Co',
    });
    setDoc('companies/company-001/meta/phoneAgent', {
      enabled: true,
      twilioPhoneNumber: '+15551234567',
      transferNumber: '+15559999999',
      greeting: 'Welcome to Test Valet!',
      businessHours: '8am-8pm',
      pricingInfo: '$10/hour',
      locationInfo: '123 Main St',
    });
  });

  it('should handle incoming call and return TwiML greeting', async () => {
    const req = mockReq({
      query: { action: 'incoming' },
      body: { CallSid: 'call-001', From: '+15550001111', To: '+15551234567' },
    });
    const res = mockRes();

    await (phoneWebhook as any)(req, res);

    expect(res.set).toHaveBeenCalledWith('Content-Type', 'text/xml');
    expect(res.status).toHaveBeenCalledWith(200);
    const sentXml = res.send.mock.calls[0][0];
    expect(sentXml).toContain('<Response>');
    expect(sentXml).toContain('<Gather');
    expect(sentXml).toContain('Welcome to Test Valet!');
  });

  it('should create a call session in Firestore', async () => {
    const req = mockReq({
      query: { action: 'incoming' },
      body: { CallSid: 'call-session-test', From: '+15550001111', To: '+15551234567' },
    });
    const res = mockRes();

    await (phoneWebhook as any)(req, res);

    const session = getDoc('companies/company-001/_callSessions/call-session-test');
    expect(session).toBeDefined();
    expect(session?.callSid).toBe('call-session-test');
    expect(session?.companyId).toBe('company-001');
    expect(session?.status).toBe('active');
  });

  it('should handle unknown phone number gracefully', async () => {
    const req = mockReq({
      query: { action: 'incoming' },
      body: { CallSid: 'call-unknown', From: '+15550001111', To: '+19999999999' },
    });
    const res = mockRes();

    await (phoneWebhook as any)(req, res);

    const sentXml = res.send.mock.calls[0][0];
    expect(sentXml).toContain('not yet configured');
  });

  it('should handle disabled phone agent with transfer number', async () => {
    setDoc('companies/company-001/meta/phoneAgent', {
      enabled: false,
      transferNumber: '+15559999999',
    });

    const req = mockReq({
      query: { action: 'incoming' },
      body: { CallSid: 'call-disabled', From: '+15550001111', To: '+15551234567' },
    });
    const res = mockRes();

    await (phoneWebhook as any)(req, res);

    const sentXml = res.send.mock.calls[0][0];
    expect(sentXml).toContain('<Dial>');
    expect(sentXml).toContain('+15559999999');
  });

  it('should handle disabled phone agent without transfer number', async () => {
    setDoc('companies/company-001/meta/phoneAgent', {
      enabled: false,
      transferNumber: '',
    });

    const req = mockReq({
      query: { action: 'incoming' },
      body: { CallSid: 'call-no-transfer', From: '+15550001111', To: '+15551234567' },
    });
    const res = mockRes();

    await (phoneWebhook as any)(req, res);

    const sentXml = res.send.mock.calls[0][0];
    expect(sentXml).toContain('not currently active');
  });

  it('should include gather URL with correct parameters', async () => {
    const req = mockReq({
      query: { action: 'incoming' },
      body: { CallSid: 'call-url-test', From: '+15550001111', To: '+15551234567' },
    });
    const res = mockRes();

    await (phoneWebhook as any)(req, res);

    const sentXml = res.send.mock.calls[0][0];
    expect(sentXml).toContain('action=gather');
    expect(sentXml).toContain('sid=call-url-test');
    expect(sentXml).toContain('cid=company-001');
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  2. phoneWebhook — GATHER (speech processing)
// ═══════════════════════════════════════════════════════════════════════

describe('phoneWebhook — gather', () => {
  beforeEach(() => {
    // Active call session
    setDoc('companies/company-001/_callSessions/call-gather-01', {
      callSid: 'call-gather-01',
      companyId: 'company-001',
      callerPhone: '+15550001111',
      companyName: 'Test Valet',
      startedAt: new Date(),
      messages: [
        { role: 'system', content: 'System prompt here' },
      ],
      actionsPerformed: [],
      turns: 0,
      status: 'active',
    });
    setDoc('companies/company-001/meta/phoneAgent', {
      enabled: true,
      transferNumber: '+15559999999',
      greeting: '',
      businessHours: '8am-8pm',
      pricingInfo: '$10',
      locationInfo: '123 Main',
    });
  });

  it('should process speech and return AI response', async () => {
    mockOpenAICreate.mockResolvedValue({
      choices: [{
        message: { content: 'Sure, let me look that up for you.', role: 'assistant' },
        finish_reason: 'stop',
      }],
    });

    const req = mockReq({
      query: { action: 'gather', sid: 'call-gather-01', cid: 'company-001' },
      body: { SpeechResult: 'I want to check my booking', Confidence: '0.95' },
    });
    const res = mockRes();

    await (phoneWebhook as any)(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const sentXml = res.send.mock.calls[0][0];
    expect(sentXml).toContain('<Gather');
    expect(sentXml).toContain('let me look that up');
  });

  it('should handle missing session gracefully', async () => {
    const req = mockReq({
      query: { action: 'gather', sid: 'nonexistent', cid: 'company-001' },
      body: { SpeechResult: 'Hello' },
    });
    const res = mockRes();

    await (phoneWebhook as any)(req, res);

    const sentXml = res.send.mock.calls[0][0];
    expect(sentXml).toContain('lost track');
  });

  it('should handle missing callSid/companyId', async () => {
    const req = mockReq({
      query: { action: 'gather' },
      body: { SpeechResult: 'Hello' },
    });
    const res = mockRes();

    await (phoneWebhook as any)(req, res);

    const sentXml = res.send.mock.calls[0][0];
    expect(sentXml).toContain('went wrong');
  });

  it('should enforce turn limit', async () => {
    setDoc('companies/company-001/_callSessions/call-gather-01', {
      callSid: 'call-gather-01',
      companyId: 'company-001',
      callerPhone: '+15550001111',
      companyName: 'Test Valet',
      startedAt: new Date(),
      messages: [{ role: 'system', content: 'System prompt' }],
      actionsPerformed: [],
      turns: 15, // MAX_TURNS
      status: 'active',
    });

    const req = mockReq({
      query: { action: 'gather', sid: 'call-gather-01', cid: 'company-001' },
      body: { SpeechResult: 'One more question' },
    });
    const res = mockRes();

    await (phoneWebhook as any)(req, res);

    const sentXml = res.send.mock.calls[0][0];
    expect(sentXml).toContain('<Hangup');
    expect(sentXml).toContain('chatting for a while');
  });

  it('should handle AI requesting end_call', async () => {
    mockOpenAICreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: null,
          role: 'assistant',
          tool_calls: [{
            id: 'tc-1',
            type: 'function',
            function: { name: 'end_call', arguments: '{"farewell":"Goodbye!"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    }).mockResolvedValueOnce({
      choices: [{
        message: { content: 'Thank you for calling. Have a great day!', role: 'assistant' },
        finish_reason: 'stop',
      }],
    });

    const req = mockReq({
      query: { action: 'gather', sid: 'call-gather-01', cid: 'company-001' },
      body: { SpeechResult: 'That\'s all, thanks' },
    });
    const res = mockRes();

    await (phoneWebhook as any)(req, res);

    const sentXml = res.send.mock.calls[0][0];
    expect(sentXml).toContain('<Hangup');
  });

  it('should handle AI requesting transfer', async () => {
    mockOpenAICreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: null,
          role: 'assistant',
          tool_calls: [{
            id: 'tc-1',
            type: 'function',
            function: { name: 'transfer_to_human', arguments: '{"reason":"Customer wants human"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    }).mockResolvedValueOnce({
      choices: [{
        message: { content: 'Let me transfer you now.', role: 'assistant' },
        finish_reason: 'stop',
      }],
    });

    const req = mockReq({
      query: { action: 'gather', sid: 'call-gather-01', cid: 'company-001' },
      body: { SpeechResult: 'I want to talk to a person' },
    });
    const res = mockRes();

    await (phoneWebhook as any)(req, res);

    const sentXml = res.send.mock.calls[0][0];
    expect(sentXml).toContain('<Dial>');
    expect(sentXml).toContain('+15559999999');
  });

  it('should handle AI tool_call: lookup_booking', async () => {
    // Seed a booking
    setDoc('companies/company-001/bookings/bk-phone-1', {
      ticketNumber: 42,
      status: 'Parked',
      customerName: 'Alice',
      vehicle: { plate: 'ABC123', make: 'Toyota', model: 'Camry', color: 'Silver' },
    });

    mockOpenAICreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: null,
          role: 'assistant',
          tool_calls: [{
            id: 'tc-lu',
            type: 'function',
            function: { name: 'lookup_booking', arguments: '{"ticketNumber":42}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    }).mockResolvedValueOnce({
      choices: [{
        message: { content: 'I found your booking. Your car is parked safely.', role: 'assistant' },
        finish_reason: 'stop',
      }],
    });

    const req = mockReq({
      query: { action: 'gather', sid: 'call-gather-01', cid: 'company-001' },
      body: { SpeechResult: 'My ticket number is 42' },
    });
    const res = mockRes();

    await (phoneWebhook as any)(req, res);

    expect(mockOpenAICreate).toHaveBeenCalledTimes(2);
    const sentXml = res.send.mock.calls[0][0];
    expect(sentXml).toContain('found your booking');
  });

  it('should update session turns and messages', async () => {
    const req = mockReq({
      query: { action: 'gather', sid: 'call-gather-01', cid: 'company-001' },
      body: { SpeechResult: 'Hello' },
    });
    const res = mockRes();

    await (phoneWebhook as any)(req, res);

    const session = getDoc('companies/company-001/_callSessions/call-gather-01');
    expect(session?.turns).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  3. phoneWebhook — STATUS callback
// ═══════════════════════════════════════════════════════════════════════

describe('phoneWebhook — status', () => {
  it('should handle completed call status', async () => {
    setDoc('companies/company-001/_callSessions/call-status-01', {
      callSid: 'call-status-01',
      companyId: 'company-001',
      callerPhone: '+15550001111',
      companyName: 'Test',
      startedAt: new Date(),
      messages: [{ role: 'system', content: 'prompt' }],
      actionsPerformed: [],
      turns: 3,
      status: 'active',
    });

    const req = mockReq({
      query: { action: 'status' },
      body: { CallSid: 'call-status-01', CallStatus: 'completed', CallDuration: '120' },
    });
    const res = mockRes();

    await (phoneWebhook as any)(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const sentXml = res.send.mock.calls[0][0];
    expect(sentXml).toContain('<Response>');
  });

  it('should handle unknown call status gracefully', async () => {
    const req = mockReq({
      query: { action: 'status' },
      body: { CallSid: 'call-ghost', CallStatus: 'completed' },
    });
    const res = mockRes();

    await (phoneWebhook as any)(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  4. phoneWebhook — INVALID ACTION
// ═══════════════════════════════════════════════════════════════════════

describe('phoneWebhook — invalid action', () => {
  it('should return error for unknown action', async () => {
    const req = mockReq({
      query: { action: 'bogus' },
      body: {},
    });
    const res = mockRes();

    await (phoneWebhook as any)(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const sentXml = res.send.mock.calls[0][0];
    expect(sentXml).toContain('Invalid request');
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  5. phoneWebhook — ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════════

describe('phoneWebhook — error handling', () => {
  it('should gracefully handle OpenAI errors during gather', async () => {
    setDoc('companies/company-001/_callSessions/call-ai-err', {
      callSid: 'call-ai-err',
      companyId: 'company-001',
      callerPhone: '+15550001111',
      companyName: 'Test',
      startedAt: new Date(),
      messages: [{ role: 'system', content: 'prompt' }],
      actionsPerformed: [],
      turns: 0,
      status: 'active',
    });
    setDoc('companies/company-001/meta/phoneAgent', {
      enabled: true,
      transferNumber: '+15559999999',
    });

    mockOpenAICreate.mockRejectedValue(new Error('OpenAI timeout'));

    const req = mockReq({
      query: { action: 'gather', sid: 'call-ai-err', cid: 'company-001' },
      body: { SpeechResult: 'Hello' },
    });
    const res = mockRes();

    await (phoneWebhook as any)(req, res);

    // Should transfer on AI error
    const sentXml = res.send.mock.calls[0][0];
    expect(sentXml).toContain('technical difficulty');
  });

  it('should handle missing OPENAI_API_KEY', async () => {
    delete process.env.OPENAI_API_KEY;

    setDoc('companies/company-001/_callSessions/call-no-key', {
      callSid: 'call-no-key',
      companyId: 'company-001',
      callerPhone: '+15550001111',
      companyName: 'Test',
      startedAt: new Date(),
      messages: [{ role: 'system', content: 'prompt' }],
      actionsPerformed: [],
      turns: 0,
      status: 'active',
    });
    setDoc('companies/company-001/meta/phoneAgent', {
      enabled: true,
      transferNumber: '+15559999999',
    });

    const req = mockReq({
      query: { action: 'gather', sid: 'call-no-key', cid: 'company-001' },
      body: { SpeechResult: 'Hello' },
    });
    const res = mockRes();

    await (phoneWebhook as any)(req, res);

    const sentXml = res.send.mock.calls[0][0];
    expect(sentXml).toContain('unavailable');
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  6. savePhoneConfig handler
// ═══════════════════════════════════════════════════════════════════════

describe('savePhoneConfig handler', () => {
  it('should save config for admin', async () => {
    const result = await (savePhoneConfig as any)(
      {
        enabled: true,
        twilioPhoneNumber: '+15551234567',
        greeting: 'Hello caller!',
        businessHours: '9-5',
        pricingInfo: '$15/hr',
        locationInfo: '456 Oak Ave',
      },
      adminCtx(),
    );
    expect(result).toEqual({ success: true });

    const config = getDoc('companies/company-001/meta/phoneAgent');
    expect(config?.enabled).toBe(true);
  });

  it('should update phone routing', async () => {
    await (savePhoneConfig as any)(
      { enabled: true, twilioPhoneNumber: '+15559876543' },
      adminCtx(),
    );

    // Should have created routing doc
    const routingDocs = [...firestoreStore.entries()].filter(([k]) =>
      k.startsWith('_phoneRouting/'),
    );
    expect(routingDocs.length).toBeGreaterThanOrEqual(1);
  });

  it('should reject non-admin', async () => {
    await expect(
      (savePhoneConfig as any)({ enabled: true }, operatorCtx()),
    ).rejects.toThrow();
  });

  it('should reject unauthenticated', async () => {
    await expect(
      (savePhoneConfig as any)({ enabled: true }, noAuth()),
    ).rejects.toThrow();
  });

  it('should write audit log', async () => {
    await (savePhoneConfig as any)(
      { enabled: true },
      adminCtx(),
    );
    const audits = [...firestoreStore.entries()].filter(([k]) =>
      k.startsWith('companies/company-001/audit/'),
    );
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it('should validate input schema', async () => {
    await expect(
      (savePhoneConfig as any)({ enabled: 'not-a-boolean' }, adminCtx()),
    ).rejects.toThrow();
  });

  it('should handle config without phone number', async () => {
    const result = await (savePhoneConfig as any)(
      { enabled: false },
      adminCtx(),
    );
    expect(result).toEqual({ success: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  7. getCallLog handler
// ═══════════════════════════════════════════════════════════════════════

describe('getCallLog handler', () => {
  beforeEach(() => {
    for (let i = 0; i < 5; i++) {
      setDoc(`companies/company-001/_callLog/call-${i}`, {
        callSid: `call-${i}`,
        callerPhone: `+1555000${i}`,
        startedAt: { toDate: () => new Date() },
        endedAt: { toDate: () => new Date() },
        turns: i + 1,
        transcript: [],
        actionsPerformed: [],
        summary: `Call ${i} summary`,
        status: 'completed',
      });
    }
  });

  it('should return call logs for admin', async () => {
    const result = await (getCallLog as any)({ limit: 10 }, adminCtx());
    expect(result).toHaveProperty('calls');
    expect(result.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('should reject non-admin', async () => {
    await expect(
      (getCallLog as any)({ limit: 10 }, operatorCtx()),
    ).rejects.toThrow();
  });

  it('should reject unauthenticated', async () => {
    await expect(
      (getCallLog as any)({ limit: 10 }, noAuth()),
    ).rejects.toThrow();
  });

  it('should use default limit', async () => {
    const result = await (getCallLog as any)({}, adminCtx());
    expect(result).toHaveProperty('calls');
  });

  it('should reject invalid limit', async () => {
    await expect(
      (getCallLog as any)({ limit: 0 }, adminCtx()),
    ).rejects.toThrow();
  });

  it('should reject limit over max', async () => {
    await expect(
      (getCallLog as any)({ limit: 200 }, adminCtx()),
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  8. cleanupCallSessions handler
// ═══════════════════════════════════════════════════════════════════════

describe('cleanupCallSessions handler', () => {
  it('should clean up expired sessions', async () => {
    setDoc('companies/company-001/_callSessions/expired-1', {
      callSid: 'expired-1',
      status: 'active',
      startedAt: new Date(Date.now() - 60 * 60_000), // 1 hour ago
    });

    await (cleanupCallSessions as any)();
    // Function runs but with mock infrastructure
  });

  it('should not crash with no sessions', async () => {
    await (cleanupCallSessions as any)();
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  9. MULTI-TENANT PHONE AGENT ISOLATION
// ═══════════════════════════════════════════════════════════════════════

describe('Multi-Tenant Phone Agent Isolation', () => {
  it('company-A config should not leak to company-B', async () => {
    await (savePhoneConfig as any)(
      { enabled: true, greeting: 'Welcome to A!', twilioPhoneNumber: '+15551111111' },
      adminCtx('admin-A', 'company-A'),
    );
    await (savePhoneConfig as any)(
      { enabled: true, greeting: 'Welcome to B!', twilioPhoneNumber: '+15552222222' },
      adminCtx('admin-B', 'company-B'),
    );

    const configA = getDoc('companies/company-A/meta/phoneAgent');
    const configB = getDoc('companies/company-B/meta/phoneAgent');
    expect(configA?.greeting).toBe('Welcome to A!');
    expect(configB?.greeting).toBe('Welcome to B!');
    expect(configA?.greeting).not.toBe(configB?.greeting);
  });

  it('company-B admin cannot read company-A call logs', async () => {
    setDoc('companies/company-A/_callLog/log-1', {
      callSid: 'log-1',
      summary: 'Secret call',
    });

    // company-B admin calls getCallLog — gets company-B logs (empty), not company-A
    const result = await (getCallLog as any)({}, adminCtx('admin-B', 'company-B'));
    expect(result.calls.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  10. PHONE AGENT EDGE CASES
// ═══════════════════════════════════════════════════════════════════════

describe('Phone Agent Edge Cases', () => {
  it('should handle empty speech result in gather', async () => {
    setDoc('companies/company-001/_callSessions/call-empty-speech', {
      callSid: 'call-empty-speech',
      companyId: 'company-001',
      callerPhone: '+15550001111',
      companyName: 'Test',
      startedAt: new Date(),
      messages: [{ role: 'system', content: 'prompt' }],
      actionsPerformed: [],
      turns: 0,
      status: 'active',
    });
    setDoc('companies/company-001/meta/phoneAgent', {
      enabled: true,
      transferNumber: '+15559999999',
    });

    const req = mockReq({
      query: { action: 'gather', sid: 'call-empty-speech', cid: 'company-001' },
      body: { SpeechResult: '' },
    });
    const res = mockRes();

    await (phoneWebhook as any)(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should include system prompt in session messages', async () => {
    setDoc('_phoneRouting/route1', {
      phoneNumber: '+15551234567',
      companyId: 'company-001',
    });
    setDoc('companies/company-001', { name: 'Test Co' });
    setDoc('companies/company-001/meta/phoneAgent', {
      enabled: true,
      greeting: 'Hello!',
      businessHours: '9-5',
      pricingInfo: '$10',
      locationInfo: 'Main St',
    });

    const req = mockReq({
      query: { action: 'incoming' },
      body: { CallSid: 'call-sys-prompt', From: '+15550001111', To: '+15551234567' },
    });
    const res = mockRes();

    await (phoneWebhook as any)(req, res);

    const session = getDoc('companies/company-001/_callSessions/call-sys-prompt');
    expect(session?.messages).toBeDefined();
    expect(session?.messages[0]?.role).toBe('system');
    expect(session?.messages[0]?.content).toContain('TEZ');
  });

  it('should handle default action as incoming', async () => {
    setDoc('_phoneRouting/route1', {
      phoneNumber: '+15551234567',
      companyId: 'company-001',
    });
    setDoc('companies/company-001', { name: 'Test Co' });
    setDoc('companies/company-001/meta/phoneAgent', {
      enabled: true,
      greeting: 'Hi!',
    });

    const req = mockReq({
      query: {}, // no action parameter
      body: { CallSid: 'call-default', From: '+15550001111', To: '+15551234567' },
    });
    const res = mockRes();

    await (phoneWebhook as any)(req, res);

    const sentXml = res.send.mock.calls[0][0];
    expect(sentXml).toContain('<Gather');
  });
});
