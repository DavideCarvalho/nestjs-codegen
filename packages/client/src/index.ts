export const VERSION = '0.1.0';

export { createFetcher } from './fetcher/fetcher.js';
export type {
  Fetcher,
  FetcherOptions,
  PayloadTransformer,
  Transport,
  TransportRequest,
  TransportResponse,
} from './fetcher/fetcher.js';
export { setGlobalHeaders } from './fetcher/global-headers.js';
export { ApiHttpError } from './fetcher/errors.js';
export { buildUrl } from './fetcher/url-builder.js';
export type { BuildUrlOptions } from './fetcher/url-builder.js';
