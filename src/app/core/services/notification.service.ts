import { Injectable, signal } from '@angular/core';

export type BannerType = 'info' | 'warning' | 'error' | 'success';

export interface BannerMessage {
  id: number;
  message: string;
  type: BannerType;
  autoDismiss: boolean;
}

const MAX_BANNERS = 5; // #18 cap

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

    this.banners.update((b) => {
      const next = [...b, banner];
      // #18 — evict oldest if over max
      return next.length > MAX_BANNERS ? next.slice(next.length - MAX_BANNERS) : next;
    });

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
    audio.play().catch(() => { /* Browser autoplay policy — OK */ });
  }

  async requestPermission(): Promise<boolean> {
    if (!('Notification' in window)) return false;
    const result = await Notification.requestPermission();
    return result === 'granted';
  }

  showBrowserNotification(title: string, body: string): void {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    new Notification(title, {
      body,
      icon: 'assets/icons/icon-192x192.png',
      badge: 'assets/icons/icon-72x72.png',
    });
  }
}
