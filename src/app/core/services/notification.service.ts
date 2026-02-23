import { Injectable, signal } from '@angular/core';

export type BannerType = 'info' | 'warning' | 'error' | 'success';

export interface BannerMessage {
  id: number;
  message: string;
  type: BannerType;
  autoDismiss: boolean;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private nextId = 0;
  private audioCache = new Map<string, HTMLAudioElement>();

  readonly banners = signal<BannerMessage[]>([]);

  showBanner(
    message: string,
    type: BannerType = 'info',
    autoDismiss = true,
    durationMs = 5000
  ): void {
    const id = ++this.nextId;
    const banner: BannerMessage = { id, message, type, autoDismiss };
    this.banners.update((b) => [...b, banner]);

    if (autoDismiss) {
      setTimeout(() => this.dismissBanner(id), durationMs);
    }
  }

  dismissBanner(id: number): void {
    this.banners.update((b) => b.filter((x) => x.id !== id));
  }

  clearAll(): void {
    this.banners.set([]);
  }

  playAlert(type: 'new-ticket' | 'checkout' | 'error'): void {
    const soundMap: Record<string, string> = {
      'new-ticket': 'assets/sounds/new-ticket.mp3',
      checkout: 'assets/sounds/checkout.mp3',
      error: 'assets/sounds/error.mp3',
    };

    const src = soundMap[type];
    if (!src) return;

    let audio = this.audioCache.get(type);
    if (!audio) {
      audio = new Audio(src);
      this.audioCache.set(type, audio);
    }

    audio.currentTime = 0;
    audio.play().catch(() => {
      // Browser may block autoplay — that's OK
    });
  }

  /** Request browser notification permission */
  async requestPermission(): Promise<boolean> {
    if (!('Notification' in window)) return false;
    const result = await Notification.requestPermission();
    return result === 'granted';
  }

  /** Show a browser notification (works even when tab is not focused) */
  showBrowserNotification(title: string, body: string): void {
    if (Notification.permission !== 'granted') return;
    new Notification(title, {
      body,
      icon: 'assets/icon/favicon.png',
      badge: 'assets/icon/favicon.png',
    });
  }
}
