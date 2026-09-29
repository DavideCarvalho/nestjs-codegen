---
"@dudousxd/nestjs-client": minor
---

Requests take an `AbortSignal` (`fetcher.get(path, { signal })`), forwarded by the native `fetch` transport and `axiosTransport`. `onError` may return (or throw) an `Error` to have the fetcher throw that instead of the `ApiHttpError` — an app keeps its own error class without wrapping every call.
