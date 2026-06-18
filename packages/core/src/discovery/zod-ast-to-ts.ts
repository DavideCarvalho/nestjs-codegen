import { Node, SyntaxKind } from 'ts-morph';

/**
 * Convert a ts-morph Node (expression) representing a Zod schema call to a
 * TypeScript type-source string.  Falls back to `'unknown'` for anything
 * unrecognised.
 */
export function zodAstToTs(node: Node): string {
  // We only handle call expressions (e.g. z.string(), z.object({…}).optional())
  if (!Node.isCallExpression(node)) return 'unknown';

  const expr = node.getExpression();

  // ── Chained calls: z.xxx().optional() / .nullable() ──────────────────────
  if (Node.isPropertyAccessExpression(expr)) {
    const methodName = expr.getName();
    const receiver = expr.getExpression();

    if (methodName === 'optional') {
      return `${zodAstToTs(receiver)} | undefined`;
    }
    if (methodName === 'nullable') {
      return `${zodAstToTs(receiver)} | null`;
    }

    // ── z.<method>(…) top-level calls ────────────────────────────────────────
    const args = node.getArguments();

    switch (methodName) {
      case 'string':
        return 'string';
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'unknown':
        return 'unknown';
      case 'any':
        return 'unknown';

      case 'literal': {
        const lit = args[0];
        if (!lit) return 'unknown';
        if (Node.isStringLiteral(lit)) return JSON.stringify(lit.getLiteralValue());
        if (Node.isNumericLiteral(lit)) return lit.getLiteralValue().toString();
        if (lit.getKind() === SyntaxKind.TrueKeyword) return 'true';
        if (lit.getKind() === SyntaxKind.FalseKeyword) return 'false';
        return 'unknown';
      }

      case 'enum': {
        // z.enum(["a","b","c"])
        const arrArg = args[0];
        if (!arrArg || !Node.isArrayLiteralExpression(arrArg)) return 'unknown';
        const members = arrArg
          .getElements()
          .map((el) =>
            Node.isStringLiteral(el) ? JSON.stringify(el.getLiteralValue()) : 'unknown',
          );
        return members.join(' | ');
      }

      case 'array': {
        const inner = args[0];
        if (!inner) return 'unknown';
        return `Array<${zodAstToTs(inner)}>`;
      }

      case 'object': {
        const objArg = args[0];
        if (!objArg || !Node.isObjectLiteralExpression(objArg)) return 'unknown';
        const lines: string[] = [];
        for (const prop of objArg.getProperties()) {
          if (!Node.isPropertyAssignment(prop)) continue;
          const key = prop.getName();
          const valNode = prop.getInitializer();
          if (!valNode) continue;
          const tsType = zodAstToTs(valNode);
          // Mark optional if the value is .optional()
          const isOpt = isOptionalChain(valNode);
          lines.push(`${key}${isOpt ? '?' : ''}: ${tsType}`);
        }
        return `{ ${lines.join('; ')} }`;
      }

      case 'union': {
        const arrArg = args[0];
        if (!arrArg || !Node.isArrayLiteralExpression(arrArg)) return 'unknown';
        return arrArg.getElements().map(zodAstToTs).join(' | ');
      }

      case 'record': {
        // z.record(V) or z.record(K, V) — always emit Record<string, V>
        const valArg = args.length === 1 ? args[0] : args[1];
        if (!valArg) return 'unknown';
        return `Record<string, ${zodAstToTs(valArg)}>`;
      }

      case 'tuple': {
        const arrArg = args[0];
        if (!arrArg || !Node.isArrayLiteralExpression(arrArg)) return 'unknown';
        return `[${arrArg.getElements().map(zodAstToTs).join(', ')}]`;
      }

      default:
        return 'unknown';
    }
  }

  return 'unknown';
}

/** Return true when `node` is a CallExpression ending in `.optional()`. */
function isOptionalChain(node: Node): boolean {
  if (!Node.isCallExpression(node)) return false;
  const expr = node.getExpression();
  return Node.isPropertyAccessExpression(expr) && expr.getName() === 'optional';
}

/**
 * Parse a defineContract({...}) call expression.
 * Returns { query, body, response } or null if unrecognised.
 */
export interface ParsedContractDef {
  query: string | null;
  body: string | null;
  response: string;
  /** Error response body type, from a `defineContract({ error })` zod schema. Null when absent. */
  error: string | null;
  /** Raw zod source text of the body initializer (for inline forms emit). */
  bodyZodText: string | null;
  /** Raw zod source text of the query initializer (for inline forms emit). */
  queryZodText: string | null;
}

export function parseDefineContractCall(callExpr: Node): ParsedContractDef | null {
  if (!Node.isCallExpression(callExpr)) return null;

  const callee = callExpr.getExpression();
  // Accept both `defineContract(...)` and any identifier named defineContract
  const calleeName = Node.isIdentifier(callee)
    ? callee.getText()
    : Node.isPropertyAccessExpression(callee)
      ? callee.getName()
      : '';

  if (calleeName !== 'defineContract') return null;

  const args = callExpr.getArguments();
  const optsArg = args[0];
  if (!optsArg || !Node.isObjectLiteralExpression(optsArg)) return null;

  let query: string | null = null;
  let body: string | null = null;
  let response = 'unknown';
  let error: string | null = null;
  let bodyZodText: string | null = null;
  let queryZodText: string | null = null;

  for (const prop of optsArg.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue;
    const propName = prop.getName();
    const val = prop.getInitializer();
    if (!val) continue;

    if (propName === 'query') {
      query = zodAstToTs(val);
      queryZodText = val.getText();
    } else if (propName === 'body') {
      body = zodAstToTs(val);
      bodyZodText = val.getText();
    } else if (propName === 'response') {
      response = zodAstToTs(val);
    } else if (propName === 'error') {
      error = zodAstToTs(val);
    }
  }

  return { query, body, response, error, bodyZodText, queryZodText };
}
