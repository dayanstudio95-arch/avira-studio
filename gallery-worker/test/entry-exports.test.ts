// The Worker runtime (workerd) treats every named export of the entry module as a handler and refuses to start
// on anything else — a plain `export const` in worker/index.ts took the whole films site down in local e2e
// (2026-10-02). Keep the entry module to its default export only; shared constants live in their own modules.
import { describe, expect, it } from 'vitest';
import * as entry from '../worker/index';

describe('worker entry module', () => {
  it('exports only the default handler', () => {
    expect(Object.keys(entry)).toEqual(['default']);
  });
});
