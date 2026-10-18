import { AppError } from '@emeradar/core';
import { describe, it, expect } from 'vitest';
import { AppError } from '../src/errors';
import {
  adminSourceSchema,
  compareSchema,
  decisionSchema,
  gscSyncSchema,
  loginSchema,
  parseGscSyncInput,
  parseInput,
  preferencesSchema,
  projectCreateSchema,
  registerSchema,
} from '../src/validation';

/** Runs `fn` and returns the thrown AppError. */
function caught(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected the call to throw');
}

describe('parseInput', () => {
  it('returns the parsed value on success', () => {
    expect(parseInput(loginSchema, { email: 'a@b.co', password: 'secret' }).email).toBe('a@b.co');
  });

  it('normalises the email once, so callers never need to trim again', () => {
    const { email } = parseInput(loginSchema, { email: '  User@Example.COM  ', password: 'x' });
    expect(email).toBe('user@example.com');
  });

  it('throws a 400 that names every offending field', () => {
    const error = caught(() => parseInput(loginSchema, { email: 'not-an-email', password: '' }));
    expect(error.status).toBe(400);
    expect(error.message).toContain('Invalid request body');
    expect(error.message).toContain('email');
    expect(error.message).toContain('password');
  });

  it('rejects a body that is not an object', () => {
    expect(caught(() => parseInput(loginSchema, 'nope')).status).toBe(400);
    expect(caught(() => parseInput(loginSchema, null)).status).toBe(400);
  });
});

describe('registerSchema', () => {
  it('enforces the minimum password length', () => {
    expect(caught(() => parseInput(registerSchema, { email: 'a@b.co', password: 'short' })).status).toBe(400);
    expect(parseInput(registerSchema, { email: 'a@b.co', password: 'longenough' }).password).toBe('longenough');
  });
});

describe('projectCreateSchema', () => {
  it('accepts either anchor but always requires a title', () => {
    expect(parseInput(projectCreateSchema, { opportunityId: 'o1', title: 'T' }).title).toBe('T');
    expect(parseInput(projectCreateSchema, { experimentCardId: 'c1', title: 'T' }).experimentCardId).toBe('c1');
    expect(caught(() => parseInput(projectCreateSchema, { opportunityId: 'o1' })).status).toBe(400);
    // An unknown build type is a client bug, not something to store.
    expect(caught(() => parseInput(projectCreateSchema, { opportunityId: 'o1', title: 'T', buildType: 'NOPE' })).status).toBe(400);
  });
});

describe('decisionSchema', () => {
  it('requires the verdict being decided on and the decision itself', () => {
    const pass = parseInput(decisionSchema, {
      opportunityId: 'o1',
      verdictId: 'vdt_o1_2026-10-06',
      decision: 'PASS',
      reasons: ['DEMAND_TOO_THIN'],
    });
    expect(pass.reasons).toEqual(['DEMAND_TOO_THIN']);
    expect(pass.verdictId).toBe('vdt_o1_2026-10-06');

    // Reasons stay optional at the shape layer: "a PASS needs at least one" is a
    // service rule, not a shape rule.
    expect(
      parseInput(decisionSchema, { opportunityId: 'o1', verdictId: 'v1', decision: 'PASS' }).reasons
    ).toBeUndefined();

    // v3.1: GO is not accepted here at all. It spends a quota credit and creates
    // the project in one transaction, so it has its own endpoint; accepting GO on
    // this "record an opinion" endpoint would be a quota-free bypass (ADR-018).
    expect(
      caught(() => parseInput(decisionSchema, { opportunityId: 'o1', verdictId: 'v1', decision: 'GO' })).status
    ).toBe(400);

    expect(caught(() => parseInput(decisionSchema, { reasons: ['x'] })).status).toBe(400);
    // The regression that motivated making verdictId required: without it the
    // server picked "the latest verdict" itself and could cite a row the user
    // had never been shown.
    expect(
      caught(() => parseInput(decisionSchema, { opportunityId: 'o1', decision: 'PASS' })).status
    ).toBe(400);
    expect(caught(() => parseInput(decisionSchema, { opportunityId: 'o1', verdictId: 'v1' })).status).toBe(400);
    expect(
      caught(() =>
        parseInput(decisionSchema, { opportunityId: 'o1', verdictId: 'v1', decision: 'MAYBE' })
      ).status
    ).toBe(400);
  });
});

describe('compareSchema', () => {
  it('requires between two and three ids', () => {
    expect(parseInput(compareSchema, { ids: ['a', 'b'] }).ids).toHaveLength(2);
    expect(parseInput(compareSchema, { ids: ['a', 'b', 'c'] }).ids).toHaveLength(3);
    expect(caught(() => parseInput(compareSchema, { ids: ['a'] })).status).toBe(400);
    expect(caught(() => parseInput(compareSchema, { ids: ['a', 'b', 'c', 'd'] })).status).toBe(400);
  });
});

describe('adminSourceSchema', () => {
  it('requires the fields the chosen action needs', () => {
    expect(parseInput(adminSourceSchema, { action: 'toggle', sourceId: 's1', isActive: false }).action).toBe('toggle');
    expect(caught(() => parseInput(adminSourceSchema, { action: 'toggle', sourceId: 's1' })).status).toBe(400);
    expect(caught(() => parseInput(adminSourceSchema, { action: 'add', name: 'Feed' })).status).toBe(400);
    expect(caught(() => parseInput(adminSourceSchema, { action: 'delete' })).status).toBe(400);
  });

  it('only accepts http(s) feed URLs', () => {
    expect(parseInput(adminSourceSchema, { action: 'add', name: 'Feed', url: 'https://example.com/feed.xml' }).action).toBe('add');
    expect(parseInput(adminSourceSchema, { action: 'add', name: 'Feed', url: 'http://example.com/feed.xml' }).action).toBe('add');
    expect(caught(() => parseInput(adminSourceSchema, { action: 'add', name: 'Feed', url: 'file:///etc/passwd' })).status).toBe(400);
    expect(caught(() => parseInput(adminSourceSchema, { action: 'add', name: 'Feed', url: 'javascript:alert(1)' })).status).toBe(400);
  });
});

describe('preferencesSchema', () => {
  it('keeps omitted keys absent so a partial update stays partial', () => {
    const parsed = parseInput(preferencesSchema, { uiLocale: 'zh-CN' });
    expect(parsed.uiLocale).toBe('zh-CN');
    expect('topics' in parsed).toBe(false);
  });

  it('distinguishes an explicit clear from an omission', () => {
    expect(parseInput(preferencesSchema, { topics: [] }).topics).toEqual([]);
    expect(parseInput(preferencesSchema, { preferredTimeBudget: null }).preferredTimeBudget).toBeNull();
  });

  it('rejects an unknown locale', () => {
    expect(caught(() => parseInput(preferencesSchema, { uiLocale: 'fr-FR' })).status).toBe(400);
  });

  it('only accepts the time budgets the database constraint allows', () => {
    // The column is TEXT CHECK (WEEKEND | TWO_WEEKS | ONE_MONTH); a number here
    // would reach Postgres and fail as an opaque 500.
    for (const value of ['WEEKEND', 'TWO_WEEKS', 'ONE_MONTH'] as const) {
      expect(parseInput(preferencesSchema, { preferredTimeBudget: value }).preferredTimeBudget).toBe(value);
    }
    expect(caught(() => parseInput(preferencesSchema, { preferredTimeBudget: 5 })).status).toBe(400);
    expect(caught(() => parseInput(preferencesSchema, { preferredTimeBudget: '5' })).status).toBe(400);
  });
});

describe('gscSyncSchema', () => {
  it('tags a daily body and a weekly body', () => {
    const daily = parseGscSyncInput({
      rows: [{ date: '2026-09-07', page: '/a', query: 'q', impressions: 1, clicks: 0, position: 3.5 }],
    });
    expect(daily.kind).toBe('daily');

    const weekly = parseGscSyncInput({
      rows: [{ weekStartDate: '2026-09-07', impressions: '10', clicks: '1', averagePosition: '2.5' }],
    });
    expect(weekly.kind).toBe('weekly');
  });

  it('coerces numeric strings, which is what the GSC export sends', () => {
    const daily = parseGscSyncInput({
      rows: [{ date: '2026-09-07', impressions: '12', clicks: '3' }],
    });
    expect(daily.rows[0].impressions).toBe(12);
    expect(daily.rows[0].clicks).toBe(3);
  });

  it('rejects a mixed body instead of silently dropping rows', () => {
    expect(
      caught(() =>
        parseGscSyncInput({
          rows: [
            { date: '2026-09-07', impressions: 1, clicks: 0 },
            { weekStartDate: '2026-09-07', impressions: 1, clicks: 0 },
          ],
        })
      ).status
    ).toBe(400);
  });

  it('rejects an empty or negative row set', () => {
    expect(caught(() => parseGscSyncInput({ rows: [] })).status).toBe(400);
    expect(
      caught(() => parseGscSyncInput({ rows: [{ date: '2026-09-07', impressions: -1, clicks: 0 }] })).status
    ).toBe(400);
    expect(caught(() => parseGscSyncInput({ rows: 'nope' })).status).toBe(400);
  });
});
