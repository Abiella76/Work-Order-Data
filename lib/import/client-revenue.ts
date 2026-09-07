import Papa from 'papaparse';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../../db/client';
import { parseMoney, centsToNumeric } from '../kpi/money';
import type { ClientStatus, Period } from '../kpi/corporate';

/**
 * Import of the finance report's client revenue.
 *
 * Expects the long form — one row per (client, period) — because the source
 * report puts active and inactive accounts in separate tables with different
 * columns, and a long form flattens that without inventing cells:
 *
 *   Client,Period,Amount,Status
 *   Acme Facilities,FY2024,"$120,000.00",Inactive
 *   Acme Facilities,FY2025,—,Inactive
 *
 * An em dash or blank amount means the account had no activity in that period.
 * It is skipped rather than stored as 0 — the source distinguishes the two, and
 * an explicit $0.00 does get stored.
 */

export interface ClientRevenueRow {
  client: string;
  period: string;
  amount: number | null;
  status: ClientStatus;
}

export interface ParsedClientRevenue {
  rows: ClientRevenueRow[];
  issues: string[];
  clients: number;
  periods: string[];
}

export function parseClientRevenueCsv(text: string, knownPeriods: readonly string[]): ParsedClientRevenue {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
  });

  const rows: ClientRevenueRow[] = [];
  const issues: string[] = [];
  const names = new Set<string>();
  const periods = new Set<string>();

  parsed.data.forEach((raw, i) => {
    const client = (raw['Client'] ?? '').trim();
    const period = (raw['Period'] ?? '').trim();
    const statusRaw = (raw['Status'] ?? '').trim().toLowerCase();

    if (client === '') return;
    if (!knownPeriods.includes(period)) {
      issues.push(`Row ${i + 1}: unknown period ${JSON.stringify(period)} — row skipped.`);
      return;
    }
    if (statusRaw !== 'active' && statusRaw !== 'inactive') {
      issues.push(`Row ${i + 1}: unrecognised status ${JSON.stringify(statusRaw)} for ${client}.`);
      return;
    }

    names.add(client);
    periods.add(period);
    rows.push({
      client,
      period,
      // null here means "no activity", and is deliberately not stored.
      amount: parseMoney(raw['Amount']),
      status: statusRaw,
    });
  });

  return { rows, issues, clients: names.size, periods: [...periods] };
}

/** Replace the stored client revenue with this file's contents, in one transaction. */
export async function importClientRevenue(input: {
  content: string;
  periods: readonly Period[];
}): Promise<{ clients: number; amounts: number; issues: string[] }> {
  const db = getDb();
  const keys = input.periods.map((p) => p.key);
  const parsed = parseClientRevenueCsv(input.content, keys);

  return db.transaction(async (tx) => {
    for (const period of input.periods) {
      await tx
        .insert(schema.revenuePeriods)
        .values({
          key: period.key,
          label: period.label,
          startsOn: period.startsOn,
          endsOn: period.endsOn,
          isPartial: String(period.isPartial),
          sourceTotal: centsToNumeric(period.sourceTotal),
          sortOrder: period.sortOrder,
        })
        .onConflictDoUpdate({
          target: schema.revenuePeriods.key,
          set: {
            label: period.label,
            sourceTotal: centsToNumeric(period.sourceTotal),
            isPartial: String(period.isPartial),
          },
        });
    }

    const periodIds = new Map<string, number>();
    for (const row of await tx.select().from(schema.revenuePeriods)) {
      periodIds.set(row.key, row.id);
    }

    // The finance report is a full restatement each time it is produced, so the
    // client figures are replaced wholesale rather than merged. Reports and
    // work-order events are untouched — they are a different, append-only source.
    await tx.delete(schema.clientPeriodRevenue);
    await tx.delete(schema.clientAccounts);

    const clientIds = new Map<string, number>();
    let amounts = 0;

    for (const row of parsed.rows) {
      let clientId = clientIds.get(row.client);
      if (clientId === undefined) {
        const [inserted] = await tx
          .insert(schema.clientAccounts)
          .values({ name: row.client, status: row.status })
          .onConflictDoUpdate({
            target: schema.clientAccounts.name,
            set: { status: row.status },
          })
          .returning({ id: schema.clientAccounts.id });
        clientId = inserted.id;
        clientIds.set(row.client, clientId);
      }

      if (row.amount === null) continue;
      await tx
        .insert(schema.clientPeriodRevenue)
        .values({
          clientId,
          periodId: periodIds.get(row.period)!,
          amount: centsToNumeric(row.amount)!,
        })
        .onConflictDoUpdate({
          target: [schema.clientPeriodRevenue.clientId, schema.clientPeriodRevenue.periodId],
          set: { amount: centsToNumeric(row.amount)! },
        });
      amounts += 1;
    }

    return { clients: clientIds.size, amounts, issues: parsed.issues };
  });
}

/** Look up a client id by exact name — used when recording an alias decision. */
export async function findClientByName(name: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.clientAccounts)
    .where(eq(schema.clientAccounts.name, name))
    .limit(1);
  return row ?? null;
}
