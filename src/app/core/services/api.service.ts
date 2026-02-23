import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';

/**
 * ApiService wraps Firebase httpsCallable — no raw HTTP, no exposed URLs.
 * All Cloud Functions are called via the Firebase SDK callable protocol.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private functions = inject(Functions);

  /**
   * Call a Firebase Cloud Function by name.
   * Automatically handles auth token injection & error unwrapping.
   */
  async call<T = any>(functionName: string, data: Record<string, any> = {}): Promise<T> {
    const fn = httpsCallable<Record<string, any>, T>(this.functions, functionName);
    const result = await fn(data);
    return result.data;
  }
}
