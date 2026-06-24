---
"@dudousxd/nestjs-client": minor
---

feat(client): binary downloads, response-header access, and multipart upload progress.

The transport contract now carries a per-request `responseType` (`'json' | 'text' | 'blob' | 'arrayBuffer'`) and an `onUploadProgress` callback, and a `TransportResponse` may expose all response `headers` (lower-cased keys) plus `blob()`/`arrayBuffer()` body readers. All new fields are optional, so the JSON path and any pre-existing custom transport are unchanged.

Two escape-hatch methods are added to `Fetcher`:

- `fetchBlob(path, opts?)` → `Promise<RawResponse<Blob>>` — file/PDF/CSV downloads. Returns `{ data: Blob, status, headers }`; read `headers['content-disposition']` for the original filename or `headers['x-auth-token']` for a rotated token. `superjson`/`deserialize` never runs on the blob.
- `fetchRaw<T>(path, opts?)` → `Promise<RawResponse<T>>` — general raw access with `responseType` (default `'json'`) and `onUploadProgress` for FormData uploads.

The bundled `axiosTransport` now maps `responseType` onto axios (`blob`/`arraybuffer`), forwards `onUploadProgress`, and surfaces all response headers (including `AxiosHeaders` via `.toJSON()`/`.get()`). The native-`fetch` transport supports blob/arrayBuffer + headers and no-ops on upload progress (the WHATWG fetch transport cannot observe it).

New exported types: `ResponseType`, `UploadProgressHandler`, `RawResponse`.
