import type { Insight } from './schema';

/**
 * Characters around the year that may hold the day: "12 października 2026" needs 12 before the
 * year, "2026-05-07" needs 6 after it.
 */
const BEFORE = 18;
const AFTER = 8;

/** Numbers in the text between the two offsets, leaving out those cut by either edge ("10231" cut to "1"). */
function wholeNumbers(text: string, from: number, to: number): number[] {
  const start = Math.max(0, from - 1);
  const end = Math.min(text.length, to + 1);
  const slice = text.slice(start, end);
  const found: number[] = [];
  for (const m of slice.matchAll(/\d+/g)) {
    const at = m.index ?? 0;
    const cutLeft = at === 0 && start > 0;
    const cutRight = at + m[0].length === slice.length && end < text.length;
    if (!cutLeft && !cutRight) found.push(Number(m[0]));
  }
  return found;
}

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
    const at = match.index ?? 0;
    const numbers = [
      ...wholeNumbers(text, at - BEFORE, at),
      ...wholeNumbers(text, at + year.length, at + year.length + AFTER),
    ];
    if (numbers.includes(wantedDay)) return true;
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
