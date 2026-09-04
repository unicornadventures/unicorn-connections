// Events are stored as UTC (event_date + event_time columns) and always
// displayed in the school's local timezone, labeled with its abbreviation
// (e.g. "7:30pm (EST)"), per school.timezone (an IANA zone name).

const DEFAULT_TIME_ZONE = 'UTC';

/**
 * Converts a wall-clock date/time (as entered by an admin, e.g. "7:30pm" for
 * the venue) into a UTC ISO string, interpreting those values as being in
 * `timeZone` rather than the browser's own local zone.
 */
export function zonedWallTimeToUtcISOString(dateStr: string, timeStr: string, timeZone: string | null): string {
  const tz = timeZone || DEFAULT_TIME_ZONE;
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);

  // First guess: treat the wall-clock components as if they were already UTC.
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);

  // See what wall-clock time that guess actually renders as in the target
  // zone, then shift by the difference to converge on the correct instant.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(utcGuess));

  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);
  const renderedUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));

  const correctedUtc = utcGuess + (utcGuess - renderedUTC);
  return new Date(correctedUtc).toISOString();
}

/** Reconstructs the real UTC instant from the stored event_date/event_time columns. */
export function eventInstant(eventDate: string, eventTime: string | null): Date {
  const time = eventTime ? eventTime.slice(0, 8) : '12:00:00';
  return new Date(`${eventDate.slice(0, 10)}T${time}Z`);
}

/**
 * Renders a UTC instant as school-local wall-clock date/time strings, in the
 * shape `<input type="date">`/`<input type="time">` expect — the inverse of
 * zonedWallTimeToUtcISOString, used to prefill the edit form correctly.
 */
export function utcToZonedWallTime(instant: Date, timeZone: string | null): { date: string; time: string } {
  const tz = timeZone || DEFAULT_TIME_ZONE;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}

export interface EventDateLabel {
  day: number;
  month: string;
  year: number;
}

/**
 * Formats an event's stored UTC date/time in the school's local timezone.
 * `timeLabel` is null when the event has no time set; otherwise it reads
 * like "7:30pm (EST)".
 */
export function formatEventDateTime(eventDate: string, eventTime: string | null, timeZone: string | null): {
  instant: Date;
  dateLabel: EventDateLabel;
  timeLabel: string | null;
} {
  const tz = timeZone || DEFAULT_TIME_ZONE;
  const instant = eventInstant(eventDate, eventTime);

  const dateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: 'short', day: 'numeric',
  }).formatToParts(instant);
  const getDatePart = (type: string) => dateParts.find(p => p.type === type)?.value ?? '';

  const dateLabel: EventDateLabel = {
    day: Number(getDatePart('day')),
    month: getDatePart('month').toUpperCase(),
    year: Number(getDatePart('year')),
  };

  let timeLabel: string | null = null;
  if (eventTime) {
    const timeParts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short',
    }).formatToParts(instant);
    const getTimePart = (type: string) => timeParts.find(p => p.type === type)?.value ?? '';
    const hour = getTimePart('hour');
    const minute = getTimePart('minute');
    const dayPeriod = getTimePart('dayPeriod').toLowerCase();
    const zoneName = getTimePart('timeZoneName');
    timeLabel = `${hour}:${minute}${dayPeriod} (${zoneName})`;
  }

  return { instant, dateLabel, timeLabel };
}
