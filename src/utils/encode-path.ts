/**
 * Encode a path parameter for safe use in URL paths.
 * Prevents path injection by ensuring special characters are percent-encoded.
 */
export const encodePath = (id: string | number): string => encodeURIComponent(String(id));
