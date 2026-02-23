import { Injectable, inject, signal, computed } from '@angular/core';
import { ApiService } from './api.service';

export interface FlightInfo {
  airline: string;
  flightNumber: string;
  scheduledArrival: string;
  estimatedArrival: string;
  status: 'scheduled' | 'en-route' | 'landed' | 'delayed' | 'cancelled';
  gate?: string;
  terminal?: string;
  origin?: string;
}

@Injectable({ providedIn: 'root' })
export class FlightService {
  private api = inject(ApiService);

  private readonly _flight = signal<FlightInfo | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly flight = this._flight.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  readonly isDelayed = computed(
    () => this._flight()?.status === 'delayed'
  );

  /** Uses api.call() (httpsCallable) instead of HTTP GET */
  async lookupFlight(flightNumber: string): Promise<FlightInfo | null> {
    this._loading.set(true);
    this._error.set(null);
    try {
      const info = await this.api.call<FlightInfo>('lookupFlight', {
        flightNumber: flightNumber.trim().toUpperCase(),
      });
      this._flight.set(info);
      return info;
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Flight lookup failed';
      this._error.set(message);
      this._flight.set(null);
      return null;
    } finally {
      this._loading.set(false);
    }
  }

  clear(): void {
    this._flight.set(null);
    this._error.set(null);
  }
}
