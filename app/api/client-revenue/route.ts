import { NextResponse } from 'next/server';
import Papa from 'papaparse';
import { isDatabaseConfigured } from '@/db/client';
import { parseClientRevenueCsv, importClientRevenue } from '@/lib/import/client-revenue';
import { parseMoney, formatMoney } from '@/lib/kpi/money';
import type { Period } from '@/lib/kpi/corporate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PeriodInput {
  key: string;
  label?: string;
  startsOn?: string;
  endsOn?: string;
  isPartial?: boolean;
  sourceTotal?: string | null;
  sortOrder?: number;
}

/**
 * Period keys present in the file, in first-seen order.
 *
 * Parsed properly rather than split by hand: amounts are quoted and contain
 * thousands separators, so counting commas turns "$1,032,437.05" into three
 * cells and invents periods out of the fragments.
 */
function detectPeriods(content: string): string[] {
  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: 'greedy',
  });
  const seen: string[] = [];
  for (const row of parsed.data) {
    const key = (row['Period'] ?? '').trim();
    if (key && !seen.includes(key)) seen.push(key);
  }
  return seen;
}

/**
 * A period's dates, guessed where the key states them unambiguously.
 *
 * `FY2024` is a full calendar year and needs no input. Anything else is left
 * blank for someone to fill in: a partial statement's boundaries are not
 * recoverable from its name, and guessing them would silently mis-scale the
 * annualised figure.
 */
function inferDates(key: string): { startsOn: string; endsOn: string } | null {
  const fy = key.match(/^FY(\d{4})$/i);
  if (fy) return { startsOn: `${fy[1]}-01-01`, endsOn: `${fy[1]}-12-31` };
  return null;
}

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'DATABASE_URL is not set.' }, { status: 503 });
  }

  let body: { content?: unknown; periods?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const content = typeof body.content === 'string' ? body.content : null;
  if (!content) return NextResponse.json({ error: 'No CSV content.' }, { status: 400 });

  const detected = detectPeriods(content);
  const isDryRun = new URL(request.url).searchParams.get('dryRun') === '1';

  if (isDryRun) {
    const parsed = parseClientRevenueCsv(content, detected);
    const counts = detected.map((key) => ({
      key,
      label: key,
      ...(inferDates(key) ?? { startsOn: '', endsOn: '' }),
      rows: parsed.rows.filter((r) => r.period === key).length,
      withAmount: parsed.rows.filter((r) => r.period === key && r.amount !== null).length,
    }));
    return NextResponse.json({
      clients: parsed.clients,
      rows: parsed.rows.length,
      periods: counts,
      issues: parsed.issues,
      preview: parsed.rows.slice(0, 8).map((r) => ({
        client: r.client,
        period: r.period,
        status: r.status,
        amount: r.amount === null ? null : formatMoney(r.amount),
      })),
    });
  }

  const inputs = Array.isArray(body.periods) ? (body.periods as PeriodInput[]) : [];
  if (inputs.length === 0) {
    return NextResponse.json({ error: 'No period definitions supplied.' }, { status: 400 });
  }

  const periods: Period[] = [];
  for (const [i, p] of inputs.entries()) {
    const dates = inferDates(p.key);
    const startsOn = p.startsOn || dates?.startsOn;
    const endsOn = p.endsOn || dates?.endsOn;
    if (!startsOn || !endsOn) {
      return NextResponse.json(
        { error: `Period "${p.key}" needs a start and end date.` },
        { status: 400 },
      );
    }
    periods.push({
      key: p.key,
      label: p.label?.trim() || p.key,
      startsOn,
      endsOn,
      isPartial: Boolean(p.isPartial),
      sourceTotal: p.sourceTotal ? parseMoney(p.sourceTotal) : null,
      sortOrder: p.sortOrder ?? i + 1,
    });
  }

  try {
    const result = await importClientRevenue({ content, periods });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Import failed.' },
      { status: 400 },
    );
  }
}
