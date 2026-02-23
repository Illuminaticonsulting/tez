/**
 * Tez — AI Phone Agent Tests
 *
 * Comprehensive test suite covering:
 *  1. TwiML helper functions (pure)
 *  2. XML escaping
 *  3. System prompt builder
 *  4. Zod schema validation
 *  5. OpenAI tool definitions
 *  6. PhoneConfig interface integrity
 */

import { z } from 'zod';

// ─── Mock firebase-functions BEFORE any imports that depend on it ────

jest.mock('firebase-functions', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  runWith: jest.fn().mockReturnThis(),
  https: {
    HttpsError: class HttpsError extends Error {
      code: string;
      constructor(code: string, message: string) {
        super(message);
        this.code = code;
      }
    },
    onCall: jest.fn(),
    onRequest: jest.fn(),
  },
  pubsub: { schedule: jest.fn().mockReturnValue({ onRun: jest.fn() }) },
}));

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
    arrayUnion: jest.fn((...args: unknown[]) => ({ _type: 'arrayUnion', values: args })),
  },
}));

jest.mock('../config', () => ({
  db: {
    collection: jest.fn(),
    doc: jest.fn(),
    collectionGroup: jest.fn(),
    batch: jest.fn(() => ({
      set: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      commit: jest.fn(),
    })),
  },
  functions: jest.requireActual('firebase-functions'),
  STANDARD_OPTIONS: { timeoutSeconds: 60, memory: '256MB' },
  HEAVY_OPTIONS: { timeoutSeconds: 300, memory: '512MB' },
}));

jest.mock('../middleware', () => ({
  assertRole: jest.fn(() => ({ uid: 'test-uid', companyId: 'test-co', role: 'admin' })),
  generateCorrelationId: jest.fn(() => 'test-correlation-id'),
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
  writeAuditLog: jest.fn(),
  validate: jest.fn((schema: z.ZodSchema, data: unknown) => schema.parse(data)),
}));

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
  }));
});

// ─── Now import the module under test ────────────────────────────────

import {
  escapeXml,
  twimlGather,
  twimlSay,
  twimlTransfer,
  twimlHangup,
  buildSystemPrompt,
  SavePhoneConfigSchema,
  GetCallLogSchema,
  TOOLS,
  PhoneConfig,
} from '../services/phone-agent';

// ─── Test Helpers ────────────────────────────────────────────────────

function makeConfig(overrides: Partial<PhoneConfig> = {}): PhoneConfig {
  return {
    enabled: true,
    twilioPhoneNumber: '+15551234567',
    transferNumber: '+15559876543',
    greeting: 'Welcome to Acme Valet!',
    businessHours: 'Mon-Fri 8am-6pm',
    pricingInfo: '$25/day, $15/hour',
    locationInfo: '123 Main Street, Downtown',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 1: XML Escaping
// ═══════════════════════════════════════════════════════════════════════

describe('escapeXml()', () => {
  it('should escape ampersand', () => {
    expect(escapeXml('A & B')).toBe('A &amp; B');
  });

  it('should escape less-than', () => {
    expect(escapeXml('a < b')).toBe('a &lt; b');
  });

  it('should escape greater-than', () => {
    expect(escapeXml('a > b')).toBe('a &gt; b');
  });

  it('should escape double quotes', () => {
    expect(escapeXml('say "hello"')).toBe('say &quot;hello&quot;');
  });

  it('should escape single quotes (apostrophes)', () => {
    expect(escapeXml("it's")).toBe('it&apos;s');
  });

  it('should escape multiple special characters together', () => {
    expect(escapeXml('<a href="x">&</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;'
    );
  });

  it('should return empty string for empty input', () => {
    expect(escapeXml('')).toBe('');
  });

  it('should not alter text without special characters', () => {
    expect(escapeXml('Hello World 123')).toBe('Hello World 123');
  });

  it('should handle consecutive ampersands', () => {
    expect(escapeXml('&&&&')).toBe('&amp;&amp;&amp;&amp;');
  });

  it('should handle unicode characters without escaping', () => {
    expect(escapeXml('こんにちは')).toBe('こんにちは');
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 2: TwiML Helpers
// ═══════════════════════════════════════════════════════════════════════

describe('twimlGather()', () => {
  it('should produce valid TwiML XML', () => {
    const result = twimlGather('Hello there', 'https://example.com/gather');
    expect(result).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(result).toContain('<Response>');
    expect(result).toContain('</Response>');
  });

  it('should include the Say element with escaped text', () => {
    const result = twimlGather('Say "hi"', 'https://x.com/');
    expect(result).toContain('Say &quot;hi&quot;');
  });

  it('should include Gather with speechTimeout and language', () => {
    const result = twimlGather('Hello', 'https://x.com/');
    expect(result).toContain('speechTimeout="auto"');
    expect(result).toContain('language="en-US"');
    expect(result).toContain('input="speech"');
  });

  it('should include the action URL (escaped)', () => {
    const result = twimlGather('Hello', 'https://example.com/gather?action=test&sid=123');
    expect(result).toContain('action="https://example.com/gather?action=test&amp;sid=123"');
  });

  it('should include a fallback Say for no-input', () => {
    const result = twimlGather('Hello', 'https://x.com/');
    expect(result).toContain("I didn&apos;t catch that");
  });

  it('should use the default Polly.Joanna voice', () => {
    const result = twimlGather('Hello', 'https://x.com/');
    expect(result).toContain('voice="Polly.Joanna"');
  });

  it('should set method to POST', () => {
    const result = twimlGather('Hello', 'https://x.com/');
    expect(result).toContain('method="POST"');
  });
});

describe('twimlSay()', () => {
  it('should produce valid TwiML', () => {
    const result = twimlSay('Goodbye');
    expect(result).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(result).toContain('<Response>');
    expect(result).toContain('</Response>');
  });

  it('should include the text in a Say element', () => {
    const result = twimlSay('Hello world');
    expect(result).toContain('<Say voice="Polly.Joanna">Hello world</Say>');
  });

  it('should escape XML characters in the text', () => {
    const result = twimlSay('Prices are < $50 & > $10');
    expect(result).toContain('Prices are &lt; $50 &amp; &gt; $10');
  });

  it('should not contain Gather, Dial, or Hangup elements', () => {
    const result = twimlSay('Just say');
    expect(result).not.toContain('<Gather');
    expect(result).not.toContain('<Dial');
    expect(result).not.toContain('<Hangup');
  });
});

describe('twimlTransfer()', () => {
  it('should include a Say element before the Dial', () => {
    const result = twimlTransfer('Transferring you now', '+15551234567');
    expect(result).toContain('<Say voice="Polly.Joanna">Transferring you now</Say>');
  });

  it('should include a Dial element with the phone number', () => {
    const result = twimlTransfer('Connecting', '+15551234567');
    expect(result).toContain('<Dial>+15551234567</Dial>');
  });

  it('should escape XML characters in the transfer number', () => {
    const result = twimlTransfer('Hold on', '+1<555>');
    expect(result).toContain('<Dial>+1&lt;555&gt;</Dial>');
  });

  it('should escape XML characters in the text', () => {
    const result = twimlTransfer("I'm connecting you", '+15551234567');
    expect(result).toContain('I&apos;m connecting you');
  });

  it('should produce well-formed XML', () => {
    const result = twimlTransfer('a', 'b');
    expect(result).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(result).toContain('<Response>');
    expect(result).toContain('</Response>');
  });
});

describe('twimlHangup()', () => {
  it('should include Say before Hangup', () => {
    const result = twimlHangup('Goodbye!');
    expect(result).toContain('<Say voice="Polly.Joanna">Goodbye!</Say>');
    expect(result).toContain('<Hangup/>');
  });

  it('should have Say appear before Hangup in the output', () => {
    const result = twimlHangup('Bye');
    const sayIdx = result.indexOf('<Say');
    const hangupIdx = result.indexOf('<Hangup');
    expect(sayIdx).toBeLessThan(hangupIdx);
  });

  it('should escape XML characters in the text', () => {
    const result = twimlHangup('Thanks & goodbye!');
    expect(result).toContain('Thanks &amp; goodbye!');
  });

  it('should be valid XML', () => {
    const result = twimlHangup('Bye!');
    expect(result).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(result).toContain('<Response>');
    expect(result).toContain('</Response>');
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 3: System Prompt Builder
// ═══════════════════════════════════════════════════════════════════════

describe('buildSystemPrompt()', () => {
  it('should include the company name', () => {
    const config = makeConfig();
    const prompt = buildSystemPrompt('Acme Valet', config);
    expect(prompt).toContain('Acme Valet');
  });

  it('should include business hours from config', () => {
    const config = makeConfig({ businessHours: 'Mon-Sat 7am-10pm' });
    const prompt = buildSystemPrompt('Test Co', config);
    expect(prompt).toContain('Mon-Sat 7am-10pm');
  });

  it('should include pricing info from config', () => {
    const config = makeConfig({ pricingInfo: '$30/day' });
    const prompt = buildSystemPrompt('Test Co', config);
    expect(prompt).toContain('$30/day');
  });

  it('should include location info from config', () => {
    const config = makeConfig({ locationInfo: '456 Oak Ave' });
    const prompt = buildSystemPrompt('Test Co', config);
    expect(prompt).toContain('456 Oak Ave');
  });

  it('should show "Not specified" when config fields are empty', () => {
    const config = makeConfig({ businessHours: '', pricingInfo: '', locationInfo: '' });
    const prompt = buildSystemPrompt('Test Co', config);
    expect(prompt.match(/Not specified/g)?.length).toBe(3);
  });

  it('should fallback to "our" when company name is empty', () => {
    const config = makeConfig();
    const prompt = buildSystemPrompt('', config);
    expect(prompt).toContain('our');
  });

  it('should include all 6 capabilities', () => {
    const config = makeConfig();
    const prompt = buildSystemPrompt('Test', config);
    expect(prompt).toContain('ticket number');
    expect(prompt).toContain('status');
    expect(prompt).toContain('pickup area');
    expect(prompt).toContain('Cancel');
    expect(prompt).toContain('pricing');
    expect(prompt).toContain('Transfer');
  });

  it('should include the identity verification rule', () => {
    const config = makeConfig();
    const prompt = buildSystemPrompt('Test', config);
    expect(prompt).toContain('verify the customer');
  });

  it('should include the confirmation rule', () => {
    const config = makeConfig();
    const prompt = buildSystemPrompt('Test', config);
    expect(prompt).toContain('shall I go ahead');
  });

  it('should prohibit markdown/formatting', () => {
    const config = makeConfig();
    const prompt = buildSystemPrompt('Test', config);
    expect(prompt).toContain('Do NOT use markdown');
  });

  it('should include status explanations', () => {
    const config = makeConfig();
    const prompt = buildSystemPrompt('Test', config);
    expect(prompt).toContain('"Parked" means');
    expect(prompt).toContain('"Active" means');
    expect(prompt).toContain('"Completed" means');
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 4: Zod Schema Validation
// ═══════════════════════════════════════════════════════════════════════

describe('SavePhoneConfigSchema', () => {
  it('should accept a valid full config', () => {
    const input = {
      enabled: true,
      twilioPhoneNumber: '+15551234567',
      transferNumber: '+15559876543',
      greeting: 'Hello!',
      businessHours: '8am-6pm',
      pricingInfo: '$25/day',
      locationInfo: '123 Main St',
    };
    const result = SavePhoneConfigSchema.parse(input);
    expect(result.enabled).toBe(true);
    expect(result.twilioPhoneNumber).toBe('+15551234567');
  });

  it('should accept minimal config (only enabled required)', () => {
    const result = SavePhoneConfigSchema.parse({ enabled: false });
    expect(result.enabled).toBe(false);
    expect(result.twilioPhoneNumber).toBe('');
    expect(result.transferNumber).toBe('');
    expect(result.greeting).toBe('');
    expect(result.businessHours).toBe('');
    expect(result.pricingInfo).toBe('');
    expect(result.locationInfo).toBe('');
  });

  it('should reject missing enabled field', () => {
    expect(() => SavePhoneConfigSchema.parse({})).toThrow();
  });

  it('should reject non-boolean enabled', () => {
    expect(() => SavePhoneConfigSchema.parse({ enabled: 'yes' })).toThrow();
  });

  it('should reject twilioPhoneNumber longer than 20 chars', () => {
    expect(() =>
      SavePhoneConfigSchema.parse({
        enabled: true,
        twilioPhoneNumber: '+1' + '2'.repeat(19),
      })
    ).toThrow();
  });

  it('should reject greeting longer than 500 chars', () => {
    expect(() =>
      SavePhoneConfigSchema.parse({
        enabled: true,
        greeting: 'x'.repeat(501),
      })
    ).toThrow();
  });

  it('should accept businessHours at max length (500)', () => {
    const result = SavePhoneConfigSchema.parse({
      enabled: true,
      businessHours: 'x'.repeat(500),
    });
    expect(result.businessHours.length).toBe(500);
  });

  it('should default optional strings to empty', () => {
    const result = SavePhoneConfigSchema.parse({ enabled: true });
    expect(result.pricingInfo).toBe('');
    expect(result.locationInfo).toBe('');
  });
});

describe('GetCallLogSchema', () => {
  it('should accept valid limit', () => {
    const result = GetCallLogSchema.parse({ limit: 10 });
    expect(result.limit).toBe(10);
  });

  it('should default limit to 25', () => {
    const result = GetCallLogSchema.parse({});
    expect(result.limit).toBe(25);
  });

  it('should reject limit less than 1', () => {
    expect(() => GetCallLogSchema.parse({ limit: 0 })).toThrow();
  });

  it('should reject limit greater than 100', () => {
    expect(() => GetCallLogSchema.parse({ limit: 101 })).toThrow();
  });

  it('should reject non-integer limit', () => {
    expect(() => GetCallLogSchema.parse({ limit: 5.5 })).toThrow();
  });

  it('should reject negative limit', () => {
    expect(() => GetCallLogSchema.parse({ limit: -1 })).toThrow();
  });

  it('should accept the boundary values', () => {
    expect(GetCallLogSchema.parse({ limit: 1 }).limit).toBe(1);
    expect(GetCallLogSchema.parse({ limit: 100 }).limit).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 5: OpenAI Tool Definitions
// ═══════════════════════════════════════════════════════════════════════

describe('TOOLS (OpenAI function definitions)', () => {
  it('should define exactly 6 tools', () => {
    expect(TOOLS).toHaveLength(6);
  });

  it('should have all tools with type "function"', () => {
    for (const tool of TOOLS) {
      expect(tool.type).toBe('function');
    }
  });

  const expectedToolNames = [
    'lookup_booking',
    'request_vehicle',
    'cancel_booking',
    'get_company_info',
    'transfer_to_human',
    'end_call',
  ];

  it.each(expectedToolNames)('should include tool "%s"', (name) => {
    const found = TOOLS.find((t) => t.function.name === name);
    expect(found).toBeDefined();
  });

  it('should have descriptions for all tools', () => {
    for (const tool of TOOLS) {
      expect(tool.function.description).toBeTruthy();
      expect(typeof tool.function.description).toBe('string');
      expect(tool.function.description!.length).toBeGreaterThan(10);
    }
  });

  it('lookup_booking should accept ticketNumber and licensePlate', () => {
    const lookup = TOOLS.find((t) => t.function.name === 'lookup_booking')!;
    const params = lookup.function.parameters as Record<string, unknown>;
    const props = (params.properties || {}) as Record<string, unknown>;
    expect(props).toHaveProperty('ticketNumber');
    expect(props).toHaveProperty('licensePlate');
  });

  it('request_vehicle should require bookingId', () => {
    const rv = TOOLS.find((t) => t.function.name === 'request_vehicle')!;
    const params = rv.function.parameters as Record<string, unknown>;
    expect(params.required).toContain('bookingId');
  });

  it('cancel_booking should require bookingId', () => {
    const cb = TOOLS.find((t) => t.function.name === 'cancel_booking')!;
    const params = cb.function.parameters as Record<string, unknown>;
    expect(params.required).toContain('bookingId');
  });

  it('get_company_info should have empty properties (no input needed)', () => {
    const ci = TOOLS.find((t) => t.function.name === 'get_company_info')!;
    const params = ci.function.parameters as Record<string, unknown>;
    const props = params.properties as Record<string, unknown>;
    expect(Object.keys(props)).toHaveLength(0);
  });

  it('all tools should have valid JSON Schema parameters', () => {
    for (const tool of TOOLS) {
      const params = tool.function.parameters as Record<string, unknown>;
      expect(params.type).toBe('object');
      expect(params).toHaveProperty('properties');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 6: TwiML Output Consistency
// ═══════════════════════════════════════════════════════════════════════

describe('TwiML output consistency', () => {
  it('all TwiML functions should produce XML declaration', () => {
    const outputs = [
      twimlGather('a', 'https://x.com'),
      twimlSay('b'),
      twimlTransfer('c', '+1234'),
      twimlHangup('d'),
    ];
    for (const output of outputs) {
      expect(output.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    }
  });

  it('all TwiML functions should have matching Response tags', () => {
    const outputs = [
      twimlGather('a', 'https://x.com'),
      twimlSay('b'),
      twimlTransfer('c', '+1234'),
      twimlHangup('d'),
    ];
    for (const output of outputs) {
      expect(output).toContain('<Response>');
      expect(output).toContain('</Response>');
      // Response should only appear once each
      const openCount = (output.match(/<Response>/g) || []).length;
      const closeCount = (output.match(/<\/Response>/g) || []).length;
      expect(openCount).toBe(1);
      expect(closeCount).toBe(1);
    }
  });

  it('twimlGather should have Gather inside Response and Say inside Gather', () => {
    const result = twimlGather('test', 'https://x.com');
    const gatherStart = result.indexOf('<Gather');
    const sayStart = result.indexOf('<Say');
    const gatherEnd = result.indexOf('</Gather>');
    expect(gatherStart).toBeLessThan(sayStart);
    expect(sayStart).toBeLessThan(gatherEnd);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 7: Edge Cases & Stress Tests
// ═══════════════════════════════════════════════════════════════════════

describe('Edge cases & stress tests', () => {
  it('escapeXml should handle very long strings (10K chars)', () => {
    const long = '<>&"\''.repeat(2000);
    const result = escapeXml(long);
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
    expect(result).not.toContain('&"');
  });

  it('twimlGather should handle empty text', () => {
    const result = twimlGather('', 'https://x.com');
    expect(result).toContain('<Say voice="Polly.Joanna"></Say>');
    expect(result).toContain('<Response>');
  });

  it('twimlSay should handle empty text', () => {
    const result = twimlSay('');
    expect(result).toContain('<Say voice="Polly.Joanna"></Say>');
  });

  it('twimlHangup should handle empty text', () => {
    const result = twimlHangup('');
    expect(result).toContain('<Say voice="Polly.Joanna"></Say>');
    expect(result).toContain('<Hangup/>');
  });

  it('twimlTransfer should handle empty text', () => {
    const result = twimlTransfer('', '+1234');
    expect(result).toContain('<Say voice="Polly.Joanna"></Say>');
    expect(result).toContain('<Dial>+1234</Dial>');
  });

  it('buildSystemPrompt should handle all empty config values', () => {
    const config: PhoneConfig = {
      enabled: false,
      twilioPhoneNumber: '',
      transferNumber: '',
      greeting: '',
      businessHours: '',
      pricingInfo: '',
      locationInfo: '',
    };
    const prompt = buildSystemPrompt('', config);
    expect(prompt.length).toBeGreaterThan(100); // Should still produce a meaningful prompt
    expect(prompt).toContain('AI phone assistant');
  });

  it('twimlGather should handle URL with special XML characters', () => {
    const url = 'https://example.com/path?a=1&b=2"c=3';
    const result = twimlGather('Hi', url);
    expect(result).toContain('a=1&amp;b=2&quot;c=3');
  });

  it('SavePhoneConfigSchema should strip extra fields', () => {
    const result = SavePhoneConfigSchema.parse({
      enabled: true,
      extraField: 'should be stripped',
    } as Record<string, unknown>);
    expect((result as Record<string, unknown>).extraField).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 8: Integration-like tests for schema + prompt flow
// ═══════════════════════════════════════════════════════════════════════

describe('Schema → Prompt integration', () => {
  it('should build a valid system prompt from a SavePhoneConfig result', () => {
    const parsed = SavePhoneConfigSchema.parse({
      enabled: true,
      greeting: 'Welcome!',
      businessHours: '9-5',
      pricingInfo: '$10/hr',
      locationInfo: 'Airport Lot A',
    });
    const prompt = buildSystemPrompt('Airport Valet', parsed);
    expect(prompt).toContain('Airport Valet');
    expect(prompt).toContain('9-5');
    expect(prompt).toContain('$10/hr');
    expect(prompt).toContain('Airport Lot A');
  });

  it('tools + prompt together cover all 6 capabilities', () => {
    const config = makeConfig();
    const prompt = buildSystemPrompt('Test', config);
    const toolNames = TOOLS.map((t) => t.function.name);

    // The prompt mentions looking up bookings, and there's a tool for it
    expect(prompt).toContain('Look up bookings');
    expect(toolNames).toContain('lookup_booking');

    // Vehicle retrieval
    expect(prompt).toContain('Request a vehicle');
    expect(toolNames).toContain('request_vehicle');

    // Cancellation
    expect(prompt).toContain('Cancel a booking');
    expect(toolNames).toContain('cancel_booking');

    // Company info
    expect(prompt).toContain('pricing, hours, and location');
    expect(toolNames).toContain('get_company_info');

    // Transfer
    expect(prompt).toContain('Transfer');
    expect(toolNames).toContain('transfer_to_human');

    // End call is available even if not explicitly in prompt
    expect(toolNames).toContain('end_call');
  });
});
