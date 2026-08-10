/**
 * Introspects Zod "raw shape" objects -- the third argument passed to
 * `registerTool(server, name, description, schema, callback)` (see
 * src/utils/tool-helper.ts) -- to derive the body-contract-relevant shape of an MCP
 * tool: which fields it accepts, which of those are required, and whether it uses an
 * untyped passthrough (`z.record(...)`) anywhere.
 *
 * Framework-agnostic on purpose: no import of `zod`, TypeScript source, or the MCP SDK --
 * only the duck-typed Zod v4 runtime introspection surface (`.isOptional()`, `.def.type`)
 * is used. That lets this file run under plain `node` as well as vitest, independent of
 * how the caller obtained the shape (a literal object in a test, or captured at runtime
 * via a mock `server.tool(...)`, see createCapturingServer() below).
 *
 * This is the "sent" side of the body contract -- the counterpart to
 * scripts/lib/openapi-contract-source.mjs, which reads the "expected" side (required/
 * known fields per the generated openapi.json). Correlating the two is Task P1.4, not
 * this file.
 */

const RECORD_ZOD_TYPE = 'record';

/**
 * @param {unknown} zodType A single Zod schema value (e.g. z.string(), z.number().optional())
 * @returns {boolean}
 */
function isOptionalZodType(zodType) {
  if (!zodType || typeof zodType !== 'object') return false;
  return typeof zodType.isOptional === 'function' && zodType.isOptional() === true;
}

/**
 * @param {unknown} zodType
 * @returns {boolean} true if this exact field is an untyped `z.record(...)` passthrough
 */
function isRecordZodType(zodType) {
  if (!zodType || typeof zodType !== 'object') return false;
  const def = zodType.def ?? zodType._def;
  return def?.type === RECORD_ZOD_TYPE;
}

/**
 * Computes the body-shape summary for a single tool's raw Zod shape object.
 * @param {Record<string, unknown>} zodShape e.g. { name: z.string(), env: z.number().optional() }
 * @returns {{ sentFields: string[], requiredSent: string[], passthrough: boolean }}
 */
function computeBodyShape(zodShape) {
  if (!zodShape || typeof zodShape !== 'object') {
    throw new TypeError(
      'computeBodyShape() erwartet ein Zod-Shape-Objekt (Record<string, ZodTypeAny>), erhalten: ' +
        String(zodShape)
    );
  }

  const sentFields = Object.keys(zodShape);
  const requiredSent = sentFields.filter((key) => !isOptionalZodType(zodShape[key]));
  const passthrough = sentFields.some((key) => isRecordZodType(zodShape[key]));

  return { sentFields, requiredSent, passthrough };
}

/**
 * Creates a mock MCP server that captures each tool's raw Zod shape by name instead of
 * really registering it -- mirrors the fixture used in
 * tests/update-container-contract.test.ts / tests/stack-env-merge-behavior.test.ts.
 * Pass `server` to a real `registerXTools(server, client)` call; the resulting `shapes`
 * map is then usable with getToolBodyShape().
 * @returns {{ server: { tool: Function }, shapes: Map<string, Record<string, unknown>> }}
 */
function createCapturingServer() {
  const shapes = new Map();
  const server = {
    tool: (name, _description, schema) => {
      shapes.set(name, schema);
    },
  };
  return { server, shapes };
}

/**
 * Looks up a single tool's body shape by name from a previously captured registry (see
 * createCapturingServer()).
 * @param {string} toolName
 * @param {Map<string, Record<string, unknown>>} shapes
 * @returns {{ sentFields: string[], requiredSent: string[], passthrough: boolean }}
 */
function getToolBodyShape(toolName, shapes) {
  const shape = shapes.get(toolName);
  if (!shape) {
    const known = [...shapes.keys()].join(', ') || '(keine)';
    throw new Error(`Kein MCP-Tool namens '${toolName}' wurde registriert (bekannt: ${known})`);
  }
  return computeBodyShape(shape);
}

export { computeBodyShape, createCapturingServer, getToolBodyShape };
