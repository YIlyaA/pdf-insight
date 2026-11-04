import { splitIntoChunks, type PageText } from '../../src/lib/chunk';

const strip = (s: string) => s.replace(/\[\[Strona \d+\]\]/g, '').replace(/\s+/g, '');

describe('splitIntoChunks', () => {
  it('returns one chunk for a short document', () => {
    const pages: PageText[] = [
      { page: 1, text: 'Alfa' },
      { page: 2, text: 'Beta' },
    ];
    const chunks = splitIntoChunks(pages, 1000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.pages).toEqual([1, 2]);
    expect(chunks[0]?.text).toContain('Alfa');
    expect(chunks[0]?.text).toContain('Beta');
  });

  it('marks page boundaries so the model can tell pages apart', () => {
    const chunks = splitIntoChunks([{ page: 7, text: 'x' }], 1000);
    expect(chunks[0]?.text).toContain('[[Strona 7]]');
  });

  it('skips empty and whitespace-only pages', () => {
    const chunks = splitIntoChunks(
      [
        { page: 1, text: '   \n ' },
        { page: 2, text: 'Treść' },
      ],
      1000,
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.pages).toEqual([2, 2]);
  });

  it('returns no chunks when there is no text', () => {
    expect(splitIntoChunks([{ page: 1, text: '' }], 1000)).toEqual([]);
    expect(splitIntoChunks([], 1000)).toEqual([]);
  });

  it('never exceeds maxChars, even for one huge page without spaces', () => {
    const text = 'a'.repeat(5000);
    const chunks = splitIntoChunks([{ page: 1, text }], 1200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(1200);
  });

  it('keeps all text, in order, across chunks', () => {
    const pages: PageText[] = Array.from({ length: 30 }, (_, i) => ({
      page: i + 1,
      text: `Strona numer ${i + 1}. ` + 'Zażółć gęślą jaźń. '.repeat(40),
    }));
    const chunks = splitIntoChunks(pages, 3000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(strip(chunks.map((c) => c.text).join(''))).toBe(
      strip(pages.map((p) => p.text).join('')),
    );
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it('prefers to split on paragraph boundaries', () => {
    const para = 'Zdanie. '.repeat(100).trim();
    const chunks = splitIntoChunks([{ page: 1, text: `${para}\n\n${para}\n\n${para}` }], 1700);
    for (const c of chunks) expect(c.text.trim().endsWith('Zdanie.')).toBe(true);
  });

  it('reports page ranges per chunk in ascending order', () => {
    const pages: PageText[] = Array.from({ length: 10 }, (_, i) => ({
      page: i + 1,
      text: 'x'.repeat(900),
    }));
    const chunks = splitIntoChunks(pages, 2000);
    let last = 0;
    for (const c of chunks) {
      expect(c.pages[0]).toBeLessThanOrEqual(c.pages[1]);
      expect(c.pages[0]).toBeGreaterThanOrEqual(last);
      last = c.pages[1];
    }
  });

  it('does not split a surrogate pair', () => {
    const text = '😀'.repeat(2000);
    const chunks = splitIntoChunks([{ page: 1, text }], 1001);
    for (const c of chunks) expect(c.text).not.toMatch(/[\ud800-\udbff]$|^[\udc00-\udfff]/);
  });

  it('rejects a non-positive limit', () => {
    expect(() => splitIntoChunks([{ page: 1, text: 'a' }], 0)).toThrow();
  });
});
