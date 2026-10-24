/** 国务院法定放假日（Asia/Shanghai 日历日 YYYY-MM-DD）。 */
const CN_HOLIDAYS = new Set<string>([
  // 国办发明电〔2025〕7号（2026 年）
  "2026-01-01",
  "2026-01-02",
  "2026-01-03",
  "2026-02-15",
  "2026-02-16",
  "2026-02-17",
  "2026-02-18",
  "2026-02-19",
  "2026-02-20",
  "2026-02-21",
  "2026-02-22",
  "2026-02-23",
  "2026-04-04",
  "2026-04-05",
  "2026-04-06",
  "2026-05-01",
  "2026-05-02",
  "2026-05-03",
  "2026-05-04",
  "2026-05-05",
  "2026-06-19",
  "2026-06-20",
  "2026-06-21",
  "2026-09-25",
  "2026-09-26",
  "2026-09-27",
  "2026-10-01",
  "2026-10-02",
  "2026-10-03",
  "2026-10-04",
  "2026-10-05",
  "2026-10-06",
  "2026-10-07",
]);

/** 周末调休上班日。 */
const CN_MAKEUP_WORKDAYS = new Set<string>([
  "2026-01-04",
  "2026-02-14",
  "2026-02-28",
  "2026-05-09",
  "2026-09-20",
  "2026-10-10",
]);

const WEEKDAY_SUN0: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Calendar date in a timezone as YYYY-MM-DD.
 */
export function dateKey(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Weekday in `timeZone`: 0 = Sunday … 6 = Saturday.
 */
function weekdaySun0(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).formatToParts(at);
  const raw = parts.find((p) => p.type === "weekday")?.value ?? "";
  return WEEKDAY_SUN0[raw] ?? -1;
}

/**
 * Whether `at` falls on a listed CN statutory holiday in `timeZone`.
 */
export function isCnHoliday(at: Date, timeZone: string): boolean {
  return CN_HOLIDAYS.has(dateKey(at, timeZone));
}

/**
 * Mainland China workday: weekdays minus holidays, plus makeup weekends.
 */
export function isCnWorkday(at: Date, timeZone: string): boolean {
  const key = dateKey(at, timeZone);
  if (CN_HOLIDAYS.has(key)) {
    return false;
  }
  if (CN_MAKEUP_WORKDAYS.has(key)) {
    return true;
  }
  const dow = weekdaySun0(at, timeZone);
  return dow >= 1 && dow <= 5;
}
