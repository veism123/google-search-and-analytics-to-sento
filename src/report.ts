import Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "./config.js";
import { SentoClient } from "./sento.js";
import { completedIsoWeek } from "./sources/windsor.js";
import { log, logError } from "./log.js";
import { notifySlack } from "./notify.js";

// The weekly marketing report, ported from the Claude scheduled task to
// this service. The instructions stay governed in Sento: this job fetches
// the workspace's own "Weekly report skill" at runtime and follows it, so
// editing the skill in Sento changes the report with no deploy. The raw
// metric writes the skill describes are already handled daily by the
// courier; the model is told so. Runs Fridays after 07:00 UTC, at most
// once per week (entry-name dedupe). Skipped without ANTHROPIC_API_KEY.

const REPORT_ENTITY = process.env.REPORT_ENTITY ?? "Weekly marketing report";
const REPORT_SKILL = process.env.REPORT_SKILL ?? "Weekly report skill";
const MAX_OUTPUT_TOKENS = Number(process.env.REPORT_MAX_TOKENS ?? "16000");
const WINDSOR = "https://connectors.windsor.ai";

function isoWeekName(now: Date): string {
  const w = completedIsoWeek(now);
  const d = new Date(`${w.from}T00:00:00Z`);
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() + 3);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `Week ${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")} marketing report`;
}

async function windsorRows(
  apiKey: string,
  connector: string,
  fields: string[],
  from: string,
  to: string
): Promise<unknown> {
  const params = new URLSearchParams({ api_key: apiKey, date_from: from, date_to: to, fields: fields.join(",") });
  const res = await fetch(`${WINDSOR}/${connector}?${params}`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return `fetch failed: ${res.status}`;
  const json = (await res.json()) as { data?: unknown; result?: unknown };
  return json.data ?? json.result ?? "no data";
}

export async function runReport(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const windsorKey = process.env.WINDSOR_API_KEY;
  if (!apiKey || !windsorKey) {
    log("[report] skipping: ANTHROPIC_API_KEY and WINDSOR_API_KEY are both required");
    return;
  }
  const config = loadConfig();
  if (!config.sentoMcpUrl || !config.sentoCourierKey) {
    log("[report] skipping: Sento credentials are not set");
    return;
  }
  const sento = new SentoClient(config.sentoMcpUrl, config.sentoCourierKey);

  const reportId = await sento.findEntityIdByName(REPORT_ENTITY);
  const entryName = isoWeekName(new Date());
  const reportIndex = await sento.readEntity(reportId);
  if (reportIndex.includes(entryName)) {
    log(`[report] "${entryName}" already exists, skipping`);
    return;
  }

  // The skill body is the instruction set; the guide rules the entry shape.
  const skillIndex = await sento.getSkill();
  const skillMatch = skillIndex.match(
    new RegExp(`"${REPORT_SKILL}"[\\s\\S]*?id: ([0-9a-f-]{36})`)
  );
  if (!skillMatch) {
    logError(`[report] skill "${REPORT_SKILL}" not found in the workspace`, null);
    return;
  }
  const skillBody = await sento.getSkill(skillMatch[1]);
  const guide = await sento.readAuthoringGuide(reportId);
  const previous = reportIndex.slice(0, 4000);
  const planId = await sento.findEntityIdByName("Search and content plan");
  const plan = (await sento.readEntity(planId)).slice(0, 14000);

  // The reporting window: last completed ISO week plus the week before, for
  // deltas, fetched from Windsor exactly as the skill specifies.
  const week = completedIsoWeek(new Date());
  const prevFrom = new Date(new Date(`${week.from}T00:00:00Z`).getTime() - 7 * 86_400_000)
    .toISOString().slice(0, 10);
  const prevTo = new Date(new Date(`${week.from}T00:00:00Z`).getTime() - 86_400_000)
    .toISOString().slice(0, 10);

  log(`[report] fetching Windsor data for ${week.from}..${week.to} (prior ${prevFrom}..${prevTo})`);
  const data = {
    ga4_daily_users_week: await windsorRows(windsorKey, "googleanalytics4", ["date", "totalusers"], week.from, week.to),
    ga4_channels_week: await windsorRows(windsorKey, "googleanalytics4", ["session_default_channel_group", "source", "totalusers", "sessions", "engagement_rate"], week.from, week.to),
    ga4_landing_pages_week: await windsorRows(windsorKey, "googleanalytics4", ["landing_page", "sessions", "engagement_rate", "average_engagement_time_per_session"], week.from, week.to),
    gsc_totals_week: await windsorRows(windsorKey, "searchconsole", ["clicks", "impressions"], week.from, week.to),
    gsc_queries_week: await windsorRows(windsorKey, "searchconsole", ["query", "clicks", "impressions", "position"], week.from, week.to),
    gsc_pages_week: await windsorRows(windsorKey, "searchconsole", ["page", "clicks", "impressions", "position"], week.from, week.to),
    ga4_daily_users_prior: await windsorRows(windsorKey, "googleanalytics4", ["date", "totalusers"], prevFrom, prevTo),
    gsc_totals_prior: await windsorRows(windsorKey, "searchconsole", ["clicks", "impressions"], prevFrom, prevTo),
  };

  const task =
    `Write the "${entryName}" entry for the reporting window ${week.from} to ${week.to}.\n\n` +
    `## The workspace's own skill for this report (follow it; notes below override where they conflict)\n${skillBody}\n\n` +
    `## Overrides for this runtime\n` +
    `- You are running as a headless service, not in a chat. Skip every step that references vault files, artifacts, push notifications, or asking the user: work only from what is provided here.\n` +
    `- The raw metric writes (Daily visitors, Organic search clicks) are handled daily by the analytics courier; do NOT write metrics, only note in Data notes if the provided numbers look inconsistent.\n` +
    `- Output only the report entry body, ready to store.\n\n` +
    `## The entry's authoring guide\n${guide}\n\n` +
    `## Search and content plan (plan of record)\n${plan}\n\n` +
    `## Existing report entries (for last week's actions follow-up)\n${previous}\n\n` +
    `## Windsor data, fetched this run (verbatim)\n${JSON.stringify(data, null, 1).slice(0, 60000)}\n\n` +
    `Today is ${new Date().toISOString().slice(0, 10)}. Compose the report now.`;

  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
  const client = new Anthropic({
    apiKey,
    ...(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {}),
  });
  const stream = client.messages.stream({
    model: "claude-opus-5",
    max_tokens: MAX_OUTPUT_TOKENS,
    messages: [{ role: "user", content: task }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") {
    logError("[report] the model declined the request", message.stop_details);
    return;
  }
  const text = message.content
    .filter((b: Anthropic.ContentBlock): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  const estUsd = (message.usage.input_tokens * 5 + message.usage.output_tokens * 25) / 1_000_000;
  log(`[report] usage: ${message.usage.input_tokens} in / ${message.usage.output_tokens} out tokens, ~$${estUsd.toFixed(2)}`);
  if (!text) {
    logError("[report] no report text produced", null);
    return;
  }

  if (config.dryRun) {
    log(`[report] DRY RUN would write "${entryName}"`, { bodyChars: text.length });
    log(text.slice(0, 1500));
    return;
  }
  const result = await sento.writeListEntry({
    entityId: reportId,
    name: entryName,
    body: text,
    structured: { source: "marketing-report", model: "claude-opus-5", window: `${week.from}..${week.to}` },
  });
  log(`[report] wrote "${entryName}"`, { server: result.slice(0, 160) });
  await notifySlack(`${entryName} is ready in Sento (${REPORT_ENTITY}).`);
}
