import { MESSAGES } from './messages';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export type ValidationCode = 'empty' | 'too_large' | 'not_pdf';
export type ValidationResult = { ok: true } | { ok: false; code: ValidationCode; message: string };

interface FileInfo {
  name: string;
  size: number;
  type: string;
}

const MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

function hasPdfHeader(head: Uint8Array): boolean {
  const limit = Math.min(head.length, 1024) - MAGIC.length;
  for (let i = 0; i <= limit; i += 1) {
    if (MAGIC.every((byte, j) => head[i + j] === byte)) return true;
  }
  return false;
}

/** Client-side checks before any upload. `head` is the first bytes of the file. */
export function validateFile(file: FileInfo, head: Uint8Array): ValidationResult {
  if (file.size === 0) return { ok: false, code: 'empty', message: MESSAGES.errEmpty };
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      code: 'too_large',
      message: MESSAGES.errTooLarge(file.size, MAX_FILE_BYTES),
    };
  }
  if (!hasPdfHeader(head)) return { ok: false, code: 'not_pdf', message: MESSAGES.errNotPdf };
  return { ok: true };
}
