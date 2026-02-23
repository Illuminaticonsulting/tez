/**
 * Tez — Flight Lookup Service
 *
 * Features:
 * - FlightStats API integration
 * - Firestore-backed response caching (5-minute TTL)
 * - Retry with exponential backoff (3 attempts)
 * - Structured error handling
 */

import axios from 'axios';
import {
  functions,
  STANDARD_OPTIONS,
  FLIGHTSTATS_APP_ID,
  FLIGHTSTATS_APP_KEY,
  FLIGHT_CACHE_TTL_MS,
  flightCacheRef,
} from '../config';
import {
  assertAuth,
  checkRateLimit,
  validate,
  generateCorrelationId,
  logInfo,
  logError,
} from '../middleware';
import { LookupFlightSchema, type FlightLookupResponse } from '../types';

// ─── Retry Helper ────────────────────────────────────────────────────

async function fetchWithRetry(url: string, retries = 3, backoffMs = 1000): Promise<unknown> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(url, { timeout: 10_000 });
      return response.data;
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = backoffMs * Math.pow(2, attempt - 1) + Math.random() * 500;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error('Retry exhausted');
}

// ─── Flight Lookup ───────────────────────────────────────────────────

export const lookupFlight = functions
  .runWith(STANDARD_OPTIONS)
  .https.onCall(async (data, context): Promise<FlightLookupResponse> => {
    const correlationId = generateCorrelationId();
    const authData = assertAuth(context);
    await checkRateLimit(authData.uid);

    const input = validate(LookupFlightSchema, data);
    const ctx = { correlationId, uid: authData.uid, operation: 'lookupFlight' };

    const match = input.flightNumber.match(/^([A-Z]{2})(\d+)$/);
    if (!match) {
      return { found: false, message: 'Invalid flight number format (e.g. AA123).' };
    }

    const airline = match[1];
    const flightNum = match[2];
    const today = new Date();
    const cacheKey = `${airline}${flightNum}_${today.toISOString().split('T')[0]}`;

    // ─── Check Cache ───────────────────────────────────────────────

    try {
      const cacheDoc = await flightCacheRef(cacheKey).get();
      if (cacheDoc.exists) {
        const cacheData = cacheDoc.data()!;
        const cachedAt = cacheData['cachedAt']?.toMillis?.() ?? 0;
        if (Date.now() - cachedAt < FLIGHT_CACHE_TTL_MS) {
          logInfo(ctx, 'Flight cache hit', { cacheKey });
          return { ...(cacheData['response'] as FlightLookupResponse), cachedAt: new Date(cachedAt).toISOString() };
        }
      }
    } catch {
      // Cache miss is fine
    }

    // ─── Check API Config ──────────────────────────────────────────

    if (!FLIGHTSTATS_APP_ID || !FLIGHTSTATS_APP_KEY) {
      throw new functions.https.HttpsError('unavailable', 'Flight tracking not configured.');
    }

    // ─── Fetch with Retry ──────────────────────────────────────────

    try {
      const url = `https://api.flightstats.com/flex/flightstatus/rest/v2/json/flight/status/${airline}/${flightNum}/arr/${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}?appId=${FLIGHTSTATS_APP_ID}&appKey=${FLIGHTSTATS_APP_KEY}&utc=false`;

      const responseData = (await fetchWithRetry(url)) as Record<string, unknown>;
      const flightStatuses = responseData?.['flightStatuses'] as Record<string, unknown>[] | undefined;
      const flight = flightStatuses?.[0];

      if (!flight) return { found: false };

      const statusMap: Record<string, FlightLookupResponse['status']> = {
        L: 'landed',
        A: 'en-route',
        S: 'scheduled',
        C: 'cancelled',
        D: 'diverted',
      };

      const opTimes = flight['operationalTimes'] as Record<string, Record<string, string>> | undefined;
      const resources = flight['airportResources'] as Record<string, string> | undefined;
      const delays = flight['delays'] as Record<string, number> | undefined;

      const result: FlightLookupResponse = {
        found: true,
        airline,
        flightNumber: flightNum,
        status: statusMap[(flight['status'] as string)] || 'scheduled',
        scheduledArrival: opTimes?.['scheduledGateArrival']?.['dateLocal'] || '',
        estimatedArrival: opTimes?.['estimatedGateArrival']?.['dateLocal'] || '',
        delay: delays?.['arrivalGateDelayMinutes'] || 0,
        origin: (flight['departureAirportFsCode'] as string) || '',
        gate: resources?.['arrivalGate'] || '',
        terminal: resources?.['arrivalTerminal'] || '',
      };

      // ─── Cache Result ──────────────────────────────────────────

      try {
        await flightCacheRef(cacheKey).set({
          response: result,
          cachedAt: new Date(),
          expiresAt: new Date(Date.now() + FLIGHT_CACHE_TTL_MS * 2),
        });
      } catch {
        // Non-critical
      }

      logInfo(ctx, 'Flight lookup success', { cacheKey, status: result.status });
      return result;
    } catch (err: unknown) {
      logError(ctx, 'FlightStats API error', err);
      throw new functions.https.HttpsError('internal', 'Failed to fetch flight data.');
    }
  });
