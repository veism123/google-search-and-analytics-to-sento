import type { FeedConfig, Source } from "./types.js";
import { SentoClient } from "./sento.js";
import { windsorSource } from "./sources/windsor.js";
import { log, logError } from "./log.js";

export const SOURCES: Record<string, Source> = {
  windsor: windsorSource,
};
// A metric read displays its latest observation ("observed_at: ..."). That
// timestamp is the high-water mark: only observations after it are written,
// which makes re-runs and backfills idempotent with no local state.
export function latestObservedAt(entityText: string): Date | null {
  const matches = [...entityText.matchAll(/observed_at: ([0-9T:.+Z-]+?)[)\s]/g)];
  if (matches.length === 0) return null;
  const times = matches.map((m) => new Date(m[1]).getTime()).filter((t) => !Number.isNaN(t));
  return times.length ? new Date(Math.max(...times)) : null;
}

// One pass over one feed: fetch items from the source, read the target
// entity (the gate requires a prior read; the read also carries the dedupe
// evidence), write what is not already recorded. The runner stays stateless.
export async function runFeed(
  feed: FeedConfig,
  sento: SentoClient | null,
  dryRun: boolean
): Promise<void> {
  const source = SOURCES[feed.source];
  if (!source) {
    throw new Error(`[${feed.name}] unknown source "${feed.source}" (known: ${Object.keys(SOURCES).join(", ")})`);
  }
  const apiKey = process.env[feed.apiKeyEnv];
  if (!apiKey) {
    log(`[${feed.name}] skipping: env var ${feed.apiKeyEnv} is not set on this deployment`);
    return;
  }

  const items = await source.fetch(feed, apiKey);
  if (items.length === 0) {
    log(`[${feed.name}] nothing to consider this cycle`);
    return;
  }

  let entityId = "";
  let existing = "";
  let highWater: Date | null = null;
  if (!dryRun) {
    entityId = await sento!.findEntityIdByName(feed.targetEntity);
    existing = await sento!.readEntity(entityId);
    highWater = latestObservedAt(existing);
  }

  for (const item of items) {
    if (item.kind === "observation") {
      if (!dryRun && highWater && new Date(item.observedAt) <= highWater) {
        log(`[${feed.name}] dedupe: ${item.sourceId} at/before high water ${highWater.toISOString()}, skipping`);
        continue;
      }
      if (dryRun) {
        log(`[${feed.name}] DRY RUN would write observation`, {
          sourceId: item.sourceId,
          value: item.value,
          observedAt: item.observedAt,
        });
        continue;
      }
      const result = await sento!.writeMetric({
        entityId,
        value: item.value,
        observedAt: item.observedAt,
      });
      log(`[${feed.name}] wrote observation ${item.sourceId}`, { server: result.slice(0, 200) });
      continue;
    }

    const key = item.dedupeKey ?? item.name;
    if (!dryRun && (existing.includes(key) || existing.includes(item.sourceId))) {
      log(`[${feed.name}] dedupe: "${key}" already recorded, skipping ${item.sourceId}`);
      continue;
    }
    if (dryRun) {
      log(`[${feed.name}] DRY RUN would write entry`, {
        entryName: item.name,
        sourceId: item.sourceId,
        bodyChars: item.body.length,
      });
      continue;
    }
    const result = await sento!.writeListEntry({
      entityId,
      name: item.name,
      body: item.body,
      occurredAt: item.occurredAt,
      structured: item.structured,
    });
    log(`[${feed.name}] wrote entry ${item.sourceId}`, { server: result.slice(0, 200) });
  }
}

export async function runAllFeeds(
  feeds: FeedConfig[],
  sento: SentoClient | null,
  dryRun: boolean
): Promise<void> {
  for (const feed of feeds) {
    try {
      await runFeed(feed, sento, dryRun);
    } catch (err) {
      logError(`[${feed.name}] feed failed`, err);
    }
  }
}
