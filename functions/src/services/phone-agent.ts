/**
 * Tez — AI Phone Agent
 *
 * Automated phone system powered by OpenAI GPT-4o-mini + Twilio Voice.
 * Handles incoming calls, understands natural language, and performs
 * booking operations without human intervention.
 *
 * Capabilities:
 *  1. Look up bookings by ticket # or license plate
 *  2. Check booking status
 *  3. Request vehicle retrieval (transition to Active)
 *  4. Cancel a booking
 *  5. Answer pricing / hours / location questions
 *  6. Transfer to a human agent
 *  7. Log every call for admin review
 *
 * Architecture:
 *  Twilio Voice Webhook → phoneWebhook (onRequest)
 *    → OpenAI GPT-4o-mini (function calling)
 *    → Firestore queries / mutations
 *    → TwiML response (Say + Gather)
 */

import * as functions from 'firebase-functions';
import { db, STANDARD_OPTIONS, HEAVY_OPTIONS } from '../config';
import { assertRole, generateCorrelationId, logInfo, logError, writeAuditLog } from '../middleware';
import { validate } from '../middleware';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import OpenAI from 'openai';

// ─── Constants ───────────────────────────────────────────────────────

const AI_MODEL = 'gpt-4o-mini';
const MAX_TURNS = 15;
const CALL_SESSION_TTL_MS = 30 * 60_000; // 30 minutes
const DEFAULT_VOICE = 'Polly.Joanna';
const SPEECH_TIMEOUT = 'auto';

// ─── Schemas ─────────────────────────────────────────────────────────

export const SavePhoneConfigSchema = z.object({
  enabled: z.boolean(),
  twilioPhoneNumber: z.string().max(20).optional().default(''),
  transferNumber: z.string().max(20).optional().default(''),
  greeting: z.string().max(500).optional().default(''),
  businessHours: z.string().max(500).optional().default(''),
  pricingInfo: z.string().max(500).optional().default(''),
  locationInfo: z.string().max(500).optional().default(''),
});

export const GetCallLogSchema = z.object({
  limit: z.number().int().min(1).max(100).default(25),
});

// ─── Types ───────────────────────────────────────────────────────────

export interface PhoneConfig {
  enabled: boolean;
  twilioPhoneNumber: string;
  transferNumber: string;
  greeting: string;
  businessHours: string;
  pricingInfo: string;
  locationInfo: string;
}

interface CallSession {
  callSid: string;
  companyId: string;
  callerPhone: string;
  companyName: string;
  startedAt: FirebaseFirestore.Timestamp;
  messages: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: unknown[] }>;
  actionsPerformed: string[];
  turns: number;
  status: 'active' | 'completed' | 'transferred';
}

interface CallLogEntry {
  callSid: string;
  callerPhone: string;
  startedAt: FirebaseFirestore.Timestamp;
  endedAt?: FirebaseFirestore.Timestamp;
  duration?: number;
  turns: number;
  transcript: Array<{ role: string; content: string; timestamp: string }>;
  actionsPerformed: string[];
  summary: string;
  status: 'completed' | 'transferred' | 'error' | 'no-input';
}

// ─── TwiML Helpers ───────────────────────────────────────────────────
// Exported for testing (@visibleForTesting)

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function twimlGather(text: string, actionUrl: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    `  <Gather input="speech" action="${escapeXml(actionUrl)}" method="POST" speechTimeout="${SPEECH_TIMEOUT}" language="en-US">`,
    `    <Say voice="${DEFAULT_VOICE}">${escapeXml(text)}</Say>`,
    '  </Gather>',
    `  <Say voice="${DEFAULT_VOICE}">${escapeXml("I didn't catch that. Please call again if you need help. Goodbye!")}</Say>`,
    '</Response>',
  ].join('\n');
}

export function twimlSay(text: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    `  <Say voice="${DEFAULT_VOICE}">${escapeXml(text)}</Say>`,
    '</Response>',
  ].join('\n');
}

export function twimlTransfer(text: string, number: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    `  <Say voice="${DEFAULT_VOICE}">${escapeXml(text)}</Say>`,
    `  <Dial>${escapeXml(number)}</Dial>`,
    '</Response>',
  ].join('\n');
}

export function twimlHangup(text: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    `  <Say voice="${DEFAULT_VOICE}">${escapeXml(text)}</Say>`,
    '  <Hangup/>',
    '</Response>',
  ].join('\n');
}

// ─── OpenAI Tool Definitions ─────────────────────────────────────────

export const TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function' as const,
    function: {
      name: 'lookup_booking',
      description: 'Look up a valet parking booking by ticket number or license plate. Use this when the customer provides their ticket number or plate.',
      parameters: {
        type: 'object',
        properties: {
          ticketNumber: { type: 'number', description: 'The numeric ticket number (e.g. 42)' },
          licensePlate: { type: 'string', description: 'Vehicle license plate (e.g. ABC-1234)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'request_vehicle',
      description: 'Request the customer\'s vehicle to be brought to the pickup area. Only works when the booking is in Parked status.',
      parameters: {
        type: 'object',
        properties: {
          bookingId: { type: 'string', description: 'The booking document ID' },
        },
        required: ['bookingId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'cancel_booking',
      description: 'Cancel a valet parking booking. Works for bookings that are not already completed or cancelled.',
      parameters: {
        type: 'object',
        properties: {
          bookingId: { type: 'string', description: 'The booking document ID' },
          reason: { type: 'string', description: 'Reason for cancellation' },
        },
        required: ['bookingId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_company_info',
      description: 'Get company information like business hours, pricing, and location/directions. Use this to answer questions about hours, rates, or where to go.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'transfer_to_human',
      description: 'Transfer the call to a human agent. Use when the customer requests to speak to a person or when you cannot help them.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Why the transfer is needed' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'end_call',
      description: 'End the phone call politely. Use when the customer says goodbye, is done, or has no more questions.',
      parameters: {
        type: 'object',
        properties: {
          farewell: { type: 'string', description: 'A polite goodbye message' },
        },
      },
    },
  },
];

// ─── System Prompt Builder ───────────────────────────────────────────

export function buildSystemPrompt(companyName: string, config: PhoneConfig): string {
  return `You are TEZ, an AI phone assistant for ${companyName || 'our'} valet parking service.
You are professional, warm, and efficient. You speak naturally and concisely since this is a phone conversation.

COMPANY INFORMATION:
- Business Hours: ${config.businessHours || 'Not specified'}
- Location: ${config.locationInfo || 'Not specified'}
- Pricing: ${config.pricingInfo || 'Not specified'}

YOUR CAPABILITIES:
1. Look up bookings by ticket number or license plate
2. Check the current status of a booking
3. Request a vehicle to be brought to the pickup area
4. Cancel a booking
5. Answer questions about pricing, hours, and location
6. Transfer the call to a human team member

RULES:
- Always verify the customer's identity by asking for their ticket number OR license plate before performing any actions.
- Before requesting a vehicle or canceling, CONFIRM with the customer first. Say what you're about to do and ask "shall I go ahead?"
- If you cannot help with something, offer to transfer to a human team member.
- Keep responses SHORT and NATURAL. This is a phone call, not a text chat.
- Do NOT use markdown, bullet points, numbered lists, or any text formatting. Speak naturally.
- Do NOT say booking IDs to the customer. Use ticket numbers and plate numbers instead.
- If the customer seems frustrated, empathize and offer to transfer to a team member.
- After completing a request, ask if there's anything else you can help with.
- When looking up a booking, tell the customer the status in plain language:
  - "New" means their ticket was just created
  - "Booked" means they have a reservation
  - "Check-In" means they're being checked in
  - "Parked" means their car is parked and safe
  - "Active" means their car is being brought to them
  - "Completed" means the service is finished
  - "Cancelled" means the booking was cancelled`;
}

// ─── Tool Execution ──────────────────────────────────────────────────

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  companyId: string,
  config: PhoneConfig
): Promise<{ result: Record<string, unknown>; action?: string }> {
  switch (name) {
    case 'lookup_booking':
      return { result: await lookupBooking(companyId, args) };

    case 'request_vehicle':
      return {
        result: await requestVehicle(companyId, args.bookingId as string),
        action: `Requested vehicle for booking ${args.bookingId}`,
      };

    case 'cancel_booking':
      return {
        result: await cancelBookingByPhone(companyId, args.bookingId as string, args.reason as string),
        action: `Cancelled booking ${args.bookingId}`,
      };

    case 'get_company_info':
      return {
        result: {
          businessHours: config.businessHours || 'Please contact us directly for our hours.',
          pricing: config.pricingInfo || 'Please contact us directly for pricing details.',
          location: config.locationInfo || 'Please contact us directly for directions.',
        },
      };

    case 'transfer_to_human':
      return {
        result: { action: 'transfer', reason: args.reason },
        action: `Transfer requested: ${args.reason || 'Customer request'}`,
      };

    case 'end_call':
      return {
        result: { action: 'end', farewell: args.farewell || 'Thank you for calling. Goodbye!' },
        action: 'Call ended by AI',
      };

    default:
      return { result: { error: 'Unknown action' } };
  }
}

async function lookupBooking(companyId: string, args: Record<string, unknown>) {
  const bookingsRef = db.collection(`companies/${companyId}/bookings`);
  let query: FirebaseFirestore.Query;

  if (args.ticketNumber) {
    query = bookingsRef.where('ticketNumber', '==', Number(args.ticketNumber)).limit(1);
  } else if (args.licensePlate) {
    const plate = String(args.licensePlate).toUpperCase().replace(/[^A-Z0-9\- ]/g, '');
    query = bookingsRef.where('vehicle.plate', '==', plate).limit(1);
  } else {
    return { found: false, message: 'Need a ticket number or license plate to look up.' };
  }

  const snap = await query.get();
  if (snap.empty) {
    return { found: false, message: 'No booking found with that information.' };
  }

  const doc = snap.docs[0]!;
  const data = doc.data();
  return {
    found: true,
    bookingId: doc.id,
    ticketNumber: data.ticketNumber,
    status: data.status,
    customerName: data.customerName,
    vehiclePlate: data.vehicle?.plate,
    vehicleDescription: [data.vehicle?.color, data.vehicle?.make, data.vehicle?.model]
      .filter(Boolean)
      .join(' '),
    spot: data.spotName || data.spot?.label || 'Not assigned yet',
    hasKeys: data.keysHandedOver ? 'Yes' : 'No',
    flightNumber: data.flightNumber || 'None',
    createdAt: data.createdAt?.toDate?.()?.toISOString() || 'Unknown',
  };
}

async function requestVehicle(companyId: string, bookingId: string) {
  const bookingDocRef = db.doc(`companies/${companyId}/bookings/${bookingId}`);
  const doc = await bookingDocRef.get();

  if (!doc.exists) return { success: false, message: 'Booking not found.' };

  const data = doc.data()!;
  if (data.status !== 'Parked') {
    const statusMap: Record<string, string> = {
      New: 'Your ticket was just created. The car hasn\'t been parked yet.',
      Booked: 'This is a reservation. The car hasn\'t arrived yet.',
      'Check-In': 'The car is being checked in right now.',
      Active: 'Your car is already on its way to the pickup area!',
      Completed: 'This booking has already been completed.',
      Cancelled: 'This booking was cancelled.',
    };
    return {
      success: false,
      message: statusMap[data.status] || `Current status is ${data.status}. Vehicle must be parked first.`,
    };
  }

  // Transition Parked → Active
  await bookingDocRef.update({
    status: 'Active',
    updatedAt: FieldValue.serverTimestamp(),
    history: FieldValue.arrayUnion({
      status: 'Active',
      timestamp: new Date().toISOString(),
      userId: 'ai-phone-agent',
      note: 'Vehicle requested via phone call',
    }),
  });

  return {
    success: true,
    message: 'Done! Your car is being brought to the pickup area now. It should be ready shortly.',
    spotLabel: data.spotName || data.spot?.label,
  };
}

async function cancelBookingByPhone(companyId: string, bookingId: string, reason?: string) {
  const bookingDocRef = db.doc(`companies/${companyId}/bookings/${bookingId}`);
  const doc = await bookingDocRef.get();

  if (!doc.exists) return { success: false, message: 'Booking not found.' };

  const data = doc.data()!;
  if (data.status === 'Completed' || data.status === 'Cancelled') {
    return { success: false, message: `This booking is already ${data.status.toLowerCase()}.` };
  }

  // Release spot if assigned
  const spotId = data.spotId || data.spot?.id;
  const spotLocId = data.locationId || data.spot?.locationId;
  if (spotId && spotLocId) {
    const spotDocRef = db.doc(
      `companies/${companyId}/locations/${spotLocId}/spots/${spotId}`
    );
    await spotDocRef.update({
      status: 'available',
      bookingId: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  await bookingDocRef.update({
    status: 'Cancelled',
    updatedAt: FieldValue.serverTimestamp(),
    history: FieldValue.arrayUnion({
      status: 'Cancelled',
      timestamp: new Date().toISOString(),
      userId: 'ai-phone-agent',
      note: reason || 'Cancelled via phone call',
    }),
  });

  return { success: true, message: 'Your booking has been successfully cancelled.' };
}

// ─── AI Processing ───────────────────────────────────────────────────

async function processWithAI(
  session: CallSession,
  config: PhoneConfig
): Promise<{ text: string; messages: CallSession['messages']; actions: string[]; endCall: boolean; transfer: boolean }> {
  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey) {
    return {
      text: 'I apologize, but our AI system is temporarily unavailable. Let me transfer you to a team member.',
      messages: session.messages,
      actions: [],
      endCall: false,
      transfer: true,
    };
  }

  const openai = new OpenAI({ apiKey });
  const messages = [...session.messages] as OpenAI.ChatCompletionMessageParam[];
  const actions: string[] = [];
  let endCall = false;
  let transfer = false;

  try {
    let response = await openai.chat.completions.create({
      model: AI_MODEL,
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
      max_tokens: 300,
      temperature: 0.7,
    });

    let choice = response.choices[0]!;
    let rounds = 0;

    // Handle tool call loop (AI may call multiple tools)
    while (choice.finish_reason === 'tool_calls' && choice.message.tool_calls && rounds < 5) {
      rounds++;
      const toolCalls = choice.message.tool_calls;

      // Add assistant message with tool calls
      messages.push(choice.message as OpenAI.ChatCompletionMessageParam);

      for (const tc of toolCalls) {
        let toolArgs: Record<string, unknown> = {};
        try {
          const fn = (tc as { type: string; function: { name: string; arguments: string }; id: string }).function;
          toolArgs = JSON.parse(fn.arguments || '{}');
        } catch {
          toolArgs = {};
        }

        const fnName = (tc as { type: string; function: { name: string; arguments: string }; id: string }).function.name;

        const { result, action } = await executeTool(
          fnName,
          toolArgs,
          session.companyId,
          config
        );

        if (action) actions.push(action);

        // Check for special actions
        if (result.action === 'transfer') transfer = true;
        if (result.action === 'end') endCall = true;

        messages.push({
          role: 'tool' as const,
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }

      // Get AI response after tool results
      response = await openai.chat.completions.create({
        model: AI_MODEL,
        messages,
        tools: TOOLS,
        tool_choice: 'auto',
        max_tokens: 300,
        temperature: 0.7,
      });

      choice = response.choices[0]!;
    }

    const text = choice.message?.content || 'I apologize, I had trouble processing that. Could you repeat?';
    messages.push({ role: 'assistant' as const, content: text });

    return {
      text,
      messages: messages as CallSession['messages'],
      actions,
      endCall,
      transfer,
    };
  } catch (err) {
    logError({ correlationId: session.callSid, operation: 'processWithAI' }, 'OpenAI error', err as Error);
    return {
      text: 'I apologize, but I\'m having a technical difficulty. Let me transfer you to a team member who can help.',
      messages: session.messages,
      actions: ['AI error - transferring'],
      endCall: false,
      transfer: true,
    };
  }
}

// ─── HTTP Webhook (Twilio) ───────────────────────────────────────────

/**
 * Single HTTP endpoint for Twilio Voice webhooks.
 * Routes via ?action= query parameter:
 *   ?action=incoming  — New call arrives
 *   ?action=gather    — Customer speech captured
 *   ?action=status    — Call status update
 */
export const phoneWebhook = functions
  .runWith(HEAVY_OPTIONS)
  .https.onRequest(async (req, res) => {
    const action = (req.query.action as string) || 'incoming';

    res.set('Content-Type', 'text/xml');

    try {
      switch (action) {
        case 'incoming':
          return await handleIncoming(req, res);
        case 'gather':
          return await handleGather(req, res);
        case 'status':
          return await handleStatus(req, res);
        default:
          res.status(400).send(twimlSay('Invalid request.'));
          return;
      }
    } catch (err) {
      logError({ correlationId: 'phone-webhook', operation: 'phoneWebhook' }, 'Webhook error', err as Error);
      res.status(200).send(
        twimlSay('We apologize, but we are experiencing technical difficulties. Please try calling again later.')
      );
    }
  });

async function handleIncoming(
  req: functions.https.Request,
  res: functions.Response
): Promise<void> {
  const callSid = req.body?.CallSid || `call_${Date.now()}`;
  const from = req.body?.From || 'unknown';
  const to = req.body?.To || 'unknown';

  const correlationId = generateCorrelationId();
  const ctx = { correlationId, operation: 'handleIncomingCall' };
  logInfo(ctx, 'Incoming call', { callSid, from, to });

  // Look up company by the Twilio phone number
  const normalizedTo = to.replace(/[^0-9+]/g, '');
  const routeSnap = await db.collection('_phoneRouting').where('phoneNumber', '==', normalizedTo).limit(1).get();

  let companyId: string;
  let companyName: string;
  let config: PhoneConfig;

  if (routeSnap.empty) {
    // Try without + prefix
    const routeSnap2 = await db.collection('_phoneRouting').where('phoneNumber', '==', normalizedTo.replace(/^\+/, '')).limit(1).get();
    if (routeSnap2.empty) {
      logInfo(ctx, 'No company found for phone number', { to: normalizedTo });
      res.status(200).send(twimlSay(
        'Thank you for calling. This number is not yet configured. Please contact us through our website. Goodbye!'
      ));
      return;
    }
    companyId = routeSnap2.docs[0]!.data().companyId;
  } else {
    companyId = routeSnap.docs[0]!.data().companyId;
  }

  // Load company info
  const companyDoc = await db.doc(`companies/${companyId}`).get();
  const companyData = companyDoc.data() || {};
  companyName = companyData.name || companyData.displayName || 'Valet Parking';

  // Load phone config
  const configDoc = await db.doc(`companies/${companyId}/meta/phoneAgent`).get();
  config = (configDoc.data() as PhoneConfig) || {
    enabled: false,
    twilioPhoneNumber: '',
    transferNumber: '',
    greeting: '',
    businessHours: '',
    pricingInfo: '',
    locationInfo: '',
  };

  if (!config.enabled) {
    if (config.transferNumber) {
      res.status(200).send(twimlTransfer('Please hold while I connect you with our team.', config.transferNumber));
    } else {
      res.status(200).send(twimlSay(
        'Thank you for calling. Our automated system is not currently active. Please try again later or visit our website. Goodbye!'
      ));
    }
    return;
  }

  // Build greeting
  const greeting = config.greeting ||
    `Thank you for calling ${companyName} valet parking. I'm an AI assistant and I can help you check your booking status, request your car, cancel a booking, or answer questions about our service. How can I help you today?`;

  // Create call session
  const session: CallSession = {
    callSid,
    companyId,
    callerPhone: from,
    companyName,
    startedAt: FieldValue.serverTimestamp() as unknown as FirebaseFirestore.Timestamp,
    messages: [
      { role: 'system', content: buildSystemPrompt(companyName, config) },
    ],
    actionsPerformed: [],
    turns: 0,
    status: 'active',
  };

  await db.doc(`companies/${companyId}/_callSessions/${callSid}`).set(session);

  // Build action URL for Gather
  const baseUrl = `${req.protocol}://${req.get('host') || req.hostname}`;
  const gatherUrl = `${baseUrl}/phoneWebhook?action=gather&sid=${callSid}&cid=${companyId}`;

  res.status(200).send(twimlGather(greeting, gatherUrl));
  logInfo(ctx, 'Call answered with greeting', { callSid, companyId });
}

async function handleGather(
  req: functions.https.Request,
  res: functions.Response
): Promise<void> {
  const callSid = (req.query.sid as string) || req.body?.CallSid || '';
  const companyId = (req.query.cid as string) || '';
  const speechResult = req.body?.SpeechResult || '';
  const confidence = req.body?.Confidence || '0';

  const ctx = { correlationId: callSid, operation: 'handleGather' };
  logInfo(ctx, 'Speech received', { speechResult, confidence });

  if (!callSid || !companyId) {
    res.status(200).send(twimlSay('Sorry, something went wrong. Please call again. Goodbye!'));
    return;
  }

  // Load call session
  const sessionRef = db.doc(`companies/${companyId}/_callSessions/${callSid}`);
  const sessionDoc = await sessionRef.get();

  if (!sessionDoc.exists) {
    res.status(200).send(twimlSay('Sorry, I lost track of our conversation. Please call again. Goodbye!'));
    return;
  }

  const session = sessionDoc.data() as CallSession;

  // Check turn limit
  if (session.turns >= MAX_TURNS) {
    await finishCall(companyId, callSid, session, 'completed', 'Maximum turns reached');
    res.status(200).send(twimlHangup(
      'We\'ve been chatting for a while! If you still need help, please call back or visit our website. Thank you and goodbye!'
    ));
    return;
  }

  // Add user message
  session.messages.push({
    role: 'user',
    content: speechResult || 'I didn\'t say anything',
  });
  session.turns++;

  // Load phone config
  const configDoc = await db.doc(`companies/${companyId}/meta/phoneAgent`).get();
  const config = (configDoc.data() as PhoneConfig) || {
    enabled: false, twilioPhoneNumber: '', transferNumber: '',
    greeting: '', businessHours: '', pricingInfo: '', locationInfo: '',
  };

  // Process with AI
  const aiResult = await processWithAI(session, config);

  // Update session
  session.messages = aiResult.messages;
  session.actionsPerformed.push(...aiResult.actions);

  // Handle special actions
  if (aiResult.transfer) {
    await finishCall(companyId, callSid, session, 'transferred', aiResult.text);
    if (config.transferNumber) {
      res.status(200).send(twimlTransfer(aiResult.text, config.transferNumber));
    } else {
      res.status(200).send(twimlHangup(
        'I\'d like to transfer you, but no team member is available right now. Please try calling back during business hours. Goodbye!'
      ));
    }
    return;
  }

  if (aiResult.endCall) {
    await finishCall(companyId, callSid, session, 'completed', aiResult.text);
    res.status(200).send(twimlHangup(aiResult.text));
    return;
  }

  // Save session and continue conversation
  await sessionRef.update({
    messages: session.messages,
    actionsPerformed: session.actionsPerformed,
    turns: session.turns,
  });

  // Build gather URL for next turn
  const baseUrl = `${req.protocol}://${req.get('host') || req.hostname}`;
  const gatherUrl = `${baseUrl}/phoneWebhook?action=gather&sid=${callSid}&cid=${companyId}`;

  res.status(200).send(twimlGather(aiResult.text, gatherUrl));
}

async function handleStatus(
  req: functions.https.Request,
  res: functions.Response
): Promise<void> {
  const callSid = req.body?.CallSid || '';
  const callStatus = req.body?.CallStatus || '';
  const duration = req.body?.CallDuration || '0';

  const ctx = { correlationId: callSid, operation: 'handleCallStatus' };
  logInfo(ctx, 'Call status update', { callStatus, duration });

  // If call ended, finalize any active session
  if (callStatus === 'completed' || callStatus === 'busy' || callStatus === 'no-answer' || callStatus === 'failed') {
    // Try to find and close the session
    const sessionsSnap = await db.collectionGroup('_callSessions')
      .where('callSid', '==', callSid)
      .where('status', '==', 'active')
      .limit(1)
      .get();

    if (!sessionsSnap.empty) {
      const doc = sessionsSnap.docs[0]!;
      const session = doc.data() as CallSession;
      const companyId = session.companyId;
      await finishCall(companyId, callSid, session, 'completed', 'Call ended by caller');
    }
  }

  res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
}

// ─── Call Finalization ───────────────────────────────────────────────

async function finishCall(
  companyId: string,
  callSid: string,
  session: CallSession,
  status: 'completed' | 'transferred' | 'error' | 'no-input',
  summary: string
): Promise<void> {
  try {
    // Build transcript from messages (skip system prompt)
    const transcript = session.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role,
        content: String(m.content || ''),
        timestamp: new Date().toISOString(),
      }));

    // Write call log
    const logEntry: CallLogEntry = {
      callSid,
      callerPhone: session.callerPhone,
      startedAt: session.startedAt,
      endedAt: FieldValue.serverTimestamp() as unknown as FirebaseFirestore.Timestamp,
      turns: session.turns,
      transcript,
      actionsPerformed: session.actionsPerformed,
      summary,
      status,
    };

    await db.collection(`companies/${companyId}/_callLog`).doc(callSid).set(logEntry);

    // Update session status
    await db.doc(`companies/${companyId}/_callSessions/${callSid}`).update({
      status,
    });

    // Write audit log
    await writeAuditLog(db, companyId, {
      action: 'phone_call',
      uid: 'ai-phone-agent',
      resourceType: 'call',
      resourceId: callSid,
      correlationId: callSid,
      details: {
        callerPhone: session.callerPhone,
        turns: session.turns,
        actions: session.actionsPerformed,
        status,
      },
    });
  } catch (err) {
    logError(
      { correlationId: callSid, operation: 'finishCall' },
      'Failed to finalize call',
      err as Error
    );
  }
}

// ─── Callable Functions (Admin) ──────────────────────────────────────

/**
 * Save phone agent configuration.
 * Admin only. Updates company phone config and phone routing.
 */
export const savePhoneConfig = functions
  .runWith(STANDARD_OPTIONS)
  .https.onCall(async (data, context) => {
    const { companyId } = assertRole(context, ['admin']);
    const correlationId = generateCorrelationId();
    const ctx = { correlationId, operation: 'savePhoneConfig' };

    const config = validate(SavePhoneConfigSchema, data);

    logInfo(ctx, 'Saving phone config', { companyId, enabled: config.enabled });

    // Save config to company meta
    await db.doc(`companies/${companyId}/meta/phoneAgent`).set(config, { merge: true });

    // Update phone routing if number is provided
    if (config.twilioPhoneNumber) {
      const normalized = config.twilioPhoneNumber.replace(/[^0-9+]/g, '');

      // Remove old routing for this company
      const oldRoutes = await db.collection('_phoneRouting')
        .where('companyId', '==', companyId)
        .get();

      const batch = db.batch();
      oldRoutes.docs.forEach((doc) => batch.delete(doc.ref));

      // Add new routing
      batch.set(db.collection('_phoneRouting').doc(), {
        phoneNumber: normalized,
        companyId,
        updatedAt: FieldValue.serverTimestamp(),
      });

      await batch.commit();
      logInfo(ctx, 'Phone routing updated', { phoneNumber: normalized });
    }

    await writeAuditLog(db, companyId, {
      action: 'update_phone_config',
      uid: context.auth?.uid || 'unknown',
      resourceType: 'config',
      resourceId: 'phoneAgent',
      correlationId,
      details: { enabled: config.enabled, hasNumber: !!config.twilioPhoneNumber },
    });

    return { success: true };
  });

/**
 * Get recent call logs.
 * Admin only. Returns paginated call history.
 */
export const getCallLog = functions
  .runWith(STANDARD_OPTIONS)
  .https.onCall(async (data, context) => {
    const { companyId } = assertRole(context, ['admin']);
    const { limit } = validate(GetCallLogSchema, data || {});

    const snap = await db
      .collection(`companies/${companyId}/_callLog`)
      .orderBy('startedAt', 'desc')
      .limit(limit)
      .get();

    const logs = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        callerPhone: d.callerPhone,
        startedAt: d.startedAt?.toDate?.()?.toISOString() || null,
        endedAt: d.endedAt?.toDate?.()?.toISOString() || null,
        turns: d.turns,
        transcript: d.transcript || [],
        actionsPerformed: d.actionsPerformed || [],
        summary: d.summary || '',
        status: d.status,
      };
    });

    return { calls: logs };
  });

/**
 * Scheduled cleanup of expired call sessions (older than 30 min).
 */
export const cleanupCallSessions = functions
  .runWith({ timeoutSeconds: 300, memory: '256MB' })
  .pubsub.schedule('every 30 minutes')
  .onRun(async () => {
    const cutoff = new Date(Date.now() - CALL_SESSION_TTL_MS);
    const ctx = { correlationId: generateCorrelationId(), operation: 'cleanupCallSessions' };

    const snap = await db.collectionGroup('_callSessions')
      .where('status', '==', 'active')
      .where('startedAt', '<', cutoff)
      .limit(500)
      .get();

    if (snap.empty) {
      logInfo(ctx, 'No expired call sessions to clean up');
      return null;
    }

    const batch = db.batch();
    snap.docs.forEach((doc) => batch.update(doc.ref, { status: 'completed' }));
    await batch.commit();

    logInfo(ctx, `Cleaned up ${snap.size} expired call sessions`);
    return null;
  });
