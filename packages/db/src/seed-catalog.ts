import { closePool } from './client';

/**
 * Invented opportunity catalogs are not loaded.
 * Rows enter the database only through live observation.
 */
export async function runCatalogSeed(): Promise<void> {
  console.error(
    '[catalog-seed] Refusing to insert invented opportunities, scores, or SERP rows. Observe a live query instead.'
  );
  process.exitCode = 1;
}

if (process.argv[1]?.endsWith('seed-catalog.ts')) {
  runCatalogSeed()
    .finally(() => closePool())
    .then(() => process.exit(process.exitCode ?? 1));
}
