import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

export interface FlightInfo {
  airline: string;
  flightNumber: string;
  departureAirport: string;
  arrivalAirport: string;
  scheduledDeparture: string;
  scheduledArrival: string;
  status: string;
  gate?: string;
  terminal?: string;
  delay?: number;
}

@Injectable({ providedIn: 'root' })
export class FlightService {
  private api = inject(ApiService);

  readonly loading = signal(false);

  /** Fetch flight status via server-side proxy (no API keys exposed) */
  async getFlightStatus(
    airlineCode: string,
    flightNumber: string,
    date: string // YYYY-MM-DD
  ): Promise<FlightInfo | null> {
    this.loading.set(true);
    try {
      const result = await this.api.get<FlightInfo>(
        `flights/status?airline=${airlineCode}&flight=${flightNumber}&date=${date}`
      );
      return result;
    } catch {
      return null;
    } finally {
      this.loading.set(false);
    }
  }

  /** Get flight schedule */
  async getFlightSchedule(
    airlineCode: string,
    flightNumber: string,
    date: string
  ): Promise<FlightInfo[]> {
    this.loading.set(true);
    try {
      return await this.api.get<FlightInfo[]>(
        `flights/schedule?airline=${airlineCode}&flight=${flightNumber}&date=${date}`
      );
    } catch {
      return [];
    } finally {
      this.loading.set(false);
    }
  }
}
