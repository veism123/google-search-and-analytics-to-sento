import type { FeedConfig, Source, SourceItem } from "../types.js";
import { log } from "../log.js";

// Analytics observations via the Windsor.ai connector API, following the
// conventions the weekly-report skill fixed for these metrics: values are
// recorded VERBATIM as Windsor returns them, observed_at is 06:00 UTC the
// day after the observed period ends.
//
// Verified against live Windsor data 2026-09-01: daily rows come back as
// { date, <valueField> }; a fetch selecting only the value field over a
// date range returns ONE aggregated row, so weekly totals are returned by
// the source, never summed here.
//
// options:
//   connector    — Windsor connector id ("googleanalytics4", "searchconsole")
//   valueField   — the measure ("totalusers", "clicks")
//   granularity  — "daily" (one observation per complete day) or
//                  "weekly-iso" (one observation for the last completed
//                  ISO week, Monday through Sunday)
//   lookbackDays — daily only: how far back to consider (default 30);
//                  the high-water dedupe drops what is already recorded
interface WindsorOptions {
  connector?: string;
  valueField?: string;
  granularity?: "daily" | "weekly-iso";
  lookbackDays?: number;
}

const BASE = "https://connectors.windsor.ai";

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

// The most recent complete day, UTC: yesterday.
export function dailyWindow(now: Date, lookbackDays: number): { from: string; to: string } {
  const yesterday = addDays(now, -1);
  return { from: dateOnly(addDays(yesterday, -(lookbackDays - 1))), to: dateOnly(yesterday) };
}

// The last fully completed ISO week: Monday through the most recent Sunday
// strictly before today (UTC).
export function completedIsoWeek(now: Date): { from: string; to: string; observedAt: string } {
  const day = now.getUTCDay(); // 0 = Sunday
  const daysSinceSunday = day === 0 ? 7 : day;
  const sunday = addDays(now, -daysSinceSunday);
  const monday = addDays(sunday, -6);
  const mondayAfter = addDays(sunday, 1);
  return {
    from: dateOnly(monday),
    to: dateOnly(sunday),
    observedAt: `${dateOnly(mondayAfter)}T06:00:00Z`,
  };
}

async function fetchRows(
  apiKey: string,
  connector: string,
  fields: string[],
  from: string,
  to: string
): Promise<Array<Record<string, unknown>>> {
  const params = new URLSearchParams({
    api_key: apiKey,
    date_from: from,
    date_to: to,
    fields: fields.join(","),
  });
  const res = await fetch(`${BASE}/${connector}?${params}`);
  if (!res.ok) {
    throw new Error(`Windsor ${connector} returned ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { data?: unknown; result?: unknown };
  const rows = json.data ?? json.result;
  if (!Array.isArray(rows)) {
    throw new Error(`Windsor ${connector}: response held no data array`);
  }
  return rows as Array<Record<string, unknown>>;
}

export const windsorSource: Source = {
  async fetch(feed: FeedConfig, apiKey: string): Promise<SourceItem[]> {
    const opts = (feed.options ?? {}) as WindsorOptions;
    const { connector, valueField } = opts;
    if (!connector || !valueField) {
      throw new Error(`[${feed.name}] windsor feed needs options.connector and options.valueField`);
    }
    const now = new Date();

    if (opts.granularity === "weekly-iso") {
      const week = completedIsoWeek(now);
      const rows = await fetchRows(apiKey, connector, [valueField], week.from, week.to);
      log(`[${feed.name}] windsor ${connector}: week ${week.from}..${week.to}, ${rows.length} row(s)`);
      const value = rows[0]?.[valueField];
      if (typeof value !== "number" && typeof value !== "string") {
        log(`[${feed.name}] no ${valueField} value for the week, writing nothing`);
        return [];
      }
      return [{
        kind: "observation",
        sourceId: `${feed.name}:${week.from}`,
        value,
        observedAt: week.observedAt,
      }];
    }

    const lookbackDays = opts.lookbackDays ?? 30;
    const win = dailyWindow(now, lookbackDays);
    const rows = await fetchRows(apiKey, connector, ["date", valueField], win.from, win.to);
    log(`[${feed.name}] windsor ${connector}: ${win.from}..${win.to}, ${rows.length} day row(s)`);

    return rows
      .filter((r) => typeof r.date === "string" && (typeof r[valueField] === "number" || typeof r[valueField] === "string"))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map((r) => ({
        kind: "observation" as const,
        sourceId: `${feed.name}:${r.date}`,
        value: r[valueField] as number | string,
        observedAt: `${dateOnly(addDays(new Date(`${r.date}T00:00:00Z`), 1))}T06:00:00Z`,
      }));
  },
};
