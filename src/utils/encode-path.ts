/**
 * Encode a path parameter for safe use in URL paths.
 * Prevents path injection by ensuring special characters are percent-encoded.
 *
 * A segment that is exactly `.` or `..` is rejected: encodeURIComponent leaves dots
 * alone, and the WHATWG URL parser (used by DockhandClient.buildUrl) resolves dot
 * segments, so `/api/stacks/{name}/env/validate` with name `.` would be sent as
 * `/api/stacks/env/validate`, i.e. to a different endpoint than the tool maps to
 * (this would also sidestep MCP_READ_ONLY and MCP_TOOLS_DENY). Percent-encoded dots
 * (`%2e`) are also dot segments to the URL parser, so encoding them is no fix.
 */
export const encodePath = (id: string | number): string => {
  const encoded = encodeURIComponent(String(id));
  if (encoded === '.' || encoded === '..') {
    throw new Error(`Invalid path parameter: "${encoded}" is not allowed`);
  }
  return encoded;
};
