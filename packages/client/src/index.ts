export const VERSION = '0.6.0';

export { createFetcher, composeTransformers, consumeSse } from './fetcher/fetcher.js';
export type {
  Fetcher,
  FetcherOptions,
  PayloadTransformer,
  RawResponse,
  ResponseType,
  SseOpts,
  Transport,
  TransportRequest,
  TransportResponse,
  UploadProgressHandler,
} from './fetcher/fetcher.js';
export { axiosTransport } from './transports/axios.js';
export type { AxiosLike } from './transports/axios.js';
export { setGlobalHeaders } from './fetcher/global-headers.js';
export { ApiHttpError } from './fetcher/errors.js';
export { buildUrl } from './fetcher/url-builder.js';
export type { BuildUrlOptions } from './fetcher/url-builder.js';
export type { Jsonify } from './shared/jsonify.js';
