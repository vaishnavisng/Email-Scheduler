import { describe, it, expect } from 'vitest';
import { parseLeads } from './parse-leads';

describe('parseLeads', () => {
  it('extracts across mixed delimiters (comma, semicolon, tab, space)', () => {
    const text = 'a@x.com,b@x.com;c@x.com\td@x.com e@x.com';
    expect(parseLeads(text).valid).toEqual([
      'a@x.com',
      'b@x.com',
      'c@x.com',
      'd@x.com',
      'e@x.com',
    ]);
  });

  it('ignores a header row', () => {
    const text = 'email,name\nalice@x.com,Alice\nbob@x.com,Bob';
    const r = parseLeads(text);
    expect(r.valid).toEqual(['alice@x.com', 'bob@x.com']);
    expect(r.invalid).toEqual([]);
  });

  it('dedupes case-insensitively and counts duplicates', () => {
    const r = parseLeads('a@x.com\nA@X.com\na@x.com\nb@x.com');
    expect(r.valid).toEqual(['a@x.com', 'b@x.com']);
    expect(r.duplicates).toBe(2);
  });

  it('flags invalid addresses without dropping valid ones', () => {
    const r = parseLeads('good@x.com\nnope@\n@nope.com\nno-at-sign\nok@y.com');
    expect(r.valid).toEqual(['good@x.com', 'ok@y.com']);
    expect(r.invalid).toEqual(['nope@', '@nope.com']);
  });

  it('handles CRLF line endings', () => {
    const r = parseLeads('a@x.com\r\nb@x.com\r\n');
    expect(r.valid).toEqual(['a@x.com', 'b@x.com']);
  });
});
