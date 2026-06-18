export const VERSION = '0.3.0';

export { createFetcher, composeTransformers, consumeSse } from './fetcher/fetcher.js';
export type {
  Fetcher,
  FetcherOptions,
  PayloadTransformer,
  SseOpts,
  Transport,
  TransportRequest,
  TransportResponse,
} from './fetcher/fetcher.js';
export { axiosTransport } from './transports/axios.js';
export type { AxiosLike } from './transports/axios.js';
export { setGlobalHeaders } from './fetcher/global-headers.js';
export { ApiHttpError } from './fetcher/errors.js';
export { buildUrl } from './fetcher/url-builder.js';
export type { BuildUrlOptions } from './fetcher/url-builder.js';
