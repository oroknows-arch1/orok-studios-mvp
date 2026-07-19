"use strict";

/**
 * Timezone helpers for draft preparation windows.
 * Default local zone: Australia/Sydney (OROK family context).
 * Override with PUBLISHING_TIMEZONE.
 */

const DEFAULT_TIMEZONE = "Australia/Sydney";

/**
 * @param {string} [timeZone]
 * @returns {string}
 */
function resolveTimeZone(timeZone) {
  return timeZone || process.env.PUBLISHING_TIMEZONE || DEFAULT_TIMEZONE;
}

/**
 * Parts of "now" in the configured local timezone.
 * @param {Date} [date]
 * @param {string} [timeZone]
 * @returns {{year:number,month:number,day:number,hour:number,minute:number,weekday:number,dateStr:string}}
 * weekday: 1=Mon ... 7=Sun (ISO)
 */
function localParts(date = new Date(), timeZone = resolveTimeZone()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).filter((p) => p.type !== "literal").map((p) => [p.type, p.value])
  );
  const weekdayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const weekday = weekdayMap[parts.weekday] || 1;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
  return { year, month, day, hour, minute, weekday, dateStr };
}

/**
 * Minutes since local midnight.
 * @param {{hour:number,minute:number}} parts
 */
function minutesSinceMidnight(parts) {
  return parts.hour * 60 + parts.minute;
}

/**
 * Whether local time is inside [startHour:startMin, endHour:endMin) window.
 */
function inWindow(parts, startHour, startMin, endHour, endMin) {
  const t = minutesSinceMidnight(parts);
  const start = startHour * 60 + startMin;
  const end = endHour * 60 + endMin;
  return t >= start && t < end;
}

module.exports = {
  DEFAULT_TIMEZONE,
  resolveTimeZone,
  localParts,
  minutesSinceMidnight,
  inWindow,
};
