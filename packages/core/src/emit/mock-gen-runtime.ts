/**
 * The dependency-free mock-data generator runtime, as an embeddable source-text
 * constant.
 *
 * This is the SINGLE SOURCE OF TRUTH for the generator: the emitter inlines this
 * exact text into the generated `mocks.ts` (so the output is self-contained, with
 * no runtime dependency on this package), and `mock-gen.ts` evaluates this same
 * text to expose typed `makeRng`/`generateMock` to the unit tests. One string,
 * two consumers — the tested behavior and the emitted behavior can never drift.
 *
 * Why a string (vs a normal module read at runtime): the package is bundled by
 * tsup into a single `dist/index.js` and only `dist` is published, so reading a
 * sibling `.ts` source at runtime would fail once installed. A string constant is
 * bundled with the code and works everywhere.
 *
 * Design choice (vs Orval): Orval shells out to `@faker-js/faker`; we ship a tiny
 * `mulberry32`-seeded generator so there is NO faker dependency and output is
 * fully deterministic for a given seed (the tests rely on this). The generator
 * consumes the same JSON Schema that drives the OpenAPI export, so spec and mocks
 * can never disagree about a route's shape.
 */
export const MOCK_GEN_RUNTIME = `
/** mulberry32 — a tiny, fast, seedable PRNG. \`next()\` returns a float in [0, 1). */
function makeRng(seed) {
  let a = seed >>> 0;
  return {
    next() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

function __pick(rng, items) {
  return items[Math.floor(rng.next() * items.length)];
}

function __intBetween(rng, min, max) {
  return Math.floor(rng.next() * (max - min + 1)) + min;
}

const __WORDS = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'tempor'];
const __FIRST_NAMES = ['Ada', 'Alan', 'Grace', 'Linus', 'Margaret', 'Dennis'];
const __LAST_NAMES = ['Lovelace', 'Turing', 'Hopper', 'Torvalds', 'Hamilton', 'Ritchie'];

function __fakeWords(rng, count) {
  let out = [];
  for (let i = 0; i < count; i++) out.push(__pick(rng, __WORDS));
  return out.join(' ');
}

function __hex(rng, len) {
  let s = '';
  for (let i = 0; i < len; i++) s += Math.floor(rng.next() * 16).toString(16);
  return s;
}

function __fakeUuid(rng) {
  return __hex(rng, 8) + '-' + __hex(rng, 4) + '-4' + __hex(rng, 3) + '-' + __pick(rng, ['8', '9', 'a', 'b']) + __hex(rng, 3) + '-' + __hex(rng, 12);
}

function __fakeString(rng, schema) {
  switch (schema.format) {
    case 'email':
      return __pick(rng, __FIRST_NAMES).toLowerCase() + '.' + __pick(rng, __LAST_NAMES).toLowerCase() + '@example.com';
    case 'uri':
    case 'url':
      return 'https://example.com/' + __pick(rng, __WORDS);
    case 'uuid':
      return __fakeUuid(rng);
    case 'date-time':
      return new Date(Date.UTC(2020, __intBetween(rng, 0, 11), __intBetween(rng, 1, 28))).toISOString();
    default:
      return __fakeWords(rng, __intBetween(rng, 1, 3));
  }
}

/** Generate a mock value for a JSON Schema node (depth-capped recursion via $ref). */
function generateMock(schema, rng, defs, depth) {
  defs = defs || {};
  depth = depth || 0;
  if (schema.$ref) {
    const name = schema.$ref.replace('#/components/schemas/', '');
    const target = defs[name];
    if (!target || depth > 4) return null;
    return generateMock(target, rng, defs, depth + 1);
  }
  if ('const' in schema) return schema.const;
  if (schema.enum && schema.enum.length > 0) return __pick(rng, schema.enum);
  if (schema.oneOf && schema.oneOf.length > 0) return generateMock(__pick(rng, schema.oneOf), rng, defs, depth);
  if (schema.anyOf && schema.anyOf.length > 0) return generateMock(__pick(rng, schema.anyOf), rng, defs, depth);
  let type = Array.isArray(schema.type)
    ? (schema.type.filter((t) => t !== 'null')[0] || 'null')
    : schema.type;
  switch (type) {
    case 'string':
      return __fakeString(rng, schema);
    case 'integer':
      return __intBetween(rng, typeof schema.minimum === 'number' ? schema.minimum : 0, typeof schema.maximum === 'number' ? schema.maximum : 1000);
    case 'number':
      return __intBetween(rng, typeof schema.minimum === 'number' ? schema.minimum : 0, typeof schema.maximum === 'number' ? schema.maximum : 1000) + Math.round(rng.next() * 100) / 100;
    case 'boolean':
      return rng.next() < 0.5;
    case 'null':
      return null;
    case 'array': {
      const count = depth > 2 ? 0 : __intBetween(rng, 1, 2);
      const items = schema.items || {};
      let arr = [];
      for (let i = 0; i < count; i++) arr.push(generateMock(items, rng, defs, depth + 1));
      return arr;
    }
    case 'object': {
      const out = {};
      const props = schema.properties || {};
      for (const key of Object.keys(props)) out[key] = generateMock(props[key], rng, defs, depth + 1);
      return out;
    }
    default:
      return {};
  }
}
`.trim();
