import { describe, it, expect } from 'vitest';
import { scheduledAtFor, clampPagination } from './emails.js';

describe('scheduledAtFor', () => {
  const start = new Date('2026-01-01T00:00:00.000Z');

  it('first recipient (seq 0) fires exactly at start', () => {
    expect(scheduledAtFor(start, 0, 2000).toISOString()).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('spaces each recipient by delayMs', () => {
    expect(scheduledAtFor(start, 1, 2000).toISOString()).toBe(
      '2026-01-01T00:00:02.000Z',
    );
    expect(scheduledAtFor(start, 4, 2000).toISOString()).toBe(
      '2026-01-01T00:00:08.000Z',
    );
  });

  it('zero delay keeps everyone at start', () => {
    expect(scheduledAtFor(start, 3, 0).getTime()).toBe(start.getTime());
  });
});

describe('clampPagination', () => {
  it('defaults to page 1, pageSize 20', () => {
    expect(clampPagination({})).toEqual({
      page: 1,
      pageSize: 20,
      offset: 0,
      limit: 20,
    });
  });

  it('computes offset from page and pageSize', () => {
    expect(clampPagination({ page: 3, pageSize: 10 })).toMatchObject({
      offset: 20,
      limit: 10,
    });
  });

  it('floors page and size to at least 1', () => {
    expect(clampPagination({ page: 0, pageSize: 0 })).toMatchObject({
      page: 1,
      pageSize: 1,
    });
    expect(clampPagination({ page: -5, pageSize: -5 })).toMatchObject({
      page: 1,
      pageSize: 1,
    });
  });

  it('caps pageSize at 100', () => {
    expect(clampPagination({ pageSize: 5000 }).pageSize).toBe(100);
  });

  it('normalizes NaN to defaults', () => {
    expect(clampPagination({ page: NaN, pageSize: NaN })).toMatchObject({
      page: 1,
      pageSize: 20,
    });
  });
});
