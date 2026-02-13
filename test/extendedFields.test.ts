import { describe, expect, it } from 'vitest';
import {
  embedMetadata,
  extractMetadata,
  deserializeRecurrence,
  serializeRecurrence,
} from '../src/extended-fields.js';

describe('extended recurrence metadata', () => {
  it('stores recurrence as machine-safe rule and round-trips cleanly', () => {
    const recurrence = 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;DTSTART=2026-02-10';
    const notes = embedMetadata('Keep this note', { recurrence });

    expect(notes).toContain(`recurrence: ${recurrence}`);

    const extracted = extractMetadata(notes);
    expect(extracted.cleanNotes).toBe('Keep this note');
    expect(extracted.fields.recurrence).toBe(recurrence);
  });

  it('parses legacy human recurrence strings with intervals/days into RRULE-like form', () => {
    const notes = [
      'legacy note',
      '',
      '[task-sync]',
      'repeat: Every 2 weeks on Mon, Wed until Feb 20, 2026',
      '[/task-sync]',
    ].join('\n');

    const extracted = extractMetadata(notes);
    expect(extracted.fields.recurrence).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=2026-02-20');
  });

  it('preserves DTSTART/TZID through Microsoft recurrence serialization', () => {
    const raw = serializeRecurrence({
      pattern: {
        type: 'weekly',
        interval: 2,
        daysOfWeek: ['monday', 'wednesday'],
      },
      range: {
        type: 'noEnd',
        startDate: '2026-02-10',
        recurrenceTimeZone: 'UTC',
      },
    });

    expect(raw).toContain('DTSTART=2026-02-10');
    expect(raw).toContain('TZID=UTC');

    const graph = deserializeRecurrence(raw);
    expect(graph).not.toBeNull();
    expect(graph!.range.startDate).toBe('2026-02-10');
    expect(graph!.range.recurrenceTimeZone).toBe('UTC');
  });
});
