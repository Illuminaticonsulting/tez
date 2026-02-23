/**
 * Tez — Notifications Stress Tests
 *
 * Tests for:
 *  - HTML escaping in email templates (XSS prevention)
 *  - Email template structure
 *  - Edge-case inputs (empty names, long strings, special chars)
 *  - All journey notification dispatchers
 */

// Mock external dependencies before imports
jest.mock('twilio', () => {
  return jest.fn(() => ({
    messages: { create: jest.fn().mockResolvedValue({ sid: 'SM_test' }) },
  }));
});

jest.mock('@sendgrid/mail', () => ({
  setApiKey: jest.fn(),
  send: jest.fn().mockResolvedValue([{ statusCode: 202 }]),
}));

jest.mock('../config', () => ({
  db: {
    doc: jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
    }),
    collection: jest.fn().mockReturnValue({
      add: jest.fn().mockResolvedValue({ id: 'log-1' }),
      doc: jest.fn().mockReturnValue({ get: jest.fn() }),
    }),
  },
  TWILIO_ACCOUNT_SID: 'AC_test',
  TWILIO_AUTH_TOKEN: 'test_token',
  TWILIO_PHONE_NUMBER: '+15551234567',
  SENDGRID_API_KEY: 'SG_test',
  SENDGRID_FROM_EMAIL: 'noreply@test.com',
  SENDGRID_FROM_NAME: 'Tez Test',
}));

jest.mock('../middleware/logging', () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

import {
  buildBookingConfirmationEmail,
  buildCompletionReceiptEmail,
  buildCancellationEmail,
} from '../services/notifications';

describe('Email Template XSS Prevention', () => {
  const XSS_VECTORS = [
    '<script>alert("xss")</script>',
    '"><img src=x onerror=alert(1)>',
    '<iframe src="javascript:alert(1)">',
    '<svg onload=alert(1)>',
    '{{constructor.constructor("alert(1)")()}}',
  ];

  describe('buildBookingConfirmationEmail', () => {
    it('should produce valid HTML structure', () => {
      const html = buildBookingConfirmationEmail('Test Co', 100, 'John', 'ABC123', 'Red Toyota');
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('</html>');
      expect(html).toContain('Booking Confirmed');
      expect(html).toContain('Ticket #100');
    });

    it('should escape customer name with HTML entities', () => {
      for (const xss of XSS_VECTORS) {
        const html = buildBookingConfirmationEmail('Test Co', 100, xss, 'ABC123', 'Red Toyota');
        // Should NOT contain raw unescaped angle brackets from user input
        // The escapeHtml function converts < to &lt; and > to &gt;
        const afterHeader = html.split('Booking Confirmed')[1] || '';
        expect(afterHeader).not.toContain('<script>');
        expect(afterHeader).not.toContain('<iframe');
        expect(afterHeader).not.toContain('<svg');
        expect(afterHeader).not.toContain('<img');
      }
    });

    it('should escape plate with special characters', () => {
      const html = buildBookingConfirmationEmail('Test', 1, 'John', '<SCRIPT>PLATE', 'Car');
      expect(html).not.toContain('<SCRIPT>PLATE');
      expect(html).toContain('&lt;SCRIPT&gt;PLATE');
    });

    it('should escape vehicle description', () => {
      const html = buildBookingConfirmationEmail('Co', 1, 'John', 'ABC', '<b>Bold</b> Car');
      expect(html).toContain('&lt;b&gt;Bold&lt;/b&gt;');
    });

    it('should handle flight number with special chars', () => {
      const html = buildBookingConfirmationEmail('Co', 1, 'John', 'ABC', 'Car', '<script>AA123');
      expect(html).not.toContain('<script>AA123');
    });

    it('should handle empty customer name', () => {
      const html = buildBookingConfirmationEmail('Co', 1, '', 'ABC', 'Car');
      expect(html).toContain('Booking Confirmed');
    });

    it('should handle very long customer name', () => {
      const longName = 'A'.repeat(500);
      const html = buildBookingConfirmationEmail('Co', 1, longName, 'ABC', 'Car');
      expect(html).toContain(longName);
    });

    it('should handle Unicode customer name', () => {
      const html = buildBookingConfirmationEmail('Co', 1, '日本語テスト', 'ABC', 'Car');
      expect(html).toContain('日本語テスト');
    });

    it('should handle ticket number 0', () => {
      const html = buildBookingConfirmationEmail('Co', 0, 'John', 'ABC', 'Car');
      expect(html).toContain('Ticket #0');
    });

    it('should handle very large ticket numbers', () => {
      const html = buildBookingConfirmationEmail('Co', 999999, 'John', 'ABC', 'Car');
      expect(html).toContain('Ticket #999999');
    });

    it('should not include flight row when flight is undefined', () => {
      const html = buildBookingConfirmationEmail('Co', 1, 'John', 'ABC', 'Car');
      expect(html).not.toContain('Flight');
    });

    it('should include flight row when flight is provided', () => {
      const html = buildBookingConfirmationEmail('Co', 1, 'John', 'ABC', 'Car', 'AA1234');
      expect(html).toContain('Flight');
      expect(html).toContain('AA1234');
    });
  });

  describe('buildCompletionReceiptEmail', () => {
    it('should produce valid receipt HTML', () => {
      const html = buildCompletionReceiptEmail('Co', 1, 'John', 'ABC', 'Car', 25.99, 'cash', 'USD', '2h 30m');
      expect(html).toContain('Thank You');
      expect(html).toContain('$25.99');
      expect(html).toContain('Receipt');
    });

    it('should escape customer name in receipt', () => {
      const html = buildCompletionReceiptEmail('Co', 1, '<script>XSS</script>', 'ABC', 'Car', 0, 'cash', 'USD', '1h');
      expect(html).not.toContain('<script>XSS</script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('should escape vehicle and plate in receipt', () => {
      const html = buildCompletionReceiptEmail('Co', 1, 'John', '<b>PLATE', '<i>Car', 10, 'cash', 'USD', '1h');
      expect(html).toContain('&lt;b&gt;PLATE');
      expect(html).toContain('&lt;i&gt;Car');
    });

    it('should format amount with 2 decimal places', () => {
      const html = buildCompletionReceiptEmail('Co', 1, 'John', 'ABC', 'Car', 25, 'cash', 'USD', '1h');
      expect(html).toContain('$25.00');
    });

    it('should handle zero payment', () => {
      const html = buildCompletionReceiptEmail('Co', 1, 'John', 'ABC', 'Car', 0, 'cash', 'USD', '1h');
      expect(html).toContain('$0.00');
    });

    it('should handle non-USD currency', () => {
      const html = buildCompletionReceiptEmail('Co', 1, 'John', 'ABC', 'Car', 25, 'cash', 'EUR', '1h');
      expect(html).toContain('EUR25.00');
    });
  });

  describe('buildCancellationEmail', () => {
    it('should produce valid cancellation HTML', () => {
      const html = buildCancellationEmail('Co', 1, 'John', 'ABC');
      expect(html).toContain('Cancelled');
      expect(html).toContain('#1');
    });

    it('should escape customer name in cancellation', () => {
      const html = buildCancellationEmail('Co', 1, '<img onerror=alert(1)>', 'ABC');
      expect(html).not.toContain('<img onerror');
    });

    it('should escape reason field', () => {
      const html = buildCancellationEmail('Co', 1, 'John', 'ABC', '<script>Reason</script>');
      expect(html).not.toContain('<script>Reason');
      expect(html).toContain('&lt;script&gt;');
    });

    it('should not include reason row when reason is undefined', () => {
      const html = buildCancellationEmail('Co', 1, 'John', 'ABC');
      expect(html).not.toContain('Reason');
    });

    it('should include reason row when provided', () => {
      const html = buildCancellationEmail('Co', 1, 'John', 'ABC', 'Customer requested');
      expect(html).toContain('Reason');
      expect(html).toContain('Customer requested');
    });
  });
});

describe('Email Template Structure Stress', () => {
  it('all templates should have matching HTML open/close tags', () => {
    const templates = [
      buildBookingConfirmationEmail('Co', 1, 'John', 'ABC', 'Car'),
      buildCompletionReceiptEmail('Co', 1, 'John', 'ABC', 'Car', 25, 'cash', 'USD', '1h'),
      buildCancellationEmail('Co', 1, 'John', 'ABC'),
    ];
    for (const html of templates) {
      expect(html).toContain('<html>');
      expect(html).toContain('</html>');
      expect(html).toContain('<body>');
      expect(html).toContain('</body>');
      // Balanced divs
      const openDivs = (html.match(/<div/g) || []).length;
      const closeDivs = (html.match(/<\/div>/g) || []).length;
      expect(openDivs).toBe(closeDivs);
    }
  });

  it('all templates should include company name in footer', () => {
    const companyName = 'My Valet Co';
    const templates = [
      buildBookingConfirmationEmail(companyName, 1, 'John', 'ABC', 'Car'),
      buildCompletionReceiptEmail(companyName, 1, 'John', 'ABC', 'Car', 25, 'cash', 'USD', '1h'),
      buildCancellationEmail(companyName, 1, 'John', 'ABC'),
    ];
    for (const html of templates) {
      const footerSection = html.split('class="footer"')[1] || '';
      expect(footerSection).toContain(companyName);
    }
  });

  it('all templates should be UTF-8', () => {
    const templates = [
      buildBookingConfirmationEmail('Co', 1, 'John', 'ABC', 'Car'),
    ];
    for (const html of templates) {
      expect(html).toContain('charset="utf-8"');
    }
  });
});
