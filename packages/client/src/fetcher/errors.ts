/**
 * An HTTP error raised by the fetcher. `TBody` is the typed error response body:
 * the generated `api.ts` carries a per-route `error` type (`Route.Error<K>`), so
 * callers can narrow `err.body` to the route's declared error shape, e.g.
 * `new ApiHttpError<Route.Error<'users.create'>>(...)` or by asserting the caught
 * error. Defaults to `unknown` when the route declares no error type.
 */
/* v8 ignore next -- class declaration is not a branch */
export class ApiHttpError<TBody = unknown> extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: TBody,
  ) {
    super(`HTTP ${status} ${statusText}`);
    this.name = 'ApiHttpError';
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
  get isForbidden(): boolean {
    return this.status === 403;
  }
  get isNotFound(): boolean {
    return this.status === 404;
  }
  get isClient(): boolean {
    return this.status >= 400 && this.status < 500;
  }
  get isServer(): boolean {
    return this.status >= 500;
  }

  /**
   * Returns a JSON-serializable representation of the error. The `body` field is
   * **redacted by default** to prevent accidental logging of sensitive response
   * bodies. Pass `verbose = true` to include the full body.
   */
  toJSON(verbose = false): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      statusText: this.statusText,
      body: verbose ? this.body : '[redacted — pass verbose=true to include]',
    };
  }

  static async fromResponse(res: Response): Promise<ApiHttpError> {
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('application/json')
      ? await res.json().catch(() => null)
      : await res.text().catch(() => '');
    return new ApiHttpError(res.status, res.statusText, body);
  }
}
