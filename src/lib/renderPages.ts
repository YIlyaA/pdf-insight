import { PdfError } from './pdfText';

export interface RenderedPage {
  page: number;
  mimeType: 'image/jpeg';
  /** JPEG without the data-URL prefix; empty for a blank page (it is never sent). */
  dataBase64: string;
  blank: boolean;
}

export interface PageRenderer {
  render(page: number): Promise<RenderedPage>;
  destroy(): Promise<void>;
}

/** Keeps 8 images under the Worker's 8 MB body cap (spec 11.2). */
export const MAX_IMAGE_BASE64 = 700_000;

const DEFAULT_BLANK_TOLERANCE = 20;
const MAX_SAMPLES = 16_384;

/** True when pixels are almost uniform (max channel spread of a sampled grid <= tolerance). RGBA input. */
export function isBlankPixels(
  rgba: Uint8ClampedArray,
  tolerance: number = DEFAULT_BLANK_TOLERANCE,
): boolean {
  const pixels = Math.floor(rgba.length / 4);
  const step = Math.max(1, Math.floor(pixels / MAX_SAMPLES));
  const min = [255, 255, 255];
  const max = [0, 0, 0];
  for (let p = 0; p < pixels; p += step) {
    for (let c = 0; c < 3; c += 1) {
      const value = rgba[p * 4 + c] ?? 0;
      if (value < (min[c] ?? 0)) min[c] = value;
      if (value > (max[c] ?? 255)) max[c] = value;
    }
  }
  return [0, 1, 2].every((c) => (max[c] ?? 0) - (min[c] ?? 0) <= tolerance);
}

const QUALITY_START = 0.85;
const QUALITY_STEP = 0.1;
const QUALITY_FLOOR = 0.3;
const SCALE_STEP = 0.8;
const SCALE_FLOOR = 0.25;

/** 0.85, 0.75, ... down to the 0.3 floor. */
function qualities(): number[] {
  const list: number[] = [];
  for (let q = QUALITY_START; q > QUALITY_FLOOR + 1e-9; q -= QUALITY_STEP) {
    list.push(Math.round(q * 100) / 100);
  }
  list.push(QUALITY_FLOOR);
  return list;
}

/** Lowers JPEG quality (start 0.85, step 0.1, floor 0.3), then the scale, until encode() output fits maxChars. Throws AppError-free Error('too_large') when nothing fits. */
export function fitImage(
  encode: (quality: number, scale: number) => string,
  maxChars: number = MAX_IMAGE_BASE64,
): string {
  for (const quality of qualities()) {
    const out = encode(quality, 1);
    if (out.length <= maxChars) return out;
  }
  for (let scale = SCALE_STEP; scale >= SCALE_FLOOR; scale *= SCALE_STEP) {
    const out = encode(QUALITY_FLOOR, scale);
    if (out.length <= maxChars) return out;
  }
  throw new Error('too_large');
}

interface RenderViewport {
  width: number;
  height: number;
}

interface RenderablePage {
  getViewport(params: { scale: number }): RenderViewport;
  render(params: {
    canvasContext?: CanvasRenderingContext2D;
    viewport: RenderViewport;
    canvas: HTMLCanvasElement | null;
  }): { promise: Promise<void> };
  cleanup(): boolean;
}

interface RenderableDocument {
  getPage(pageNumber: number): Promise<RenderablePage>;
}

/** The part of pdf.js used for rendering scan pages; the real `pdfjs-dist` module satisfies it. */
export interface RenderCapablePdfJs {
  getDocument(source: { data: Uint8Array; isEvalSupported?: boolean }): {
    promise: Promise<RenderableDocument>;
    destroy(): Promise<void>;
  };
}

const TARGET_LONG_SIDE = 1600;
const BLANK_SAMPLE_SIDE = 128;
const JPEG_PREFIX = 'data:image/jpeg;base64,';

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!context) throw new Error('canvas_unavailable');
  return context;
}

/** Copies the canvas at a smaller size (used for scaled encodes and the blank check). */
function shrink(source: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const target = createCanvas(source.width * scale, source.height * scale);
  context2d(target).drawImage(source, 0, 0, target.width, target.height);
  return target;
}

function encodeJpeg(canvas: HTMLCanvasElement, quality: number, scale: number): string {
  const source = scale === 1 ? canvas : shrink(canvas, scale);
  const url = source.toDataURL('image/jpeg', quality);
  if (!url.startsWith(JPEG_PREFIX)) throw new Error('encode_failed');
  return url.slice(JPEG_PREFIX.length);
}

function isBlankCanvas(canvas: HTMLCanvasElement): boolean {
  const sample = shrink(canvas, BLANK_SAMPLE_SIDE / Math.max(canvas.width, canvas.height));
  const { data } = context2d(sample).getImageData(0, 0, sample.width, sample.height);
  return isBlankPixels(data);
}

/** Browser implementation over pdf.js + canvas. Not unit-tested (needs canvas); exercised manually. */
export async function createPageRenderer(
  pdfjs: RenderCapablePdfJs,
  data: Uint8Array,
): Promise<PageRenderer> {
  // pdf.js may transfer the buffer to its worker, so it gets a copy.
  const task = pdfjs.getDocument({ data: data.slice(), isEvalSupported: false });
  let doc: RenderableDocument;
  try {
    doc = await task.promise;
  } catch (error) {
    await task.destroy();
    throw new PdfError(
      error instanceof Error && error.name === 'PasswordException' ? 'password' : 'corrupt',
    );
  }

  return {
    async render(page: number): Promise<RenderedPage> {
      const pdfPage = await doc.getPage(page);
      const base = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({
        scale: TARGET_LONG_SIDE / Math.max(base.width, base.height, 1),
      });
      const canvas = createCanvas(viewport.width, viewport.height);
      // Passing the context keeps rendering on the main thread, so the canvas stays readable.
      await pdfPage.render({ canvasContext: context2d(canvas), viewport, canvas }).promise;
      try {
        const blank = isBlankCanvas(canvas);
        const dataBase64 = blank ? '' : fitImage((q, s) => encodeJpeg(canvas, q, s));
        return { page, mimeType: 'image/jpeg', dataBase64, blank };
      } finally {
        pdfPage.cleanup();
        canvas.width = 0;
        canvas.height = 0;
      }
    },
    destroy: () => task.destroy(),
  };
}
