/**
 * Tez — SMS & Email Notification Service
 *
 * Unified notification service for the complete customer journey.
 * Sends SMS (Twilio) and Email (SendGrid) at every stage:
 *
 * Journey Stage          SMS   Email
 * ─────────────────────  ────  ─────
 * Booking Created         ✓     ✓  (confirmation with ticket #)
 * Check-In Complete       ✓     —  (quick SMS only)
 * Vehicle Parked          ✓     —  (spot info)
 * Vehicle Ready (Active)  ✓     —  (come to pickup!)
 * Booking Completed       ✓     ✓  (receipt with payment)
 * Booking Cancelled       ✓     ✓  (cancellation notice)
 * Vehicle Delayed         ✓     —  (flight tracking update)
 *
 * Graceful degradation: if Twilio/SendGrid credentials are missing,
 * logs a warning and continues without throwing.
 */

import {
  db,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
  SENDGRID_API_KEY,
  SENDGRID_FROM_EMAIL,
  SENDGRID_FROM_NAME,
} from '../config';
import { logInfo, logWarn, logError, type LogContext } from '../middleware/logging';

// ─── Lazy Initialization (avoid cold-start if not needed) ────────────

let twilioClient: ReturnType<typeof import('twilio')> | null = null;

function getTwilioClient() {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return null;
  if (!twilioClient) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Twilio = require('twilio');
    twilioClient = Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
}

let sgMail: import('@sendgrid/mail').MailService | null = null;

function getSendGridClient(): import('@sendgrid/mail').MailService | null {
  if (!SENDGRID_API_KEY) return null;
  if (!sgMail) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    sgMail = require('@sendgrid/mail') as import('@sendgrid/mail').MailService;
    sgMail.setApiKey(SENDGRID_API_KEY);
  }
  return sgMail;
}

// ─── Helper: Load Company SMS Settings ───────────────────────────────

interface CompanyNotifySettings {
  autoSendSms: boolean;
  autoSendEmail: boolean;
  companyName: string;
  twilioPhoneNumber?: string; // per-company override
  smsTextCheckIn?: string;
  smsTextExitOut?: string;
  hourlyRate?: number;
  currency?: string;
}

async function getCompanySettings(companyId: string): Promise<CompanyNotifySettings> {
  try {
    const doc = await db.doc(`companies/${companyId}`).get();
    const data = doc.data() || {};
    const settings = data.settings || {};
    return {
      autoSendSms: settings.autoSendSms ?? true,
      autoSendEmail: settings.autoSendEmail ?? true,
      companyName: data.name || data.displayName || 'Tez Valet Parking',
      twilioPhoneNumber: data.twilioPhoneNumber || '',
      smsTextCheckIn: data.smsTextCheckIn || '',
      smsTextExitOut: data.smsTextExitOut || '',
      hourlyRate: settings.hourlyRate || 0,
      currency: settings.currency || 'USD',
    };
  } catch {
    return {
      autoSendSms: true,
      autoSendEmail: true,
      companyName: 'Tez Valet Parking',
    };
  }
}

// ─── SMS Sending ─────────────────────────────────────────────────────

export async function sendSms(
  to: string,
  body: string,
  companyId: string,
  ctx: LogContext,
  fromNumber?: string,
): Promise<boolean> {
  if (!to || to.length < 7) {
    logWarn(ctx, 'SMS skipped — no valid phone number', { to });
    return false;
  }

  const client = getTwilioClient();
  if (!client) {
    logWarn(ctx, 'SMS skipped — Twilio not configured');
    return false;
  }

  const from = fromNumber || TWILIO_PHONE_NUMBER;
  if (!from) {
    logWarn(ctx, 'SMS skipped — no from number configured');
    return false;
  }

  // Normalize phone number
  const normalizedTo = to.replace(/[^0-9+]/g, '');
  if (normalizedTo.length < 10) {
    logWarn(ctx, 'SMS skipped — phone number too short', { to: normalizedTo });
    return false;
  }

  try {
    const message = await (client as any).messages.create({
      body,
      from,
      to: normalizedTo.startsWith('+') ? normalizedTo : `+1${normalizedTo}`,
    });

    logInfo(ctx, 'SMS sent', { sid: message.sid, to: normalizedTo });

    // Log to Firestore for audit
    await db.collection(`companies/${companyId}/_smsLog`).add({
      to: normalizedTo,
      body,
      sid: message.sid,
      status: 'sent',
      sentAt: new Date(),
      correlationId: ctx.correlationId,
    });

    return true;
  } catch (err) {
    logError(ctx, 'SMS send failed', err);
    await db.collection(`companies/${companyId}/_smsLog`).add({
      to: normalizedTo,
      body,
      status: 'failed',
      error: err instanceof Error ? err.message : 'Unknown error',
      attemptedAt: new Date(),
      correlationId: ctx.correlationId,
    });
    return false;
  }
}

// ─── Email Sending ───────────────────────────────────────────────────

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  companyId: string,
  ctx: LogContext,
): Promise<boolean> {
  if (!to || !to.includes('@')) {
    logWarn(ctx, 'Email skipped — no valid email', { to });
    return false;
  }

  const sg = getSendGridClient();
  if (!sg) {
    logWarn(ctx, 'Email skipped — SendGrid not configured');
    return false;
  }

  try {
    await sg.send({
      to,
      from: { email: SENDGRID_FROM_EMAIL, name: SENDGRID_FROM_NAME },
      subject,
      html,
    });

    logInfo(ctx, 'Email sent', { to, subject });

    await db.collection(`companies/${companyId}/_emailLog`).add({
      to,
      subject,
      status: 'sent',
      sentAt: new Date(),
      correlationId: ctx.correlationId,
    });

    return true;
  } catch (err) {
    logError(ctx, 'Email send failed', err);
    await db.collection(`companies/${companyId}/_emailLog`).add({
      to,
      subject,
      status: 'failed',
      error: err instanceof Error ? err.message : 'Unknown error',
      attemptedAt: new Date(),
      correlationId: ctx.correlationId,
    });
    return false;
  }
}

// ─── HTML Escaping (XSS Prevention) ──────────────────────────────────

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Email Templates ─────────────────────────────────────────────────

const emailHeader = (companyName: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 32px 24px; text-align: center; }
    .header h1 { color: white; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px; }
    .header p { color: rgba(255,255,255,0.7); margin: 8px 0 0; font-size: 14px; }
    .body { padding: 32px 24px; }
    .ticket-badge { display: inline-block; background: #e8f5e9; color: #2e7d32; font-weight: 700; font-size: 18px; padding: 8px 20px; border-radius: 8px; }
    .info-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .info-table td { padding: 10px 0; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
    .info-table td:first-child { color: #888; width: 40%; }
    .info-table td:last-child { font-weight: 600; color: #333; }
    .status-pill { display: inline-block; padding: 4px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase; }
    .status-new { background: #fff3e0; color: #e65100; }
    .status-active { background: #e3f2fd; color: #1565c0; }
    .status-completed { background: #e8f5e9; color: #2e7d32; }
    .status-cancelled { background: #fce4ec; color: #c62828; }
    .btn { display: inline-block; padding: 14px 32px; background: #1a1a2e; color: white; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 15px; }
    .footer { background: #fafafa; padding: 20px 24px; text-align: center; color: #999; font-size: 12px; border-top: 1px solid #f0f0f0; }
    .receipt-box { background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .receipt-total { font-size: 28px; font-weight: 700; color: #1a1a2e; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🅿️ ${companyName}</h1>
      <p>Valet Parking Service</p>
    </div>
    <div class="body">
`;

const emailFooter = (companyName: string) => `
    </div>
    <div class="footer">
      <p>${companyName} — Valet Parking Service</p>
      <p>This is an automated message. Please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>
`;

export function buildBookingConfirmationEmail(
  companyName: string,
  ticketNumber: number,
  customerName: string,
  plate: string,
  vehicle: string,
  flightNumber?: string,
): string {
  return `${emailHeader(companyName)}
      <h2 style="margin: 0 0 8px; color: #333;">Booking Confirmed! ✅</h2>
      <p style="color: #666; margin: 0 0 24px;">Hi ${escapeHtml(customerName)}, your valet parking has been confirmed.</p>

      <div style="text-align: center; margin: 24px 0;">
        <span class="ticket-badge">Ticket #${ticketNumber}</span>
      </div>

      <table class="info-table">
        <tr><td>Customer</td><td>${escapeHtml(customerName)}</td></tr>
        <tr><td>Vehicle</td><td>${escapeHtml(vehicle)}</td></tr>
        <tr><td>License Plate</td><td>${escapeHtml(plate)}</td></tr>
        ${flightNumber ? `<tr><td>Flight</td><td>${escapeHtml(flightNumber)}</td></tr>` : ''}
        <tr><td>Status</td><td><span class="status-pill status-new">New</span></td></tr>
      </table>

      <p style="color: #666; font-size: 14px; margin: 24px 0 0;">
        Save your ticket number <strong>#${ticketNumber}</strong> — you'll need it for pickup.
        You can also call us and our AI assistant can help you check status or request your car.
      </p>
  ${emailFooter(companyName)}`;
}

export function buildCompletionReceiptEmail(
  companyName: string,
  ticketNumber: number,
  customerName: string,
  plate: string,
  vehicle: string,
  paymentAmount: number,
  paymentMethod: string,
  currency: string,
  duration: string,
): string {
  const currencySymbol = currency === 'USD' ? '$' : currency;
  return `${emailHeader(companyName)}
      <h2 style="margin: 0 0 8px; color: #333;">Thank You! 🎉</h2>
      <p style="color: #666; margin: 0 0 24px;">Hi ${escapeHtml(customerName)}, your valet parking service has been completed.</p>

      <div class="receipt-box">
        <p style="color: #888; font-size: 13px; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 1px;">Receipt</p>
        <p class="receipt-total">${currencySymbol}${paymentAmount.toFixed(2)}</p>
        <table class="info-table" style="margin-bottom: 0;">
          <tr><td>Ticket</td><td>#${ticketNumber}</td></tr>
          <tr><td>Vehicle</td><td>${escapeHtml(vehicle)} (${escapeHtml(plate)})</td></tr>
          <tr><td>Duration</td><td>${escapeHtml(duration)}</td></tr>
          <tr><td>Payment</td><td>${escapeHtml(paymentMethod)}</td></tr>
          <tr><td>Status</td><td><span class="status-pill status-completed">Completed</span></td></tr>
        </table>
      </div>

      <p style="color: #666; font-size: 14px;">
        Thank you for choosing ${companyName}! We hope to see you again soon.
      </p>
  ${emailFooter(companyName)}`;
}

export function buildCancellationEmail(
  companyName: string,
  ticketNumber: number,
  customerName: string,
  plate: string,
  reason?: string,
): string {
  return `${emailHeader(companyName)}
      <h2 style="margin: 0 0 8px; color: #333;">Booking Cancelled</h2>
      <p style="color: #666; margin: 0 0 24px;">Hi ${escapeHtml(customerName)}, your booking has been cancelled.</p>

      <table class="info-table">
        <tr><td>Ticket</td><td>#${ticketNumber}</td></tr>
        <tr><td>License Plate</td><td>${escapeHtml(plate)}</td></tr>
        ${reason ? `<tr><td>Reason</td><td>${escapeHtml(reason)}</td></tr>` : ''}
        <tr><td>Status</td><td><span class="status-pill status-cancelled">Cancelled</span></td></tr>
      </table>

      <p style="color: #666; font-size: 14px;">
        If you didn't request this cancellation or need assistance, please contact us.
      </p>
  ${emailFooter(companyName)}`;
}

// ─── Journey Notification Dispatchers ────────────────────────────────

export interface BookingNotifyData {
  companyId: string;
  ticketNumber: number;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  vehiclePlate: string;
  vehicleDescription: string; // "Red Toyota Camry"
  flightNumber?: string;
  spotName?: string;
  bookingId: string;
  paymentAmount?: number;
  paymentMethod?: string;
  cancellationReason?: string;
  createdAt?: string;
  completedAt?: string;
}

/**
 * Booking Created — Send confirmation SMS + Email
 */
export async function notifyBookingCreated(data: BookingNotifyData): Promise<void> {
  const ctx: LogContext = { correlationId: data.bookingId, operation: 'notifyBookingCreated', companyId: data.companyId };
  const settings = await getCompanySettings(data.companyId);

  // SMS
  if (settings.autoSendSms && data.customerPhone) {
    const smsBody = `${settings.companyName}: Booking confirmed! Ticket #${data.ticketNumber} for ${data.vehiclePlate}. Save this number for pickup or call us to check status.`;
    await sendSms(data.customerPhone, smsBody, data.companyId, ctx, settings.twilioPhoneNumber);
  }

  // Email
  if (settings.autoSendEmail && data.customerEmail) {
    const html = buildBookingConfirmationEmail(
      settings.companyName,
      data.ticketNumber,
      data.customerName,
      data.vehiclePlate,
      data.vehicleDescription,
      data.flightNumber,
    );
    await sendEmail(data.customerEmail, `Booking Confirmed — Ticket #${data.ticketNumber}`, html, data.companyId, ctx);
  }

  logInfo(ctx, 'Booking created notifications dispatched', { ticketNumber: data.ticketNumber });
}

/**
 * Check-In Complete — Send SMS to customer
 */
export async function notifyCheckIn(data: BookingNotifyData): Promise<void> {
  const ctx: LogContext = { correlationId: data.bookingId, operation: 'notifyCheckIn', companyId: data.companyId };
  const settings = await getCompanySettings(data.companyId);

  if (!settings.autoSendSms || !data.customerPhone) return;

  const customMsg = settings.smsTextCheckIn;
  const smsBody = customMsg
    ? customMsg.replace('{ticketNumber}', String(data.ticketNumber)).replace('{plate}', data.vehiclePlate)
    : `${settings.companyName}: Your vehicle (${data.vehiclePlate}) has been checked in. Ticket #${data.ticketNumber}. We'll take great care of it!`;

  await sendSms(data.customerPhone, smsBody, data.companyId, ctx, settings.twilioPhoneNumber);
}

/**
 * Vehicle Parked — Send SMS with spot info
 */
export async function notifyParked(data: BookingNotifyData): Promise<void> {
  const ctx: LogContext = { correlationId: data.bookingId, operation: 'notifyParked', companyId: data.companyId };
  const settings = await getCompanySettings(data.companyId);

  if (!settings.autoSendSms || !data.customerPhone) return;

  const smsBody = `${settings.companyName}: Your ${data.vehicleDescription || 'vehicle'} (${data.vehiclePlate}) is safely parked${data.spotName ? ` in spot ${data.spotName}` : ''}. Ticket #${data.ticketNumber}. Call or text us when you're ready for pickup!`;
  await sendSms(data.customerPhone, smsBody, data.companyId, ctx, settings.twilioPhoneNumber);
}

/**
 * Vehicle Ready (Active) — Send urgent SMS to customer
 */
export async function notifyVehicleReady(data: BookingNotifyData): Promise<void> {
  const ctx: LogContext = { correlationId: data.bookingId, operation: 'notifyVehicleReady', companyId: data.companyId };
  const settings = await getCompanySettings(data.companyId);

  if (!settings.autoSendSms || !data.customerPhone) return;

  const customMsg = settings.smsTextExitOut;
  const smsBody = customMsg
    ? customMsg.replace('{ticketNumber}', String(data.ticketNumber)).replace('{plate}', data.vehiclePlate)
    : `${settings.companyName}: 🚗 Your ${data.vehicleDescription || 'vehicle'} is on its way! Ticket #${data.ticketNumber}. Please head to the pickup area.`;

  await sendSms(data.customerPhone, smsBody, data.companyId, ctx, settings.twilioPhoneNumber);
}

/**
 * Booking Completed — Send receipt SMS + Email
 */
export async function notifyCompleted(data: BookingNotifyData): Promise<void> {
  const ctx: LogContext = { correlationId: data.bookingId, operation: 'notifyCompleted', companyId: data.companyId };
  const settings = await getCompanySettings(data.companyId);

  const amount = data.paymentAmount || 0;
  const method = data.paymentMethod || 'cash';
  const currencySymbol = (settings.currency || 'USD') === 'USD' ? '$' : settings.currency || '';

  // Calculate duration
  let duration = 'N/A';
  if (data.createdAt && data.completedAt) {
    try {
      const start = new Date(data.createdAt).getTime();
      const end = new Date(data.completedAt).getTime();
      const diffMs = end - start;
      const hours = Math.floor(diffMs / 3_600_000);
      const minutes = Math.floor((diffMs % 3_600_000) / 60_000);
      duration = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    } catch { /* fallback to N/A */ }
  }

  // SMS
  if (settings.autoSendSms && data.customerPhone) {
    const smsBody = `${settings.companyName}: Thank you! Ticket #${data.ticketNumber} complete. Total: ${currencySymbol}${amount.toFixed(2)} (${method}). Duration: ${duration}. Thank you for choosing us!`;
    await sendSms(data.customerPhone, smsBody, data.companyId, ctx, settings.twilioPhoneNumber);
  }

  // Email receipt
  if (settings.autoSendEmail && data.customerEmail) {
    const html = buildCompletionReceiptEmail(
      settings.companyName,
      data.ticketNumber,
      data.customerName,
      data.vehiclePlate,
      data.vehicleDescription,
      amount,
      method,
      settings.currency || 'USD',
      duration,
    );
    await sendEmail(data.customerEmail, `Receipt — Ticket #${data.ticketNumber} (${currencySymbol}${amount.toFixed(2)})`, html, data.companyId, ctx);
  }

  logInfo(ctx, 'Completion notifications dispatched', { ticketNumber: data.ticketNumber, amount });
}

/**
 * Booking Cancelled — Send cancellation SMS + Email
 */
export async function notifyCancelled(data: BookingNotifyData): Promise<void> {
  const ctx: LogContext = { correlationId: data.bookingId, operation: 'notifyCancelled', companyId: data.companyId };
  const settings = await getCompanySettings(data.companyId);

  // SMS
  if (settings.autoSendSms && data.customerPhone) {
    const smsBody = `${settings.companyName}: Ticket #${data.ticketNumber} has been cancelled${data.cancellationReason ? ` — ${data.cancellationReason}` : ''}. Contact us if you have questions.`;
    await sendSms(data.customerPhone, smsBody, data.companyId, ctx, settings.twilioPhoneNumber);
  }

  // Email
  if (settings.autoSendEmail && data.customerEmail) {
    const html = buildCancellationEmail(
      settings.companyName,
      data.ticketNumber,
      data.customerName,
      data.vehiclePlate,
      data.cancellationReason,
    );
    await sendEmail(data.customerEmail, `Booking Cancelled — Ticket #${data.ticketNumber}`, html, data.companyId, ctx);
  }

  logInfo(ctx, 'Cancellation notifications dispatched', { ticketNumber: data.ticketNumber });
}
