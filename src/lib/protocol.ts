import { z } from 'zod';

/** Contract between the browser and the Worker. Shared so both sides validate the same shapes. */
export const MAX_BODY_BYTES = 8 * 1024 * 1024;
export const MAX_CHUNK_CHARS = 60_000;
export const MAX_IMAGES_PER_REQUEST = 8;
export const MAX_IMAGE_BASE64_CHARS = 1_500_000;
export const MAX_SUMMARIES = 50;

export const ERROR_CODES = [
  'forbidden_origin',
  'bad_request',
  'payload_too_large',
  'rate_limited',
  'quota_exceeded',
  'upstream_error',
  'timeout',
  'invalid_response',
  'content_blocked',
  'misconfigured',
  'not_found',
  'method_not_allowed',
  'internal_error',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const startsWith = (bytes: Uint8Array, signature: (number | null)[]): boolean =>
  signature.every((byte, i) => byte === null || bytes[i] === byte);

/** True when the base64 data is well formed and its first bytes match the declared image type. */
export function imageMatchesMime(mimeType: string, dataBase64: string): boolean {
  if (!BASE64.test(dataBase64)) return false;
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(dataBase64.slice(0, 16)), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  if (mimeType === 'image/jpeg') return startsWith(bytes, [0xff, 0xd8, 0xff]);
  if (mimeType === 'image/png')
    return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // "RIFF" + 4 size bytes + "WEBP"
  return startsWith(bytes, [
    0x52,
    0x49,
    0x46,
    0x46,
    null,
    null,
    null,
    null,
    0x57,
    0x45,
    0x42,
    0x50,
  ]);
}

const ImageSchema = z
  .object({
    page: z.number().int().min(1),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    dataBase64: z.string().min(1).max(MAX_IMAGE_BASE64_CHARS),
  })
  .refine((image) => imageMatchesMime(image.mimeType, image.dataBase64), {
    message: 'Image data is not valid base64 or does not match its type',
  });

export const AnalyzeRequestSchema = z
  .object({
    fileName: z.string().min(1).max(255),
    totalPages: z.number().int().min(1).max(5000),
    chunk: z.object({
      index: z.number().int().min(0),
      total: z.number().int().min(1),
      pages: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
      text: z.string().max(MAX_CHUNK_CHARS),
    }),
    images: z.array(ImageSchema).max(MAX_IMAGES_PER_REQUEST).default([]),
  })
  .refine((r) => r.chunk.text.trim().length > 0 || r.images.length > 0, {
    message: 'Either text or images are required',
  });
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

export const SummarizeRequestSchema = z.object({
  language: z.string().regex(/^[a-z]{2}$/),
  summaries: z.array(z.string().max(4000)).min(1).max(MAX_SUMMARIES),
});
export type SummarizeRequest = z.infer<typeof SummarizeRequestSchema>;

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string };
}
