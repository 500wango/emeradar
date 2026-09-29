import { LiveScanService } from '../live-scan.service';
import { closePool } from '@emeradar/db';

async function main() {
  const queries = process.argv.slice(2).map((query) => query.trim()).filter((query) => query.length >= 2);
  if (queries.length === 0) {
    console.error('Pass one or more queries. This script does not ship an example list.');
    process.exitCode = 1;
    return;
  }

  for (const [index, query] of queries.entries()) {
    console.log(`[${index + 1}/${queries.length}] observing "${query}"`);
    try {
      const result = await LiveScanService.scan({
        query,
        marketCountry: 'US',
        language: 'en-US',
      });
      console.log(
        `  ${result.isNew ? 'stored' : 'already on file'} ${result.slug} verdict=${result.verdict} suggestions=${result.suggestions.length}`
      );
    } catch (error: any) {
      console.error(`  failed: ${error.message}`);
    }
  }
}

main()
  .then(() => closePool())
  .catch(async (error) => {
    console.error(error);
    await closePool();
    process.exit(1);
  });
