import { describe, it, expect } from 'vitest';
import { encodePath } from '../src/utils/encode-path.js';

describe('encodePath', () => {
  it('should encode path traversal characters', () => {
    const result = encodePath('../../etc/passwd');
    expect(result).toBe('..%2F..%2Fetc%2Fpasswd');
    // Must not contain unencoded slashes
    expect(result).not.toContain('/');
  });

  it('should handle normal container IDs unchanged', () => {
    expect(encodePath('abc123')).toBe('abc123');
  });

  it('should handle SHA-like container IDs', () => {
    const sha = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    expect(encodePath(sha)).toBe(sha);
  });

  it('should encode spaces', () => {
    expect(encodePath('my container')).toBe('my%20container');
  });

  it('should handle numbers', () => {
    expect(encodePath(42)).toBe('42');
  });

  it('should handle zero', () => {
    expect(encodePath(0)).toBe('0');
  });

  it('should encode special URL characters', () => {
    expect(encodePath('name?query=1')).toContain('%3F');
    expect(encodePath('name#fragment')).toContain('%23');
    expect(encodePath('name&other')).toContain('%26');
  });

  it('should encode percent signs to prevent double-encoding attacks', () => {
    expect(encodePath('%2F')).toBe('%252F');
  });

  it('should handle empty string', () => {
    expect(encodePath('')).toBe('');
  });
});
