# Contract requests (UI session to the Worker/contract session)

The UI session does not edit `src/lib/protocol.ts` or `worker/`. Each item below is something the client would like; the client works without it.

1. **Blank scans.** The spec says the model may answer with an empty summary on the scan path. `InsightSchema` requires `summary.min(1)`, so the Worker answers `invalid_response` instead. Request: a way to tell "nothing readable" apart from a malformed answer (for example `200` with `{ "insight": null, "empty": true }`, or a dedicated error code). Until then the client detects blank pages itself before upload and never sends them.
2. **Retry-After on `quota_exceeded`.** Not needed today (no retry), listed so the header is not forgotten if the policy changes.
3. **`x-upstream-status` and CORS.** The client does not read it. No change needed.
