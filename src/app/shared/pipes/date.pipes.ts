import { Pipe, PipeTransform } from '@angular/core';
import { formatDistanceToNow, parseISO, format } from 'date-fns';

@Pipe({ name: 'relativeTime', standalone: true })
export class RelativeTimePipe implements PipeTransform {
  transform(value: string | Date | null): string {
    if (!value) return '';
    const date = typeof value === 'string' ? parseISO(value) : value;
    return formatDistanceToNow(date, { addSuffix: true });
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
