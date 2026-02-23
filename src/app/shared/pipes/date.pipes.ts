import { Pipe, PipeTransform } from '@angular/core';
import { formatDistanceToNow, parseISO, format } from 'date-fns';

/** #15 fix — impure pipe so relative time auto-updates */
@Pipe({ name: 'relativeTime', standalone: true, pure: false })
export class RelativeTimePipe implements PipeTransform {
  private cachedValue = '';
  private lastInput: unknown;
  private lastEval = 0;

  transform(value: string | Date | null | { toDate?: () => Date }): string {
    if (!value) return '';
    // Re-evaluate at most every 30 seconds for performance
    if (value === this.lastInput && Date.now() - this.lastEval < 30_000) {
      return this.cachedValue;
    }
    this.lastInput = value;
    this.lastEval = Date.now();

    let date: Date;
    if (typeof value === 'string') {
      date = parseISO(value);
    } else if (value instanceof Date) {
      date = value;
    } else if (typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
      date = value.toDate();
    } else {
      return '';
    }

    this.cachedValue = formatDistanceToNow(date, { addSuffix: true });
    return this.cachedValue;
  }
}

@Pipe({ name: 'formatDate', standalone: true })
export class FormatDatePipe implements PipeTransform {
  transform(value: string | Date | null, formatStr = 'MMM d, yyyy'): string {
    if (!value) return '';
    const date = typeof value === 'string' ? parseISO(value) : value;
    return format(date, formatStr);
  }
}

@Pipe({ name: 'formatTime', standalone: true })
export class FormatTimePipe implements PipeTransform {
  transform(value: string | Date | null, formatStr = 'h:mm a'): string {
    if (!value) return '';
    const date = typeof value === 'string' ? parseISO(value) : value;
    return format(date, formatStr);
  }
}

/** New: status color pipe for common status-to-color mapping */
@Pipe({ name: 'statusColor', standalone: true })
export class StatusColorPipe implements PipeTransform {
  private readonly colorMap: Record<string, string> = {
    'New': '#ff9800',
    'Booked': '#2196f3',
    'Check-In': '#4caf50',
    'Parked': '#9c27b0',
    'Active': '#ffc107',
    'Completed': '#388e3c',
    'Cancelled': '#f44336',
  };

  transform(status: string): string {
    return this.colorMap[status] || '#999';
  }
}
