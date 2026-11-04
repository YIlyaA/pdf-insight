import type { ModelRequest } from './prompt';

export type GeminiFailure = 'quota' | 'overloaded' | 'upstream' | 'auth' | 'timeout' | 'blocked';

export class GeminiError extends Error {
  readonly kind: GeminiFailure;
  /** HTTP status returned by the provider, when there was a response. Never the message. */
  readonly status: number | undefined;
  constructor(kind: GeminiFailure, status?: number) {
    super(`Gemini call failed: ${kind}`);
    this.name = 'GeminiError';
    this.kind = kind;
    this.status = status;
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
  const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';
  let response: Response;
  let data: GeminiResponse = {};
  // The timer covers the whole exchange, including reading the body: a provider that sends
  // headers and then stalls must not hang the request.
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
    try {
      data = (await response.json()) as GeminiResponse;
    } catch (error) {
      if (isAbort(error)) throw error;
      if (response.ok) throw new GeminiError('upstream');
    }
  } catch (error) {
    if (error instanceof GeminiError) throw error;
    throw new GeminiError(isAbort(error) ? 'timeout' : 'upstream');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    if (response.status === 429 || data.error?.status === 'RESOURCE_EXHAUSTED')
      throw new GeminiError('quota', response.status);
    if (response.status === 503 || data.error?.status === 'UNAVAILABLE') {
      throw new GeminiError('overloaded', response.status);
    }
    if (response.status === 401 || response.status === 403)
      throw new GeminiError('auth', response.status);
    if (response.status === 400 && /api key/i.test(data.error?.message ?? ''))
      throw new GeminiError('auth', response.status);
    throw new GeminiError('upstream', response.status);
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
