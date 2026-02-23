/**
 * Tez — Notification Service Tests
 *
 * Tests for SMS (Twilio) and Email (SendGrid) notification service.
 * Covers:
 *  1. SMS sending — success, missing phone, missing credentials
 *  2. Email sending — success, invalid email, missing credentials
 *  3. Email template generation — all 3 templates
 *  4. Journey dispatchers — all 6 stages
 *  5. Company settings loading fallback
 *  6. Phone number normalization
 *  7. Twilio/SendGrid error handling
 *  8. Graceful degradation when services unavailable
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ═══════════════════════════════════════════════════════════════════════
//  Mock Setup
// ═══════════════════════════════════════════════════════════════════════

const mockTwilioCreate = jest.fn();
const mockSendGridSend = jest.fn();
const mockFirestoreAdd = jest.fn();
const mockFirestoreGet = jest.fn();

// Mock Twilio
jest.mock('twilio', () => {
  return jest.fn(() => ({
    messages: { create: mockTwilioCreate },
  }));
});

// Mock SendGrid
jest.mock('@sendgrid/mail', () => ({
  setApiKey: jest.fn(),
  send: mockSendGridSend,
}));

// Mock config
jest.mock('../config', () => ({
  db: {
    doc: jest.fn((path: string) => ({
      get: jest.fn(async () => {
        const data = mockFirestoreGet(path);
        return {
          exists: !!data,
          data: () => data,
        };
      }),
    })),
    collection: jest.fn((path: string) => ({
      add: mockFirestoreAdd,
    })),
  },
  TWILIO_ACCOUNT_SID: 'test-sid',
  TWILIO_AUTH_TOKEN: 'test-token',
  TWILIO_PHONE_NUMBER: '+15551234567',
  SENDGRID_API_KEY: 'SG.test-key',
  SENDGRID_FROM_EMAIL: 'noreply@test.com',
  SENDGRID_FROM_NAME: 'Test Valet',
}));

// Mock middleware
jest.mock('../middleware/logging', () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

import {
  sendSms,
  sendEmail,
  buildBookingConfirmationEmail,
  buildCompletionReceiptEmail,
  buildCancellationEmail,
  notifyBookingCreated,
  notifyCheckIn,
  notifyParked,
  notifyVehicleReady,
  notifyCompleted,
  notifyCancelled,
  type BookingNotifyData,
} from '../services/notifications';

// ═══════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════

const defaultCtx = { correlationId: 'test-123', operation: 'test' };

function mockBookingData(overrides?: Partial<BookingNotifyData>): BookingNotifyData {
  return {
    companyId: 'comp-1',
    ticketNumber: 42,
    customerName: 'John Doe',
    customerPhone: '+15559876543',
    customerEmail: 'john@example.com',
    vehiclePlate: 'ABC-1234',
    vehicleDescription: 'Red Toyota Camry',
    flightNumber: 'AA123',
    spotName: 'A-12',
    bookingId: 'booking-001',
    paymentAmount: 25.00,
    paymentMethod: 'card',
    cancellationReason: 'Customer request',
    createdAt: '2026-02-23T10:00:00.000Z',
    completedAt: '2026-02-23T14:30:00.000Z',
    ...overrides,
  };
}

function setupCompanySettings(overrides?: Record<string, any>) {
  mockFirestoreGet.mockImplementation((path: string) => {
    if (path.includes('companies/')) {
      return {
        name: 'Test Valet Service',
        settings: {
          autoSendSms: true,
          autoSendEmail: true,
          hourlyRate: 10,
          currency: 'USD',
          ...overrides?.settings,
        },
        smsTextCheckIn: overrides?.smsTextCheckIn || '',
        smsTextExitOut: overrides?.smsTextExitOut || '',
        twilioPhoneNumber: overrides?.twilioPhoneNumber || '',
        ...overrides,
      };
    }
    return null;
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════════════

beforeEach(() => {
  jest.clearAllMocks();
  mockTwilioCreate.mockResolvedValue({ sid: 'SM-test-123' });
  mockSendGridSend.mockResolvedValue([{ statusCode: 202 }]);
  mockFirestoreAdd.mockResolvedValue({ id: 'log-1' });
  setupCompanySettings();
});

// ─── SMS Tests ───────────────────────────────────────────────────────

describe('sendSms', () => {
  it('sends SMS successfully', async () => {
    const result = await sendSms('+15559876543', 'Hello!', 'comp-1', defaultCtx);
    expect(result).toBe(true);
    expect(mockTwilioCreate).toHaveBeenCalledWith({
      body: 'Hello!',
      from: '+15551234567',
      to: '+15559876543',
    });
  });

  it('normalizes phone number without +', async () => {
    const result = await sendSms('5559876543', 'Hello!', 'comp-1', defaultCtx);
    expect(result).toBe(true);
    expect(mockTwilioCreate).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+15559876543' })
    );
  });

  it('skips SMS for empty phone', async () => {
    const result = await sendSms('', 'Hello!', 'comp-1', defaultCtx);
    expect(result).toBe(false);
    expect(mockTwilioCreate).not.toHaveBeenCalled();
  });

  it('skips SMS for short phone number', async () => {
    const result = await sendSms('123', 'Hello!', 'comp-1', defaultCtx);
    expect(result).toBe(false);
    expect(mockTwilioCreate).not.toHaveBeenCalled();
  });

  it('uses custom from number when provided', async () => {
    await sendSms('+15559876543', 'Hello!', 'comp-1', defaultCtx, '+15550001111');
    expect(mockTwilioCreate).toHaveBeenCalledWith(
      expect.objectContaining({ from: '+15550001111' })
    );
  });

  it('logs SMS to Firestore on success', async () => {
    await sendSms('+15559876543', 'Hello!', 'comp-1', defaultCtx);
    expect(mockFirestoreAdd).toHaveBeenCalled();
  });

  it('handles Twilio error gracefully', async () => {
    mockTwilioCreate.mockRejectedValue(new Error('Twilio error'));
    const result = await sendSms('+15559876543', 'Hello!', 'comp-1', defaultCtx);
    expect(result).toBe(false);
  });

  it('logs failed SMS to Firestore', async () => {
    mockTwilioCreate.mockRejectedValue(new Error('Twilio error'));
    await sendSms('+15559876543', 'Hello!', 'comp-1', defaultCtx);
    expect(mockFirestoreAdd).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('strips non-numeric characters from phone', async () => {
    await sendSms('(555) 987-6543', 'Hello!', 'comp-1', defaultCtx);
    expect(mockTwilioCreate).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+15559876543' })
    );
  });
});

// ─── Email Tests ─────────────────────────────────────────────────────

describe('sendEmail', () => {
  it('sends email successfully', async () => {
    const result = await sendEmail('john@example.com', 'Test', '<h1>Hi</h1>', 'comp-1', defaultCtx);
    expect(result).toBe(true);
    expect(mockSendGridSend).toHaveBeenCalledWith({
      to: 'john@example.com',
      from: { email: 'noreply@test.com', name: 'Test Valet' },
      subject: 'Test',
      html: '<h1>Hi</h1>',
    });
  });

  it('skips for invalid email', async () => {
    const result = await sendEmail('not-an-email', 'Test', '<h1>Hi</h1>', 'comp-1', defaultCtx);
    expect(result).toBe(false);
    expect(mockSendGridSend).not.toHaveBeenCalled();
  });

  it('skips for empty email', async () => {
    const result = await sendEmail('', 'Test', '<h1>Hi</h1>', 'comp-1', defaultCtx);
    expect(result).toBe(false);
  });

  it('handles SendGrid error gracefully', async () => {
    mockSendGridSend.mockRejectedValue(new Error('SendGrid error'));
    const result = await sendEmail('john@example.com', 'Test', '<h1>Hi</h1>', 'comp-1', defaultCtx);
    expect(result).toBe(false);
  });

  it('logs sent email to Firestore', async () => {
    await sendEmail('john@example.com', 'Test', '<h1>Hi</h1>', 'comp-1', defaultCtx);
    expect(mockFirestoreAdd).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent', to: 'john@example.com' })
    );
  });

  it('logs failed email to Firestore', async () => {
    mockSendGridSend.mockRejectedValue(new Error('SendGrid error'));
    await sendEmail('john@example.com', 'Test', '<h1>Hi</h1>', 'comp-1', defaultCtx);
    expect(mockFirestoreAdd).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });
});

// ─── Email Template Tests ────────────────────────────────────────────

describe('Email Templates', () => {
  it('buildBookingConfirmationEmail includes ticket number', () => {
    const html = buildBookingConfirmationEmail('Test Co', 42, 'John', 'ABC-1234', 'Red Toyota', 'AA123');
    expect(html).toContain('Ticket #42');
    expect(html).toContain('Test Co');
    expect(html).toContain('John');
    expect(html).toContain('ABC-1234');
    expect(html).toContain('Red Toyota');
    expect(html).toContain('AA123');
    expect(html).toContain('Booking Confirmed');
  });

  it('buildBookingConfirmationEmail works without flight', () => {
    const html = buildBookingConfirmationEmail('Test Co', 1, 'Jane', 'XYZ-999', 'Blue Honda');
    expect(html).toContain('Ticket #1');
    expect(html).not.toContain('Flight');
  });

  it('buildCompletionReceiptEmail includes payment details', () => {
    const html = buildCompletionReceiptEmail('Test Co', 42, 'John', 'ABC-1234', 'Red Toyota', 25.00, 'card', 'USD', '4h 30m');
    expect(html).toContain('$25.00');
    expect(html).toContain('card');
    expect(html).toContain('4h 30m');
    expect(html).toContain('Receipt');
    expect(html).toContain('Completed');
  });

  it('buildCancellationEmail includes reason', () => {
    const html = buildCancellationEmail('Test Co', 42, 'John', 'ABC-1234', 'Customer request');
    expect(html).toContain('Cancelled');
    expect(html).toContain('Customer request');
    expect(html).toContain('#42');
  });

  it('buildCancellationEmail works without reason', () => {
    const html = buildCancellationEmail('Test Co', 42, 'John', 'ABC-1234');
    expect(html).toContain('Cancelled');
    expect(html).not.toContain('Reason');
  });

  it('all templates have proper HTML structure', () => {
    const templates = [
      buildBookingConfirmationEmail('Co', 1, 'N', 'P', 'V'),
      buildCompletionReceiptEmail('Co', 1, 'N', 'P', 'V', 10, 'cash', 'USD', '1h'),
      buildCancellationEmail('Co', 1, 'N', 'P'),
    ];
    for (const html of templates) {
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('</html>');
      expect(html).toContain('container');
    }
  });
});

// ─── Journey Dispatcher Tests ────────────────────────────────────────

describe('notifyBookingCreated', () => {
  it('sends SMS and email', async () => {
    await notifyBookingCreated(mockBookingData());
    expect(mockTwilioCreate).toHaveBeenCalled();
    expect(mockSendGridSend).toHaveBeenCalled();
  });

  it('SMS contains ticket number and plate', async () => {
    await notifyBookingCreated(mockBookingData());
    const smsBody = mockTwilioCreate.mock.calls[0][0].body;
    expect(smsBody).toContain('#42');
    expect(smsBody).toContain('ABC-1234');
  });

  it('skips SMS if no phone', async () => {
    await notifyBookingCreated(mockBookingData({ customerPhone: '' }));
    expect(mockTwilioCreate).not.toHaveBeenCalled();
  });

  it('skips email if no email', async () => {
    await notifyBookingCreated(mockBookingData({ customerEmail: '' }));
    expect(mockSendGridSend).not.toHaveBeenCalled();
  });

  it('skips SMS if autoSendSms is false', async () => {
    setupCompanySettings({ settings: { autoSendSms: false, autoSendEmail: true } });
    await notifyBookingCreated(mockBookingData());
    expect(mockTwilioCreate).not.toHaveBeenCalled();
    expect(mockSendGridSend).toHaveBeenCalled();
  });
});

describe('notifyCheckIn', () => {
  it('sends SMS on check-in', async () => {
    await notifyCheckIn(mockBookingData());
    expect(mockTwilioCreate).toHaveBeenCalled();
    const smsBody = mockTwilioCreate.mock.calls[0][0].body;
    expect(smsBody).toContain('checked in');
  });

  it('uses custom template when configured', async () => {
    setupCompanySettings({ smsTextCheckIn: 'Custom: Ticket #{ticketNumber} for {plate}' });
    await notifyCheckIn(mockBookingData());
    const smsBody = mockTwilioCreate.mock.calls[0][0].body;
    expect(smsBody).toContain('Custom: Ticket #42 for ABC-1234');
  });

  it('does not send email', async () => {
    await notifyCheckIn(mockBookingData());
    expect(mockSendGridSend).not.toHaveBeenCalled();
  });
});

describe('notifyParked', () => {
  it('sends SMS with spot info', async () => {
    await notifyParked(mockBookingData());
    expect(mockTwilioCreate).toHaveBeenCalled();
    const smsBody = mockTwilioCreate.mock.calls[0][0].body;
    expect(smsBody).toContain('safely parked');
    expect(smsBody).toContain('A-12');
  });

  it('works without spot name', async () => {
    await notifyParked(mockBookingData({ spotName: '' }));
    const smsBody = mockTwilioCreate.mock.calls[0][0].body;
    expect(smsBody).toContain('safely parked');
    expect(smsBody).not.toContain('in spot');
  });
});

describe('notifyVehicleReady', () => {
  it('sends urgent SMS', async () => {
    await notifyVehicleReady(mockBookingData());
    expect(mockTwilioCreate).toHaveBeenCalled();
    const smsBody = mockTwilioCreate.mock.calls[0][0].body;
    expect(smsBody).toContain('on its way');
  });

  it('uses custom exit message', async () => {
    setupCompanySettings({ smsTextExitOut: 'Your car is ready! {plate}' });
    await notifyVehicleReady(mockBookingData());
    const smsBody = mockTwilioCreate.mock.calls[0][0].body;
    expect(smsBody).toContain('Your car is ready! ABC-1234');
  });
});

describe('notifyCompleted', () => {
  it('sends SMS with receipt info', async () => {
    await notifyCompleted(mockBookingData());
    expect(mockTwilioCreate).toHaveBeenCalled();
    const smsBody = mockTwilioCreate.mock.calls[0][0].body;
    expect(smsBody).toContain('$25.00');
    expect(smsBody).toContain('card');
  });

  it('sends email receipt', async () => {
    await notifyCompleted(mockBookingData());
    expect(mockSendGridSend).toHaveBeenCalled();
    const emailHtml = mockSendGridSend.mock.calls[0][0].html;
    expect(emailHtml).toContain('Receipt');
    expect(emailHtml).toContain('$25.00');
  });

  it('calculates duration correctly', async () => {
    await notifyCompleted(mockBookingData());
    const smsBody = mockTwilioCreate.mock.calls[0][0].body;
    expect(smsBody).toContain('4h 30m');
  });

  it('handles missing timestamps', async () => {
    await notifyCompleted(mockBookingData({ createdAt: '', completedAt: '' }));
    const smsBody = mockTwilioCreate.mock.calls[0][0].body;
    expect(smsBody).toContain('N/A');
  });
});

describe('notifyCancelled', () => {
  it('sends SMS with cancellation', async () => {
    await notifyCancelled(mockBookingData());
    expect(mockTwilioCreate).toHaveBeenCalled();
    const smsBody = mockTwilioCreate.mock.calls[0][0].body;
    expect(smsBody).toContain('cancelled');
    expect(smsBody).toContain('Customer request');
  });

  it('sends cancellation email', async () => {
    await notifyCancelled(mockBookingData());
    expect(mockSendGridSend).toHaveBeenCalled();
    const emailSubject = mockSendGridSend.mock.calls[0][0].subject;
    expect(emailSubject).toContain('Cancelled');
    expect(emailSubject).toContain('#42');
  });

  it('works without cancellation reason', async () => {
    await notifyCancelled(mockBookingData({ cancellationReason: '' }));
    expect(mockTwilioCreate).toHaveBeenCalled();
  });
});

// ─── Edge Cases ──────────────────────────────────────────────────────

describe('Edge Cases', () => {
  it('handles company settings load failure', async () => {
    mockFirestoreGet.mockImplementation(() => { throw new Error('Firestore down'); });
    // Should still try to send (uses defaults)
    await notifyBookingCreated(mockBookingData());
    expect(mockTwilioCreate).toHaveBeenCalled();
  });

  it('handles both SMS and email disabled', async () => {
    setupCompanySettings({ settings: { autoSendSms: false, autoSendEmail: false } });
    await notifyBookingCreated(mockBookingData());
    expect(mockTwilioCreate).not.toHaveBeenCalled();
    expect(mockSendGridSend).not.toHaveBeenCalled();
  });

  it('sends SMS but not email when only SMS enabled', async () => {
    setupCompanySettings({ settings: { autoSendSms: true, autoSendEmail: false } });
    await notifyCompleted(mockBookingData());
    expect(mockTwilioCreate).toHaveBeenCalled();
    expect(mockSendGridSend).not.toHaveBeenCalled();
  });

  it('sends email but not SMS when only email enabled', async () => {
    setupCompanySettings({ settings: { autoSendSms: false, autoSendEmail: true } });
    await notifyCompleted(mockBookingData());
    expect(mockTwilioCreate).not.toHaveBeenCalled();
    expect(mockSendGridSend).toHaveBeenCalled();
  });

  it('uses company-specific Twilio number', async () => {
    setupCompanySettings({ twilioPhoneNumber: '+15550009999' });
    await notifyBookingCreated(mockBookingData());
    expect(mockTwilioCreate).toHaveBeenCalledWith(
      expect.objectContaining({ from: '+15550009999' })
    );
  });
});
