/**
 * Extended field handling for cross-provider sync.
 *
 * When syncing to a provider that doesn't natively support certain fields
 * (e.g., Google Tasks lacks reminders, recurrence, categories), those fields
 * are encoded as a human-readable metadata block at the end of the notes field.
 *
 * The block is delimited by [task-sync] ... [/task-sync] markers.
 */

const BLOCK_START = '[task-sync]';
const BLOCK_END = '[/task-sync]';

export interface ExtendedFields {
  dueTime?: string;                                     // HH:MM (24h)
  reminder?: string;                                    // ISO datetime
  recurrence?: string;                                  // RRULE-like string
  categories?: string[];                                // category names
  importance?: string;                                  // low | normal | high
  steps?: Array<{ text: string; checked: boolean }>;    // checklist items
  startAt?: string;                                     // ISO date/datetime
}

/* ------------------------------------------------------------------ */
/*  Extract / Embed                                                    */
/* ------------------------------------------------------------------ */

/**
 * Extract the metadata block from a notes string.
 * Returns the clean notes (without block) and the parsed fields.
 */
export function extractMetadata(notes: string): {
  cleanNotes: string;
  fields: ExtendedFields;
} {
  const startIdx = notes.indexOf(BLOCK_START);
  const endIdx = notes.indexOf(BLOCK_END);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return { cleanNotes: notes, fields: {} };
  }

  const before = notes.slice(0, startIdx).trimEnd();
  const after = notes.slice(endIdx + BLOCK_END.length).trimStart();
  const cleanNotes = (before + (after ? '\n' + after : '')).trim();

  const blockContent = notes.slice(startIdx + BLOCK_START.length, endIdx).trim();
  const fields = parseBlock(blockContent);

  return { cleanNotes, fields };
}

function parseBlock(block: string): ExtendedFields {
  const fields: ExtendedFields = {};
  const lines = block.split('\n');
  let inSteps = false;
  const steps: Array<{ text: string; checked: boolean }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (inSteps) {
      const stepMatch = trimmed.match(/^-\s*\[([ xX])\]\s*(.+)$/);
      if (stepMatch) {
        steps.push({ checked: stepMatch[1] !== ' ', text: stepMatch[2].trim() });
        continue;
      }
      inSteps = false;
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim().toLowerCase();
    const value = trimmed.slice(colonIdx + 1).trim();

    switch (key) {
      case 'due_time':
        fields.dueTime = value;
        break;
      case 'reminder':
        // Accept both ISO and human-readable; store as-is (provider will parse)
        fields.reminder = value;
        break;
      case 'repeat':
      case 'recurrence':
        // Accept both RRULE and human-readable; try to detect RRULE
        fields.recurrence = value.includes('FREQ=') ? value : parseHumanRecurrence(value) ?? value;
        break;
      case 'categories':
        fields.categories = value.split(',').map(s => s.trim()).filter(Boolean);
        break;
      case 'importance':
      case 'priority':
        fields.importance = value.toLowerCase();
        break;
      case 'start':
        fields.startAt = value;
        break;
      case 'steps':
        inSteps = true;
        break;
    }
  }

  if (steps.length) fields.steps = steps;
  return fields;
}

/**
 * Embed extended fields as a metadata block at the end of notes.
 * Only includes fields that have non-default values.
 * Uses human-readable labels but keeps machine-parseable values.
 */
export function embedMetadata(notes: string, fields: ExtendedFields): string {
  // Strip any existing block first
  const { cleanNotes } = extractMetadata(notes || '');

  const lines: string[] = [];

  if (fields.dueTime)                                       lines.push(`due_time: ${fields.dueTime}`);
  if (fields.reminder)                                      lines.push(`reminder: ${fields.reminder}`);
  if (fields.recurrence)                                    lines.push(`repeat: ${formatRecurrenceHuman(fields.recurrence)}`);
  if (fields.categories?.length)                            lines.push(`categories: ${fields.categories.join(', ')}`);
  if (fields.importance && fields.importance !== 'normal')  lines.push(`importance: ${fields.importance}`);
  if (fields.startAt)                                       lines.push(`start: ${fields.startAt}`);
  if (fields.steps?.length) {
    lines.push('steps:');
    for (const step of fields.steps) {
      lines.push(`- [${step.checked ? 'x' : ' '}] ${step.text}`);
    }
  }

  if (lines.length === 0) return cleanNotes;

  const block = `${BLOCK_START}\n${lines.join('\n')}\n${BLOCK_END}`;
  return cleanNotes ? `${cleanNotes}\n\n${block}` : block;
}

/* ------------------------------------------------------------------ */
/*  Human-readable formatting helpers                                  */
/* ------------------------------------------------------------------ */

const DAY_NAMES: Record<string, string> = {
  MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun',
};

/** Format an RRULE string into a human-readable description. */
function formatRecurrenceHuman(rule: string): string {
  const parts = new Map(
    rule.split(';').map(p => {
      const eq = p.indexOf('=');
      return (eq === -1 ? [p, ''] : [p.slice(0, eq), p.slice(eq + 1)]) as [string, string];
    }),
  );

  const freq = parts.get('FREQ') ?? '';
  const interval = Number(parts.get('INTERVAL')) || 1;
  const byday = parts.get('BYDAY');
  const bymonthday = parts.get('BYMONTHDAY');
  const until = parts.get('UNTIL');
  const count = parts.get('COUNT');

  let result = '';

  // Frequency
  const freqMap: Record<string, [string, string]> = {
    DAILY: ['daily', 'days'],
    WEEKLY: ['weekly', 'weeks'],
    MONTHLY: ['monthly', 'months'],
    YEARLY: ['yearly', 'years'],
  };
  const [single, plural] = freqMap[freq] ?? [freq.toLowerCase(), freq.toLowerCase()];
  result = interval === 1 ? `Every ${single.replace('ly', '')}` : `Every ${interval} ${plural}`;
  if (interval === 1) {
    result = freq === 'DAILY' ? 'Daily' : freq === 'WEEKLY' ? 'Weekly' : freq === 'MONTHLY' ? 'Monthly' : freq === 'YEARLY' ? 'Yearly' : result;
  }

  // Days of week
  if (byday) {
    const days = byday.split(',');
    const weekdays = ['MO', 'TU', 'WE', 'TH', 'FR'];
    const weekend = ['SA', 'SU'];
    if (days.length === 5 && weekdays.every(d => days.includes(d))) {
      result += ' on weekdays';
    } else if (days.length === 2 && weekend.every(d => days.includes(d))) {
      result += ' on weekends';
    } else {
      result += ` on ${days.map(d => DAY_NAMES[d] ?? d).join(', ')}`;
    }
  }

  // Day of month
  if (bymonthday) result += ` on day ${bymonthday}`;

  // End condition
  if (until) result += ` until ${formatDateHuman(until)}`;
  else if (count) result += ` (${count} times)`;

  return result;
}

/** Format a date string (ISO or YYYY-MM-DD) to "Mon DD, YYYY". */
function formatDateHuman(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  } catch {
    return iso;
  }
}

/* ------------------------------------------------------------------ */
/*  Recurrence serialization (Microsoft Graph ↔ RRULE-like string)     */
/* ------------------------------------------------------------------ */

export interface GraphRecurrencePattern {
  type: string;
  interval: number;
  daysOfWeek?: string[];
  dayOfMonth?: number;
  month?: number;
  firstDayOfWeek?: string;
  index?: string;
}

export interface GraphRecurrenceRange {
  type: string;
  startDate?: string;
  endDate?: string;
  numberOfOccurrences?: number;
  recurrenceTimeZone?: string;
}

export interface GraphRecurrence {
  pattern: GraphRecurrencePattern;
  range: GraphRecurrenceRange;
}

const FREQ_MAP: Record<string, string> = {
  daily: 'DAILY', weekly: 'WEEKLY',
  absoluteMonthly: 'MONTHLY', relativeMonthly: 'MONTHLY',
  absoluteYearly: 'YEARLY', relativeYearly: 'YEARLY',
};

const DAY_TO_ABBR: Record<string, string> = {
  sunday: 'SU', monday: 'MO', tuesday: 'TU', wednesday: 'WE',
  thursday: 'TH', friday: 'FR', saturday: 'SA',
};

const ABBR_TO_DAY: Record<string, string> = {
  SU: 'sunday', MO: 'monday', TU: 'tuesday', WE: 'wednesday',
  TH: 'thursday', FR: 'friday', SA: 'saturday',
};

const POS_TO_STR: Record<string, string> = {
  first: '1', second: '2', third: '3', fourth: '4', last: '-1',
};

const STR_TO_POS: Record<string, string> = {
  '1': 'first', '2': 'second', '3': 'third', '4': 'fourth', '-1': 'last',
};

/** Serialize a Microsoft Graph recurrence to an RRULE-like string. */
export function serializeRecurrence(rec: GraphRecurrence): string {
  const parts: string[] = [];
  const p = rec.pattern;

  parts.push(`FREQ=${FREQ_MAP[p.type] ?? p.type.toUpperCase()}`);
  if (p.interval > 1) parts.push(`INTERVAL=${p.interval}`);

  if (p.daysOfWeek?.length) {
    parts.push(`BYDAY=${p.daysOfWeek.map(d => DAY_TO_ABBR[d] ?? d.slice(0, 2).toUpperCase()).join(',')}`);
  }
  if (p.dayOfMonth && (p.type === 'absoluteMonthly' || p.type === 'absoluteYearly')) {
    parts.push(`BYMONTHDAY=${p.dayOfMonth}`);
  }
  if (p.month && (p.type === 'absoluteYearly' || p.type === 'relativeYearly')) {
    parts.push(`BYMONTH=${p.month}`);
  }
  if (p.index && (p.type === 'relativeMonthly' || p.type === 'relativeYearly')) {
    parts.push(`BYSETPOS=${POS_TO_STR[p.index] ?? p.index}`);
  }

  const r = rec.range;
  if (r.type === 'endDate' && r.endDate) parts.push(`UNTIL=${r.endDate}`);
  else if (r.type === 'numbered' && r.numberOfOccurrences) parts.push(`COUNT=${r.numberOfOccurrences}`);

  return parts.join(';');
}

/** Deserialize an RRULE-like string back to a Microsoft Graph recurrence object. */
export function deserializeRecurrence(rule: string): GraphRecurrence | null {
  if (!rule) return null;

  const parts = new Map(
    rule.split(';').map(p => {
      const eq = p.indexOf('=');
      return (eq === -1 ? [p, ''] : [p.slice(0, eq), p.slice(eq + 1)]) as [string, string];
    }),
  );

  const freq = parts.get('FREQ')?.toLowerCase();
  if (!freq) return null;

  const interval = Number(parts.get('INTERVAL')) || 1;
  const byday = parts.get('BYDAY')?.split(',');
  const bymonthday = Number(parts.get('BYMONTHDAY')) || undefined;
  const bymonth = Number(parts.get('BYMONTH')) || undefined;
  const bysetpos = parts.get('BYSETPOS');
  const until = parts.get('UNTIL');
  const count = Number(parts.get('COUNT')) || undefined;

  let type: string;
  if (freq === 'daily') type = 'daily';
  else if (freq === 'weekly') type = 'weekly';
  else if (freq === 'monthly') type = bysetpos ? 'relativeMonthly' : 'absoluteMonthly';
  else if (freq === 'yearly') type = bysetpos ? 'relativeYearly' : 'absoluteYearly';
  else type = freq;

  return {
    pattern: {
      type,
      interval,
      daysOfWeek: byday?.map(d => ABBR_TO_DAY[d] ?? d.toLowerCase()),
      dayOfMonth: bymonthday,
      month: bymonth,
      firstDayOfWeek: 'sunday',
      index: bysetpos ? STR_TO_POS[bysetpos] : undefined,
    },
    range: {
      type: until ? 'endDate' : count ? 'numbered' : 'noEnd',
      startDate: new Date().toISOString().split('T')[0],
      endDate: until,
      numberOfOccurrences: count,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Date / time helpers                                                */
/* ------------------------------------------------------------------ */

/**
 * Try to parse a human-readable recurrence back to RRULE.
 * This is best-effort — if we can't parse, return null and store as-is.
 */
function parseHumanRecurrence(text: string): string | null {
  const lower = text.toLowerCase().trim();
  if (lower.startsWith('daily')) return 'FREQ=DAILY';
  if (lower.startsWith('weekly on weekdays')) return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
  if (lower.startsWith('weekly on weekends')) return 'FREQ=WEEKLY;BYDAY=SA,SU';
  if (lower.startsWith('weekly')) {
    const dayMatch = text.match(/on\s+(.+?)(\s+until|\s+\(|$)/i);
    if (dayMatch) {
      const nameToAbbr: Record<string, string> = {
        mon: 'MO', tue: 'TU', wed: 'WE', thu: 'TH', fri: 'FR', sat: 'SA', sun: 'SU',
      };
      const days = dayMatch[1].split(',').map(d => nameToAbbr[d.trim().toLowerCase().slice(0, 3)] ?? '').filter(Boolean);
      if (days.length) return `FREQ=WEEKLY;BYDAY=${days.join(',')}`;
    }
    return 'FREQ=WEEKLY';
  }
  if (lower.startsWith('monthly')) return 'FREQ=MONTHLY';
  if (lower.startsWith('yearly')) return 'FREQ=YEARLY';
  return null;
}

/** Extract HH:MM time from an ISO datetime string. Returns undefined for midnight. */
export function extractTimeFromIso(iso: string): string | undefined {
  const match = iso.match(/T(\d{2}):(\d{2})/);
  if (!match) return undefined;
  const time = `${match[1]}:${match[2]}`;
  return time === '00:00' ? undefined : time;
}

/** Combine a date-only ISO string with an optional HH:MM time string. */
export function combineDateAndTime(dateIso: string, time?: string): string {
  if (!time) return dateIso;
  const datePart = dateIso.split('T')[0];
  return `${datePart}T${time}:00.000Z`;
}

/**
 * Normalize an ISO datetime to date-only.
 * Uses noon UTC to avoid day-boundary shifts when displayed in local timezones.
 * (e.g., midnight UTC shows as "previous day" in UTC-5 and later timezones.)
 */
export function normalizeDateOnly(iso: string): string {
  const datePart = iso.split('T')[0];
  return `${datePart}T12:00:00.000Z`;
}
