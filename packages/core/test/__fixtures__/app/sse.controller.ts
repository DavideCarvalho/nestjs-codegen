import { Controller, Sse } from '@nestjs/common';
import type { Observable } from 'rxjs';

export interface Tick {
  count: number;
  at: string;
}

class MessageEvent<T> {
  data!: T;
}

@Controller('/api/events')
export class SseController {
  // @Sse() returning Observable<MessageEvent<Tick>> — the streamed element is Tick.
  @Sse('ticks')
  ticks(): Observable<MessageEvent<Tick>> {
    return {} as any;
  }

  // @Sse() returning a bare Observable<Tick> — element is Tick.
  @Sse('raw')
  raw(): Observable<Tick> {
    return {} as any;
  }

  // @Sse() returning an inline object-literal element `{ data: Tick }` — the member type must be
  // resolved (expanded inline), not emitted as a bare `Tick` that would be undefined in the output.
  @Sse('wrapped')
  wrapped(): Observable<{ data: Tick }> {
    return {} as any;
  }

  // AsyncIterable streaming handler (no @Sse, but async-generator-style stream).
  @Sse('async')
  async *asyncTicks(): AsyncIterable<Tick> {
    yield {} as any;
  }
}
