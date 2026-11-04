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
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

const ImageSchema = z.object({
  page: z.number().int().min(1),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  dataBase64: z.string().min(1).max(MAX_IMAGE_BASE64_CHARS),
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
