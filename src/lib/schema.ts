import { z } from 'zod';

export const DOC_TYPES = ['faktura', 'umowa', 'oferta', 'raport', 'inne'] as const;
export type DocType = (typeof DOC_TYPES)[number];

const isRealIsoDate = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
};

const isoDate = z.string().refine(isRealIsoDate, 'Expected a real ISO 8601 date (YYYY-MM-DD)');

// Loose objects: the brief allows adding fields but never removing them.
export const InsightSchema = z.looseObject({
  document: z.looseObject({
    fileName: z.string(),
    pages: z.number().int().min(1),
    language: z.string().regex(/^[a-z]{2}$/, 'Expected ISO 639-1 code'),
    type: z.enum(DOC_TYPES),
    title: z.string().nullable(),
    date: isoDate.nullable(),
  }),
  summary: z.string().trim().min(1),
  keyPoints: z.array(z.string()).max(7),
  entities: z.looseObject({
    organizations: z.array(z.string()),
    people: z.array(z.string()),
  }),
  amounts: z.array(
    z.looseObject({
      value: z.number().finite(),
      currency: z.string().regex(/^[A-Z]{3}$/, 'Expected ISO 4217 code'),
      context: z.string(),
    }),
  ),
  dates: z.array(z.looseObject({ date: isoDate, context: z.string() })),
  keywords: z.array(z.string()),
});

export type Insight = z.infer<typeof InsightSchema>;

export type ParseResult = { success: true; data: Insight } | { success: false; error: string };

export function parseInsight(raw: unknown): ParseResult {
  const result = InsightSchema.safeParse(raw);
  if (result.success) return { success: true, data: result.data };
  const error = result.error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  return { success: false, error };
}

/** Returns the first balanced JSON object found in model output, or undefined. */
export function extractJson(text: string): unknown {
  const unfenced = text.replace(/```(?:json)?/gi, '');
  const start = unfenced.indexOf('{');
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < unfenced.length; i += 1) {
    const char = unfenced.charAt(i);
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(unfenced.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}
