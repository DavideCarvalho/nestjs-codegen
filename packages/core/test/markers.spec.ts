import { describe, expect, it } from 'vitest';
import { AsQuery } from '../src/markers.js';

describe('markers: AsQuery', () => {
  it('is a no-op MethodDecorator that does not throw when applied', () => {
    class Test {
      @AsQuery()
      search() {
        return 'ok';
      }
    }
    expect(new Test().search()).toBe('ok');
  });

  it('returns a function without mutating the descriptor', () => {
    const decorator = AsQuery();
    const target = {};
    const descriptor: PropertyDescriptor = { value: () => 'x', writable: true, configurable: true };
    const result = decorator(target, 'search', descriptor);
    expect(result === undefined || result === descriptor).toBe(true);
  });
});
