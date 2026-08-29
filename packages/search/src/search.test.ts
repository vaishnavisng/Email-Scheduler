import { describe, it, expect } from 'vitest';
import { buildSearchBody } from './index.js';

/** The one invariant that must never regress: search is always user-scoped. */
describe('buildSearchBody', () => {
  const base = { userId: 'u1', page: 1, pageSize: 20 };

  it('always filters by the caller user_id', () => {
    for (const extra of [{}, { q: 'hi' }, { status: 'sent' as const }]) {
      const body = buildSearchBody({ ...base, ...extra });
      const filter = (body.query.bool as { filter: unknown[] }).filter;
      expect(filter).toContainEqual({ term: { user_id: 'u1' } });
    }
  });

  it('uses match_all when q is absent, multi_match when present', () => {
    const noQ = buildSearchBody(base).query.bool as { must: unknown[] };
    expect(noQ.must).toEqual([{ match_all: {} }]);

    const withQ = buildSearchBody({ ...base, q: 'invoice' }).query.bool as {
      must: [{ multi_match: { query: string; fields: string[] } }];
    };
    expect(withQ.must[0].multi_match.query).toBe('invoice');
    expect(withQ.must[0].multi_match.fields).toContain('recipient.text');
  });

  it('adds status and date-range filters only when provided', () => {
    const filter = (
      buildSearchBody({ ...base, status: 'failed', from: '2026-01-01', to: '2026-02-01' })
        .query.bool as { filter: Record<string, unknown>[] }
    ).filter;
    expect(filter).toContainEqual({ term: { status: 'failed' } });
    expect(filter).toContainEqual({
      range: { scheduled_at: { gte: '2026-01-01', lte: '2026-02-01' } },
    });
  });

  it('paginates via from/size', () => {
    const body = buildSearchBody({ ...base, page: 3, pageSize: 25 });
    expect(body.from).toBe(50);
    expect(body.size).toBe(25);
  });
});
