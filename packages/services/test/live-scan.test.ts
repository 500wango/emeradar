import { describe, it } from 'node:test';
import assert from 'node:assert';
import { LiveScanService, SCREENER_LONGTAIL_LIMIT } from '../src/live-scan.service';

describe('LiveScanService Tests', () => {
  it('should scan a new keyword live, generate D-M-W scores, and persist to database', async () => {
    const testQuery = `invoice generator online ${Date.now()}`;
    const result = await LiveScanService.scan({
      query: testQuery,
      marketCountry: 'US',
    });

    assert.ok(result.opportunityId.startsWith('opp_'));
    assert.ok(result.slug.length > 0);
    assert.strictEqual(result.dBasisPoints, 0);
    assert.strictEqual(result.mBasisPoints, 0);
    assert.strictEqual(result.wBasisPoints, 0);
    assert.strictEqual(result.dBand, 'INSUFFICIENT');
    assert.strictEqual(result.confidence, 'LOW');
    assert.strictEqual(result.verdict, 'WATCH');
    assert.strictEqual(result.isNew, true);

    // Second call with same keyword should return existing record (isNew: false)
    const secondResult = await LiveScanService.scan({
      query: testQuery,
    });
    assert.strictEqual(secondResult.opportunityId, result.opportunityId);
    assert.strictEqual(secondResult.isNew, false);

    // T3.4: the repeat scan reads the long-tail words from opportunity_queries,
    // the same source reports and launch kits use, so both scans agree.
    assert.deepStrictEqual(
      [...secondResult.suggestions].sort(),
      [...result.suggestions].sort(),
      'repeat scan returned a different word list than the one stored'
    );
    assert.ok(result.suggestions.length <= SCREENER_LONGTAIL_LIMIT);
  });
});
