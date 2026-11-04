import type { Insight } from './schema';

/** Characters around the year that may hold the day: "12 marca 2026", "March 12, 2026", "2026-05-07". */
const WINDOW = 20;

/**
 * True when the text states the full date: the year appears as a standalone number with the day
 * as another number right next to it. "marzec 2024", "after 1983" and "prior to 2012" fail.
 */
function isStated(date: string, text: string): boolean {
  const [year, , day] = date.split('-');
  if (year === undefined || day === undefined) return false;
  if (text.includes(date)) return true;
  const wantedDay = Number(day);
  const yearAt = new RegExp(`(?<!\\d)${year}(?!\\d)`, 'g');
  for (const match of text.matchAll(yearAt)) {
    const start = match.index ?? 0;
    const near =
      text.slice(Math.max(0, start - WINDOW), start) +
      ' ' +
      text.slice(start + year.length, start + year.length + WINDOW);
    const numbers = near.match(/\d+/g) ?? [];
    if (numbers.some((n) => Number(n) === wantedDay)) return true;
  }
  return false;
}

/**
 * The model sometimes completes a month or a year into "-01" or "-01-01" despite the prompt.
 * Dates are checked against the text layer the model was given; the date is dropped when the
 * text does not state it in full. Not for scan pages: there the text is read by the model itself.
 */
export function groundDates(insight: Insight, text: string): Insight {
  const documentDate = insight.document.date;
  return {
    ...insight,
    document: {
      ...insight.document,
      date: documentDate !== null && isStated(documentDate, text) ? documentDate : null,
    },
    dates: insight.dates.filter((d) => isStated(d.date, text)),
  };
}
