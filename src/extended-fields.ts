/**
 * Extended field handling for cross-provider sync.
 *
 * When syncing to a provider that doesn't natively support certain fields
 * (e.g., Google Tasks lacks reminders, recurrence, categories), those fields
 * are encoded in a metadata block at the end of the notes field.
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

    // Accept both "key: value" and legacy "key=value" styles.
    const kv = trimmed.match(/^([a-zA-Z_]+)\s*[:=]\s*(.+)$/);
    if (!kv) continue;

    const key = kv[1]!.trim().toLowerCase();
    const value = kv[2]!.trim();

    switch (key) {
      case 'due_time':
        fields.dueTime = value;
        break;
      case 'reminder':
        // Accept both ISO and human-readable; store as-is (provider will parse)
        fields.reminder = value;
        break;
      case 'repeat': {
        // Keep backward-compat for old human-readable recurrence lines, but
        // don't clobber an explicit machine recurrence if one was parsed.
        if (!fields.recurrence) {
          const rec = /\bFREQ=/i.test(value)
            ? normalizeRuleTokens(value)
            : parseHumanRecurrence(value) ?? value;
          fields.recurrence = rec;
        }
        break;
      }
      case 'recurrence':
      case 'rrule':
      case 'recurrence_raw': {
        const rec = /\bFREQ=/i.test(value)
          ? normalizeRuleTokens(value)
          : parseHumanRecurrence(value) ?? value;
        fields.recurrence = rec;
        break;
      }
      case 'categories':
        fields.categories = value.split(',').map((s) => s.trim()).filter(Boolean);
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
 */
export function embedMetadata(notes: string, fields: ExtendedFields): string {
  // Strip any existing block first
  const { cleanNotes } = extractMetadata(notes || '');

  const lines: string[] = [];

  if (fields.dueTime)                                       lines.push(`due_time: ${fields.dueTime}`);
  if (fields.reminder)                                      lines.push(`reminder: ${fields.reminder}`);
  // Persist recurrence as machine-safe RRULE-like text for lossless round-trip.
  if (fields.recurrence)                                    lines.push(`recurrence: ${normalizeRuleTokens(fields.recurrence)}`);
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
    parts.push(`BYDAY=${p.daysOfWeek.map((d) => DAY_TO_ABBR[d] ?? d.slice(0, 2).toUpperCase()).join(',')}`);
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
  if (p.firstDayOfWeek) {
    const first = p.firstDayOfWeek.toLowerCase();
    parts.push(`WKST=${DAY_TO_ABBR[first] ?? first.slice(0, 2).toUpperCase()}`);
  }

  const r = rec.range;
  if (r.startDate) parts.push(`DTSTART=${r.startDate}`);
  if (r.type === 'endDate' && r.endDate) parts.push(`UNTIL=${r.endDate}`);
  else if (r.type === 'numbered' && r.numberOfOccurrences) parts.push(`COUNT=${r.numberOfOccurrences}`);
  if (r.recurrenceTimeZone) parts.push(`TZID=${r.recurrenceTimeZone}`);

  return normalizeRuleTokens(parts.join(';'));
}

export interface DeserializeRecurrenceOptions {
  fallbackStartDate?: string;
}

/** Deserialize an RRULE-like string back to a Microsoft Graph recurrence object. */
export function deserializeRecurrence(rule: string, opts?: DeserializeRecurrenceOptions): GraphRecurrence | null {
  if (!rule) return null;

  const normalized = normalizeRuleTokens(rule);
  const parseable = /\bFREQ=/i.test(normalized)
    ? normalized
    : parseHumanRecurrence(rule);
  if (!parseable) return null;

  const parts = new Map(
    parseable.split(';').map((p) => {
      const eq = p.indexOf('=');
      return (eq === -1 ? [p, ''] : [p.slice(0, eq), p.slice(eq + 1)]) as [string, string];
    }),
  );

  const freq = parts.get('FREQ')?.toLowerCase();
  if (!freq) return null;

  const interval = Math.max(1, Number(parts.get('INTERVAL')) || 1);
  const byday = parts.get('BYDAY')
    ?.split(',')
    .map((d) => d.trim().toUpperCase())
    .filter(Boolean);
  const bymonthday = Number(parts.get('BYMONTHDAY')) || undefined;
  const bymonth = Number(parts.get('BYMONTH')) || undefined;
  const bysetpos = parts.get('BYSETPOS');
  const until = parts.get('UNTIL');
  const count = Number(parts.get('COUNT')) || undefined;
  const dtstart = parts.get('DTSTART');
  const tzid = parts.get('TZID');
  const wkst = parts.get('WKST');

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
      daysOfWeek: byday?.map((d) => ABBR_TO_DAY[d] ?? d.toLowerCase()),
      dayOfMonth: bymonthday,
      month: bymonth,
      firstDayOfWeek: wkst ? (ABBR_TO_DAY[wkst] ?? wkst.toLowerCase()) : 'sunday',
      index: bysetpos ? STR_TO_POS[bysetpos] : undefined,
    },
    range: {
      type: until ? 'endDate' : count ? 'numbered' : 'noEnd',
      startDate: dtstart ?? opts?.fallbackStartDate ?? new Date().toISOString().split('T')[0],
      endDate: until,
      numberOfOccurrences: count,
      recurrenceTimeZone: tzid,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Date / time helpers                                                */
/* ------------------------------------------------------------------ */

function normalizeRuleTokens(rule: string): string {
  const withoutPrefix = rule.trim().replace(/^RRULE:/i, '');

  return withoutPrefix
    .split(';')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const eq = segment.indexOf('=');
      if (eq === -1) return segment.toUpperCase();

      const key = segment.slice(0, eq).trim().toUpperCase();
      let rawValue = segment.slice(eq + 1).trim();

      if (key === 'BYDAY') {
        const days = rawValue
          .split(',')
          .map((d) => d.trim().toUpperCase())
          .filter(Boolean);
        rawValue = days.join(',');
      } else if (key === 'FREQ' || key === 'WKST') {
        rawValue = rawValue.toUpperCase();
      }

      return `${key}=${rawValue}`;
    })
    .join(';');
}

/**
 * Try to parse a human-readable recurrence back to RRULE.
 * This is best-effort — if we can't parse, return null.
 */
function parseHumanRecurrence(text: string): string | null {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  let freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY' | null = null;
  let interval = 1;

  if (lower.startsWith('daily')) freq = 'DAILY';
  else if (lower.startsWith('weekly')) freq = 'WEEKLY';
  else if (lower.startsWith('monthly')) freq = 'MONTHLY';
  else if (lower.startsWith('yearly')) freq = 'YEARLY';
  else {
    const everyCount = trimmed.match(/^every\s+(\d+)\s+(day|days|week|weeks|month|months|year|years)\b/i);
    if (everyCount) {
      interval = Math.max(1, Number(everyCount[1]));
      const unit = everyCount[2]!.toLowerCase();
      if (unit.startsWith('day')) freq = 'DAILY';
      else if (unit.startsWith('week')) freq = 'WEEKLY';
      else if (unit.startsWith('month')) freq = 'MONTHLY';
      else if (unit.startsWith('year')) freq = 'YEARLY';
    } else {
      const everySingle = trimmed.match(/^every\s+(day|week|month|year)\b/i);
      if (everySingle) {
        const unit = everySingle[1]!.toLowerCase();
        if (unit === 'day') freq = 'DAILY';
        else if (unit === 'week') freq = 'WEEKLY';
        else if (unit === 'month') freq = 'MONTHLY';
        else if (unit === 'year') freq = 'YEARLY';
      }
    }
  }

  if (!freq) return null;

  const parts: string[] = [`FREQ=${freq}`];
  if (interval > 1) parts.push(`INTERVAL=${interval}`);

  if (/\bon weekdays\b/i.test(trimmed)) {
    parts.push('BYDAY=MO,TU,WE,TH,FR');
  } else if (/\bon weekends\b/i.test(trimmed)) {
    parts.push('BYDAY=SA,SU');
  } else {
    const dayOfMonthMatch = trimmed.match(/\bon day\s+([1-9]|[12][0-9]|3[01])\b/i);
    if (dayOfMonthMatch && (freq === 'MONTHLY' || freq === 'YEARLY')) {
      parts.push(`BYMONTHDAY=${dayOfMonthMatch[1]}`);
    }

    const dayMatch = trimmed.match(/\bon\s+(.+?)(?:\s+until|\s+\(\d+\s+times\)|$)/i);
    if (dayMatch && !/^day\s+\d+/i.test(dayMatch[1]!.trim())) {
      const nameToAbbr: Record<string, string> = {
        mon: 'MO', tue: 'TU', wed: 'WE', thu: 'TH', fri: 'FR', sat: 'SA', sun: 'SU',
      };
      const days = dayMatch[1]!
        .replace(/\band\b/gi, ',')
        .split(',')
        .map((d) => nameToAbbr[d.trim().toLowerCase().slice(0, 3)] ?? '')
        .filter(Boolean);
      if (days.length) parts.push(`BYDAY=${days.join(',')}`);
    }
  }

  const untilMatch = trimmed.match(/\buntil\s+(.+?)(?:\s+\(\d+\s+times\)|$)/i);
  if (untilMatch) {
    const untilDate = parseDateToIsoDate(untilMatch[1]!);
    if (untilDate) parts.push(`UNTIL=${untilDate}`);
  }

  const countMatch = trimmed.match(/\((\d+)\s+times\)/i);
  if (countMatch) {
    const count = Number(countMatch[1]);
    if (count > 0) parts.push(`COUNT=${count}`);
  }

  return normalizeRuleTokens(parts.join(';'));
}

function parseDateToIsoDate(input: string): string | null {
  const raw = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const named = raw.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})$/);
  if (named) {
    const mon = named[1]!.slice(0, 3).toLowerCase();
    const monthMap: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const mm = monthMap[mon];
    if (!mm) return null;
    const dd = named[2]!.padStart(2, '0');
    const yyyy = named[3]!;
    return `${yyyy}-${mm}-${dd}`;
  }

  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  const d = new Date(parsed);
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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
