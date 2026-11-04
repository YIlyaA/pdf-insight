// @vitest-environment node
import { fitImage, isBlankPixels } from '../../src/lib/renderPages';

function rgba(
  width: number,
  height: number,
  pixel: (x: number, y: number) => number,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const v = pixel(x, y);
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return data;
}

describe('isBlankPixels', () => {
  it('is true for a uniform white page', () => {
    expect(isBlankPixels(rgba(100, 100, () => 255))).toBe(true);
  });
  it('is true for a uniform black page', () => {
    expect(isBlankPixels(rgba(100, 100, () => 0))).toBe(true);
  });
  it('is false when half the page is dark', () => {
    expect(isBlankPixels(rgba(100, 100, (x) => (x < 50 ? 0 : 255)))).toBe(false);
  });
  it('respects the tolerance on the channel spread', () => {
    const data = rgba(100, 100, (x) => (x < 50 ? 200 : 210));
    expect(isBlankPixels(data, 10)).toBe(true);
    expect(isBlankPixels(data, 5)).toBe(false);
  });
});

describe('fitImage', () => {
  it('returns the first encoding when it fits (quality 0.85, scale 1)', () => {
    const encode = vi.fn((quality: number, scale: number) =>
      'x'.repeat(quality > 0 && scale > 0 ? 100 : 100),
    );
    expect(fitImage(encode, 1000)).toBe('x'.repeat(100));
    expect(encode).toHaveBeenCalledTimes(1);
    expect(encode.mock.calls[0]?.[0]).toBeCloseTo(0.85);
    expect(encode.mock.calls[0]?.[1]).toBe(1);
  });

  it('lowers the quality first, keeping the scale', () => {
    const calls: Array<[number, number]> = [];
    const result = fitImage((q, s) => {
      calls.push([q, s]);
      return q > 0.6 ? 'x'.repeat(5000) : 'ok';
    }, 1000);
    expect(result).toBe('ok');
    expect(calls.every(([, s]) => s === 1)).toBe(true);
    const qualities = calls.map(([q]) => q);
    for (let i = 1; i < qualities.length; i += 1) {
      expect(qualities[i] ?? 1).toBeLessThan(qualities[i - 1] ?? 0);
    }
    expect(qualities[qualities.length - 1] ?? 1).toBeLessThanOrEqual(0.6);
  });

  it('lowers the scale only after the quality floor (0.3) is reached', () => {
    const calls: Array<[number, number]> = [];
    const result = fitImage((q, s) => {
      calls.push([q, s]);
      return s < 1 ? 'ok' : 'x'.repeat(5000);
    }, 1000);
    expect(result).toBe('ok');
    const first = calls.find(([, s]) => s < 1);
    expect(first).toBeDefined();
    expect(first?.[0] ?? 1).toBeCloseTo(0.3);
    const last = calls[calls.length - 1];
    expect(last?.[1] ?? 1).toBeLessThan(1);
    expect(Math.min(...calls.map(([q]) => q))).toBeGreaterThanOrEqual(0.3 - 1e-9);
  });

  it('throws Error("too_large") when nothing fits', () => {
    expect(() => fitImage(() => 'x'.repeat(5000), 1000)).toThrow('too_large');
  });

  it('uses 700000 characters as the default limit', () => {
    expect(fitImage(() => 'x'.repeat(700_000))).toHaveLength(700_000);
    expect(() => fitImage(() => 'x'.repeat(700_001))).toThrow('too_large');
  });
});
