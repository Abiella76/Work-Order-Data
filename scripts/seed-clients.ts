/**
 * Import the finance report's client revenue.
 *
 *   npm run seed:clients -- ./client-revenue.csv ./client-periods.json
 *
 * The CSV is the long form: Client,Period,Amount,Status — one row per account
 * per period. An em dash or blank amount means no activity in that period and
 * is not stored; an explicit $0.00 is stored, because the source treats those
 * as different facts.
 *
 * Period definitions live in a JSON file rather than in this script. They carry
 * meaning the CSV does not — where each period starts and ends, whether it is a
 * partial period, and the report's own stated total to reconcile against — and
 * those totals are the company's actual revenue, which does not belong in a
 * public repository. See client-periods.example.json for the shape; the real
 * file is gitignored alongside the CSV.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { importClientRevenue } from '../lib/import/client-revenue';
import { parseMoney, formatMoney } from '../lib/kpi/money';
import type { Period } from '../lib/kpi/corporate';

interface PeriodConfig {
  key: string;
  label: string;
  startsOn: string;
  endsOn: string;
  isPartial?: boolean;
  /** The source report's stated total, as a number or a money string. */
  sourceTotal?: string | number | null;
  sortOrder: number;
}

function loadPeriods(path: string): Period[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as PeriodConfig[];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`${path} must be a non-empty array of period definitions.`);
  }
  return raw.map((p) => {
    for (const field of ['key', 'label', 'startsOn', 'endsOn'] as const) {
      if (!p[field]) throw new Error(`Period ${p.key ?? '(unnamed)'} is missing "${field}".`);
    }
    return {
      key: p.key,
      label: p.label,
      startsOn: p.startsOn,
      endsOn: p.endsOn,
      isPartial: Boolean(p.isPartial),
      sourceTotal: p.sourceTotal == null ? null : parseMoney(String(p.sourceTotal)),
      sortOrder: p.sortOrder,
    };
  });
}

async function main() {
  const csvPath = resolve(process.argv[2] ?? './client-revenue.csv');
  const periodsPath = resolve(process.argv[3] ?? './client-periods.json');

  for (const [label, path] of [
    ['CSV', csvPath],
    ['period definitions', periodsPath],
  ] as const) {
    if (!existsSync(path)) {
      console.error(`No ${label} at: ${path}`);
      console.error('Usage: npm run seed:clients -- ./client-revenue.csv ./client-periods.json');
      if (label === 'period definitions') {
        console.error('Copy client-periods.example.json and fill in your own periods.');
      }
      process.exit(1);
    }
  }

  const periods = loadPeriods(periodsPath);
  const result = await importClientRevenue({
    content: readFileSync(csvPath, 'utf8'),
    periods,
  });

  console.log(`  ${result.clients} accounts, ${result.amounts} period amounts stored.`);
  for (const period of periods) {
    const stated = period.sourceTotal == null ? '—' : formatMoney(period.sourceTotal);
    console.log(
      `  ${period.label.padEnd(22)} stated total ${stated.padStart(15)}` +
        (period.isPartial ? '  (partial period)' : ''),
    );
  }
  if (result.issues.length > 0) {
    console.log(`\n  ${result.issues.length} validation notes:`);
    for (const issue of result.issues.slice(0, 10)) console.log(`    ${issue}`);
  }
  process.exit(0);
}

void main();
