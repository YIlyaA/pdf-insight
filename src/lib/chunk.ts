export interface PageText {
  page: number;
  text: string;
}

export interface Chunk {
  index: number;
  /** First and last page contained in the chunk. */
  pages: [number, number];
  text: string;
}

interface Piece {
  page: number;
  text: string;
}

function cutPoint(text: string, max: number): number {
  const window = text.slice(0, max);
  for (const separator of ['\n\n', '\n', '. ', ' ']) {
    const at = window.lastIndexOf(separator);
    if (at > 0) return separator === '. ' ? at + 1 : at;
  }
  // Hard cut: do not split a surrogate pair.
  const code = window.charCodeAt(max - 1);
  return code >= 0xd800 && code <= 0xdbff && max > 1 ? max - 1 : max;
}

function splitText(text: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const cut = cutPoint(rest, max);
    const head = rest.slice(0, cut).trimEnd();
    if (head) pieces.push(head);
    rest = rest.slice(cut).trimStart();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** Splits page texts into chunks of at most maxChars, keeping page markers and order. */
export function splitIntoChunks(pages: PageText[], maxChars: number): Chunk[] {
  if (!Number.isInteger(maxChars) || maxChars <= 0) {
    throw new Error('maxChars must be a positive integer');
  }
  const pieces: Piece[] = [];
  for (const { page, text } of pages) {
    const body = text.trim();
    if (!body) continue;
    for (const piece of splitText(`[[Strona ${page}]]\n${body}`, maxChars)) {
      pieces.push({ page, text: piece });
    }
  }

  const chunks: Chunk[] = [];
  let current: Piece[] = [];
  let length = 0;
  const flush = () => {
    if (current.length === 0) return;
    const first = current[0];
    const last = current[current.length - 1];
    if (!first || !last) return;
    chunks.push({
      index: chunks.length,
      pages: [first.page, last.page],
      text: current.map((p) => p.text).join('\n\n'),
    });
    current = [];
    length = 0;
  };
  for (const piece of pieces) {
    const added = piece.text.length + (current.length > 0 ? 2 : 0);
    if (length + added > maxChars) flush();
    length += piece.text.length + (current.length > 0 ? 2 : 0);
    current.push(piece);
  }
  flush();
  return chunks;
}
