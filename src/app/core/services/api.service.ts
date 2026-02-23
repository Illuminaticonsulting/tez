import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get baseUrl(): string {
    return environment.functionsUrl;
  }

  private async getHeaders(): Promise<HttpHeaders> {
    const token = await this.auth.getIdToken();
    return new HttpHeaders({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    });
  }

  async get<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const headers = await this.getHeaders();
    return firstValueFrom(
      this.http.get<T>(`${this.baseUrl}/${endpoint}`, { headers, params })
    );
  }

  async post<T>(endpoint: string, body: any): Promise<T> {
    const headers = await this.getHeaders();
    return firstValueFrom(
      this.http.post<T>(`${this.baseUrl}/${endpoint}`, body, { headers })
    );
  }

  async put<T>(endpoint: string, body: any): Promise<T> {
    const headers = await this.getHeaders();
    return firstValueFrom(
      this.http.put<T>(`${this.baseUrl}/${endpoint}`, body, { headers })
    );
  }

  async delete<T>(endpoint: string): Promise<T> {
    const headers = await this.getHeaders();
    return firstValueFrom(
      this.http.delete<T>(`${this.baseUrl}/${endpoint}`, { headers })
    );
  }
}
