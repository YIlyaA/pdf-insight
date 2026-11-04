// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractPages, PdfError } from '../../src/lib/pdfText';
import { MAX_FILE_BYTES, validateFile } from '../../src/lib/validateFile';

const gen = (name: string) =>
  new Uint8Array(readFileSync(resolve(__dirname, '../fixtures/generated', name)));
const head = (bytes: Uint8Array) => bytes.slice(0, 1024);

describe('validateFile', () => {
  const pdfHead = new TextEncoder().encode('%PDF-1.7\n');

  it('accepts a PDF within the limit', () => {
    expect(validateFile({ name: 'a.pdf', size: 1000, type: 'application/pdf' }, pdfHead)).toEqual({
      ok: true,
    });
  });
  it('accepts exactly the size limit and rejects one byte more', () => {
    expect(validateFile({ name: 'a.pdf', size: MAX_FILE_BYTES, type: '' }, pdfHead).ok).toBe(true);
    const over = validateFile({ name: 'a.pdf', size: MAX_FILE_BYTES + 1, type: '' }, pdfHead);
    expect(over).toMatchObject({ ok: false, code: 'too_large' });
  });
  it('rejects an empty file', () => {
    expect(
      validateFile({ name: 'a.pdf', size: 0, type: 'application/pdf' }, new Uint8Array()),
    ).toMatchObject({
      ok: false,
      code: 'empty',
    });
  });
  it('rejects a text file renamed to .pdf (no magic bytes)', () => {
    const r = validateFile(
      { name: 'a.pdf', size: 65, type: 'application/pdf' },
      head(gen('not-a-pdf.pdf')),
    );
    expect(r).toMatchObject({ ok: false, code: 'not_pdf' });
  });
  it('rejects a PNG even with a pdf mime type', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);
    expect(validateFile({ name: 'x.pdf', size: 8, type: 'application/pdf' }, png)).toMatchObject({
      ok: false,
      code: 'not_pdf',
    });
  });
  it('finds the PDF header when preceded by a few junk bytes', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...pdfHead]);
    expect(validateFile({ name: 'a.pdf', size: bytes.length, type: '' }, bytes).ok).toBe(true);
  });
  it('shows the real size in the too-large message (Polish)', () => {
    const r = validateFile({ name: 'a.pdf', size: 12 * 1024 * 1024, type: '' }, pdfHead);
    expect(!r.ok && r.message).toMatch(/12/);
    expect(!r.ok && r.message).toMatch(/za duży/);
  });
});

describe('extractPages', () => {
  it('opens documents with eval-based font code disabled', async () => {
    const getDocument = vi.fn((source: Parameters<typeof pdfjs.getDocument>[0]) =>
      pdfjs.getDocument(source),
    );
    await extractPages({ getDocument }, gen('tiny-1page-pl.pdf'));
    expect(getDocument).toHaveBeenCalledWith(expect.objectContaining({ isEvalSupported: false }));
  });

  it('flags every page of a scan-only PDF', async () => {
    const r = await extractPages(pdfjs, gen('scan-only.pdf'));
    expect(r.numPages).toBe(2);
    expect(r.scanPages).toEqual([1, 2]);
  });

  it('flags blank pages too (nothing to read)', async () => {
    const r = await extractPages(pdfjs, gen('blank-no-text.pdf'));
    expect(r.scanPages).toEqual([1, 2]);
  });

  it('handles mixed text and scan pages', async () => {
    const r = await extractPages(pdfjs, gen('mixed-text-and-scan.pdf'));
    expect(r.numPages).toBe(3);
    expect(r.scanPages).toEqual([2]);
  });

  it.each([
    ['invoice-en.pdf', 'EUR'],
    ['offer-uk.pdf', 'грн'],
    ['report-de.pdf', 'ä'],
    ['polish-formats.pdf', 'zł'],
  ])('keeps non-ASCII and multi-language text in %s', async (name, needle) => {
    const r = await extractPages(pdfjs, gen(name));
    expect(r.pages.map((p) => p.text).join(' ')).toContain(needle);
    expect(r.scanPages).toEqual([]);
  });

  it('reads a 60-page document', async () => {
    const r = await extractPages(pdfjs, gen('long-60pages-pl.pdf'));
    expect(r.numPages).toBe(60);
    expect(r.pages.reduce((n, p) => n + p.text.length, 0)).toBeGreaterThan(100_000);
  });

  it('reports a password-protected file', async () => {
    await expect(extractPages(pdfjs, gen('encrypted.pdf'))).rejects.toMatchObject({
      name: 'PdfError',
      code: 'password',
    });
  });

  it('reports a corrupt file', async () => {
    await expect(extractPages(pdfjs, gen('corrupt.pdf'))).rejects.toMatchObject({
      name: 'PdfError',
      code: 'corrupt',
    });
  });

  it('reports garbage that is not a PDF as corrupt', async () => {
    await expect(extractPages(pdfjs, gen('not-a-pdf.pdf'))).rejects.toBeInstanceOf(PdfError);
  });

  it('does not detach the caller buffer (can retry with the same file)', async () => {
    const bytes = gen('tiny-1page-pl.pdf');
    await extractPages(pdfjs, bytes);
    expect(bytes.byteLength).toBeGreaterThan(0);
    await expect(extractPages(pdfjs, bytes)).resolves.toBeDefined();
  });

  it('respects a custom minimum character threshold', async () => {
    const r = await extractPages(pdfjs, gen('tiny-1page-pl.pdf'), { minChars: 100000 });
    expect(r.scanPages).toEqual([1]);
  });
});
