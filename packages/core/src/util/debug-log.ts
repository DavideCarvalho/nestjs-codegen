/**
 * Opt-in terminal logging for schema-translation advisories.
 *
 * Messages like "@X is not translatable to a client validation schema" or
 * "T is a recursive type" are always recorded in the `SchemaModule.warnings`
 * array and re-emitted as `// warning:` comments in the generated output, so the
 * durable record never depends on this. The terminal copy is pure noise on a
 * normal run, so it is printed only when codegen runs with `debug: true`.
 *
 * The flag is process-wide and set once per pass by {@link generate}; codegen
 * runs as a single CLI invocation or one watcher tick, so a module-level switch
 * is sufficient (and matches the pre-existing direct `console.warn` it replaces).
 */
let debugEnabled = false;

/** Set by `generate()` from the resolved `debug` config before each pass. */
export function setCodegenDebug(enabled: boolean): void {
  debugEnabled = enabled;
}

/** Emit a `[nestjs-codegen]` advisory to stderr only when debug is enabled. */
export function debugWarn(message: string): void {
  if (debugEnabled) console.warn(`[nestjs-codegen] ${message}`);
}
