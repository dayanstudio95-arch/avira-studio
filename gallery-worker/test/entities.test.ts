// HTML character codes from other sites' pages (P72): one pass, emoji whole, only real characters.
import { describe, expect, it } from 'vitest';
import { decodeEntities } from '../shared/entities';

describe('decodeEntities', () => {
  it('keeps emoji whole (decimal and hex)', () => {
    expect(decodeEntities('&#128512; &#x1F60D;')).toBe('😀 😍');
  });
  it('named codes people write in reviews', () => {
    expect(decodeEntities('מושלם&nbsp;&hellip; 10&ndash;12 &rsquo;x&lsquo; &quot;a&quot; &lt;b&gt; &apos;')).toBe('מושלם … 10–12 ’x‘ "a" <b> \'');
    expect(decodeEntities('&#x5D0;&#1489;')).toBe('אב');
  });
  it('decodes once: "&amp;lt;" is the text "&lt;"', () => {
    expect(decodeEntities('&amp;lt;b&amp;gt; &amp;#39;')).toBe('&lt;b&gt; &#39;');
  });
  it('leaves codes out of range, surrogate halves and unknown names as written', () => {
    expect(decodeEntities('&#0; &#xD83D; &#1114112; &bogus; & alone')).toBe('&#0; &#xD83D; &#1114112; &bogus; & alone');
  });
});
