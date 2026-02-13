import { describe, expect, it } from 'vitest';
import {
  deserializeRecurrence,
  embedMetadata,
  extractMetadata,
  serializeRecurrence,
  type GraphRecurrence,
} from '../src/extended-fields.js';

describe('extended recurrence fields', () => {
  it('embeds machine recurrence in metadata and restores it exactly', () => {
    const recurrence = 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;WKST=MO;DTSTART=2026-02-01;COUNT=10;TZID=UTC';

    const notes = embedMetadata('Keep this note', { recurrence });
    expect(notes).toContain(`[task-sync]`);
    expect(notes).toContain(`recurrence: ${recurrence}`);

    const parsed = extractMetadata(notes);
    expect(parsed.cleanNotes).toBe('Keep this note');
    expect(parsed.fields.recurrence).toBe(recurrence);
  });

  it('parses legacy human/equals recurrence metadata for backward compatibility', () => {
    const notes = `Task body\n\n[task-sync]\nrepeat=Every 2 weeks on Mon, Thu (10 times)\n[/task-sync]`;
    const parsed = extractMetadata(notes);

    expect(parsed.fields.recurrence).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;COUNT=10');
  });

  it('round-trips Microsoft recurrence series semantics (start date, tz, week start)', () => {
    const input: GraphRecurrence = {
      pattern: {
        type: 'weekly',
        interval: 2,
        daysOfWeek: ['monday', 'thursday'],
        firstDayOfWeek: 'monday',
      },
      range: {
        type: 'numbered',
        startDate: '2026-02-01',
        numberOfOccurrences: 10,
        recurrenceTimeZone: 'UTC',
      },
    };

    const serialized = serializeRecurrence(input);
    expect(serialized).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;WKST=MO;DTSTART=2026-02-01;COUNT=10;TZID=UTC');

    const parsed = deserializeRecurrence(serialized);
    expect(parsed).toMatchObject({
      pattern: {
        type: 'weekly',
        interval: 2,
        daysOfWeek: ['monday', 'thursday'],
        firstDayOfWeek: 'monday',
      },
      range: {
        type: 'numbered',
        startDate: '2026-02-01',
        numberOfOccurrences: 10,
        recurrenceTimeZone: 'UTC',
      },
    });
  });
});
