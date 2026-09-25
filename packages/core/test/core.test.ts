import { describe, it, expect } from 'vitest';
import {
  Verdict,
  Lifecycle,
  Band,
  EvidenceClass,
  BuildArchetype,
  EmeradarError,
  ErrorCode,
} from '../src';

describe('@emeradar/core invariants', () => {
  it('should define all 5 canonical verdicts per PRD §4', () => {
    expect(Verdict.BUILD_NOW).toBe('BUILD_NOW');
    expect(Verdict.EARLY_BET).toBe('EARLY_BET');
    expect(Verdict.WINDOW_CLOSING).toBe('WINDOW_CLOSING');
    expect(Verdict.WATCH).toBe('WATCH');
    expect(Verdict.PASS).toBe('PASS');
  });

  it('should define 5 lifecycle states per 02 §5', () => {
    expect(Lifecycle.FORMING).toBe('FORMING');
    expect(Lifecycle.EARLY_WINDOW).toBe('EARLY_WINDOW');
    expect(Lifecycle.CONTESTED).toBe('CONTESTED');
    expect(Lifecycle.MATURE).toBe('MATURE');
    expect(Lifecycle.DEAD).toBe('DEAD');
  });

  it('should define EvidenceClass per 01 §3', () => {
    expect(EvidenceClass.OBSERVED).toBe('OBSERVED');
    expect(EvidenceClass.SELF_REPORTED).toBe('SELF_REPORTED');
    expect(EvidenceClass.THIRD_PARTY_ESTIMATE).toBe('THIRD_PARTY_ESTIMATE');
    expect(EvidenceClass.INFERRED).toBe('INFERRED');
  });

  it('should instantiate RFC 9457 compliant EmeradarError', () => {
    const err = new EmeradarError(
      ErrorCode.RATE_LIMITED,
      'Rate limit reached',
      429,
      { upgradeUrl: 'https://emeradar.com/pricing' }
    );
    expect(err.code).toBe(ErrorCode.RATE_LIMITED);
    expect(err.status).toBe(429);
    expect(err.detail).toBe('Rate limit reached');
    expect(err.upgrade?.url).toBe('https://emeradar.com/pricing');
  });
});
