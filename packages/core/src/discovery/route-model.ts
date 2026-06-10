import type { SchemaModule } from '../ir/schema-node.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Request/response shape for a route, as discovered from contracts/DTOs. */
export interface RouteContract {
  /** Validation IR for the request body, if any. */
  body?: SchemaModule;
  /** Validation IR for the query params, if any. */
  query?: SchemaModule;
  /** TS type text for the response, e.g. `'User'` or `'User[]'`. Default `unknown`. */
  responseType?: string;
  /** TS type text for the request body, e.g. `'CreateUserDto'`. Default `unknown`. */
  bodyType?: string;
}

export interface RouteDescriptor {
  /** Dotted name, e.g. `'users.list'`, `'auth.login'`. */
  name: string;
  method: HttpMethod;
  /** Path template with `:params`, e.g. `'/users/:id'`. */
  path: string;
  contract?: RouteContract;
}
