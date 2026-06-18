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

  // AsyncIterable streaming handler (no @Sse, but async-generator-style stream).
  @Sse('async')
  async *asyncTicks(): AsyncIterable<Tick> {
    yield {} as any;
  }
}
