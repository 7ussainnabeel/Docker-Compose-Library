import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'safeDate',
  standalone: true,
})
export class SafeDatePipe implements PipeTransform {
  transform(value: any, format: 'full' | 'long' | 'medium' | 'short' | undefined = 'medium', fallback: string = 'Unknown'): string {
    if (!value || isNaN(Date.parse(value))) {
      return fallback;
    }
    const date = new Date(value);
    return Intl.DateTimeFormat('en-US', { dateStyle: format }).format(date);
  }
}
