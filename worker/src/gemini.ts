import type { ModelRequest } from './prompt';

export type GeminiFailure = 'quota' | 'upstream' | 'auth' | 'timeout' | 'blocked';

export class GeminiError extends Error {
  readonly kind: GeminiFailure;
  constructor(kind: GeminiFailure) {
    super(`Gemini call failed: ${kind}`);
    this.name = 'GeminiError';
    this.kind = kind;
  }
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { status?: string; message?: string };
}

interface CallOptions {
  apiKey: string;
  model: string;
  request: ModelRequest;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}

const BLOCKED_REASONS = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'IMAGE_SAFETY']);

/** Calls Gemini and returns the answer text, or null when the model gave no text. */
export async function callGemini(options: CallOptions): Promise<string | null> {
  const { apiKey, model, request, timeoutMs, fetchImpl } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: 'user', parts: request.parts }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0 },
        }),
        signal: controller.signal,
      },
    );
  } catch (error) {
    throw new GeminiError(
      error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'upstream',
    );
  } finally {
    clearTimeout(timer);
  }

  let data: GeminiResponse = {};
  try {
    data = (await response.json()) as GeminiResponse;
  } catch {
    if (!response.ok) data = {};
    else throw new GeminiError('upstream');
  }

  if (!response.ok) {
    if (response.status === 429 || data.error?.status === 'RESOURCE_EXHAUSTED')
      throw new GeminiError('quota');
    if (response.status === 401 || response.status === 403) throw new GeminiError('auth');
    if (response.status === 400 && /api key/i.test(data.error?.message ?? ''))
      throw new GeminiError('auth');
    throw new GeminiError('upstream');
  }

  if (data.promptFeedback?.blockReason) throw new GeminiError('blocked');
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) {
    if (candidate?.finishReason && BLOCKED_REASONS.has(candidate.finishReason))
      throw new GeminiError('blocked');
    return null;
  }
  return text;
}
