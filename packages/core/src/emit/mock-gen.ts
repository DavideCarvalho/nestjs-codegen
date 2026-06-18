/**
 * Typed access to the dependency-free mock-data generator.
 *
 * The actual implementation lives as an embeddable source-text constant in
 * `mock-gen-runtime.ts` ({@link MOCK_GEN_RUNTIME}) — the SINGLE SOURCE OF TRUTH
 * that the emitter inlines verbatim into the generated `mocks.ts`. This module
 * evaluates that exact text once and re-exports the resulting `makeRng` /
 * `generateMock` with TypeScript types, so the functions exercised by the unit
 * tests are byte-for-byte the same code shipped in the generated mocks — drift is
 * impossible by construction.
 *
 * See `mock-gen-runtime.ts` for the design rationale (mulberry32 seed, no faker
 * dependency, shared JSON Schema with the OpenAPI export).
 */
import type { JsonSchema } from '../ir/schema-node-to-json-schema.js';
import { MOCK_GEN_RUNTIME } from './mock-gen-runtime.js';

/** A seeded pseudo-random generator. `next()` returns a float in [0, 1). */
export interface Rng {
  next(): number;
}

type MakeRng = (seed: number) => Rng;
type GenerateMock = (
  schema: JsonSchema,
  rng: Rng,
  defs?: Record<string, JsonSchema>,
  depth?: number,
) => unknown;

// Evaluate the embeddable runtime text once and pull the two entry points out.
// `new Function` keeps this self-contained (no eval-of-module-scope) and is the
// same code path the generated file runs inline.
const factory = new Function(`${MOCK_GEN_RUNTIME}\nreturn { makeRng, generateMock };`) as () => {
  makeRng: MakeRng;
  generateMock: GenerateMock;
};
const runtime = factory();

/** mulberry32 — a tiny, fast, seedable PRNG. */
export const makeRng: MakeRng = runtime.makeRng;

/**
 * Generate a mock value for a JSON Schema node.
 *
 * @param schema the JSON Schema node
 * @param rng    the seeded PRNG (advanced as values are produced)
 * @param defs   the `components/schemas` map for resolving `$ref` (and recursion)
 * @param depth  recursion guard — recursive `$ref`s stop producing children past
 *               a small depth so self-referential schemas terminate.
 */
export const generateMock: GenerateMock = runtime.generateMock;
