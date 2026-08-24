/**
 * Import a directory of daily report CSVs.
 *
 *   npm run seed -- ./reports
 *
 * Files are read in filename order and each is imported exactly as an upload
 * would be, duplicate protection included — re-running the script is safe and
 * skips what is already stored.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { commitImport, DuplicateImportError } from '../lib/import/ingest';

async function main() {
  const dir = resolve(process.argv[2] ?? './reports');

  if (!existsSync(dir)) {
    console.error(`No such directory: ${dir}`);
    console.error('Usage: npm run seed -- ./path/to/reports');
    process.exit(1);
  }

  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.csv')).sort();
  if (files.length === 0) {
    console.error(`No CSV files in ${dir}`);
    process.exit(1);
  }

  let imported = 0;
  let skipped = 0;

  for (const filename of files) {
    const content = readFileSync(join(dir, filename), 'utf8');
    try {
      const result = await commitImport({ filename, content, source: 'manual_upload' });
      imported += 1;
      console.log(
        `  ${filename}  ${result.reportDate}  ${result.rowCount} rows  ${result.importStatus}` +
          (result.issues.length > 0 ? `  (${result.issues.length} validation notes)` : ''),
      );
    } catch (error) {
      if (error instanceof DuplicateImportError) {
        skipped += 1;
        console.log(`  ${filename}  skipped — ${error.message}`);
        continue;
      }
      console.error(`  ${filename}  FAILED — ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    }
  }

  console.log(`\n${imported} imported, ${skipped} skipped, ${files.length} files seen.`);
  process.exit(process.exitCode ?? 0);
}

void main();
