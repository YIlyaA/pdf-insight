import { MESSAGES } from './messages';
import type { PageText } from './chunk';

export type PdfErrorCode = 'password' | 'corrupt';

export class PdfError extends Error {
  readonly code: PdfErrorCode;
  constructor(code: PdfErrorCode) {
    super(code === 'password' ? MESSAGES.errPassword : MESSAGES.errCorrupt);
    this.name = 'PdfError';
    this.code = code;
  }
}

/** The part of pdf.js we use; lets tests inject the Node build and the app the browser build. */
export interface PdfJsLike {
  getDocument(source: { data: Uint8Array }): PdfLoadingTaskLike;
}

interface PdfLoadingTaskLike {
  promise: Promise<PdfDocumentLike>;
  destroy(): Promise<void>;
}

interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<{
    getTextContent(): Promise<{ items: unknown[] }>;
  }>;
}

export interface ExtractedPdf {
  numPages: number;
  pages: PageText[];
  /** Pages with too little text to analyse as text (scans or blank): they need image reading. */
  scanPages: number[];
}

export const DEFAULT_MIN_CHARS = 30;

function itemsToText(items: unknown[]): string {
  const parts: string[] = [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null || !('str' in item)) continue;
    const { str, hasEOL } = item as { str: unknown; hasEOL?: unknown };
    if (typeof str !== 'string') continue;
    parts.push(str, hasEOL === true ? '\n' : ' ');
  }
  return parts
    .join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .trim();
}

/** Reads text per page. Never modifies the caller's buffer. */
export async function extractPages(
  pdfjs: PdfJsLike,
  data: Uint8Array,
  options: { minChars?: number } = {},
): Promise<ExtractedPdf> {
  const minChars = options.minChars ?? DEFAULT_MIN_CHARS;
  const task = pdfjs.getDocument({ data: data.slice() });
  let doc: PdfDocumentLike;
  try {
    doc = await task.promise;
  } catch (error) {
    await task.destroy();
    throw new PdfError(
      error instanceof Error && error.name === 'PasswordException' ? 'password' : 'corrupt',
    );
  }
  try {
    if (doc.numPages < 1) throw new PdfError('corrupt');
    const pages: PageText[] = [];
    const scanPages: number[] = [];
    for (let page = 1; page <= doc.numPages; page += 1) {
      const content = await (await doc.getPage(page)).getTextContent();
      const text = itemsToText(content.items);
      pages.push({ page, text });
      if (text.length < minChars) scanPages.push(page);
    }
    return { numPages: doc.numPages, pages, scanPages };
  } catch (error) {
    if (error instanceof PdfError) throw error;
    throw new PdfError('corrupt');
  } finally {
    await task.destroy();
  }
}
