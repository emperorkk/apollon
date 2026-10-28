// Everything user-facing runs on Athens time (Europe/Athens, EET/EEST):
// "yesterday" for the daily report is the previous Athens calendar day,
// and displayed times are Athens times. Storage stays UTC.

export const SITE_TIME_ZONE = 'Europe/Athens';

// YYYY-MM-DD of `date` as seen in Athens.
export function athensDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SITE_TIME_ZONE }).format(date);
}

export function previousAthensDay(now = new Date()) {
  const [y, m, d] = athensDate(now).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

// Athens' UTC offset in minutes at the instant `utcMs` (120 or 180).
function athensOffsetMinutes(utcMs) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: SITE_TIME_ZONE,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(utcMs))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - utcMs) / 60000);
}

// [start, end) of Athens calendar day `date` (YYYY-MM-DD) as ISO UTC strings,
// e.g. 2026-10-27 -> 2026-10-26T21:00:00.000Z .. 2026-10-27T22:00:00.000Z
// (DST ends that night, so that day is 25 hours long).
export function athensDayBoundsUtc(date) {
  const [y, m, d] = date.split('-').map(Number);
  const midnight = (dd) => {
    const naive = Date.UTC(y, m - 1, dd);
    // Athens DST switches at 03:00/04:00 local, so midnight's offset is the
    // offset in effect a couple of hours before the naive instant too.
    return naive - athensOffsetMinutes(naive) * 60000;
  };
  return [new Date(midnight(d)).toISOString(), new Date(midnight(d + 1)).toISOString()];
}

// Human-readable Athens time, e.g. "28 Oct 2026, 06:23" — callers label it
// as Athens time (zone abbreviations aren't localised in every language).
export function formatAthensDateTime(date, locale = 'en-GB') {
  return new Date(date).toLocaleString(locale, {
    timeZone: SITE_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}
