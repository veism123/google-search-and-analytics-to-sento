# Google Search and Analytics to Sento

Your website numbers live in dashboards nobody opens. With this courier,
your daily visitors and weekly Google Search clicks land in your Sento
workspace automatically, exactly as Google reports them.

Ask your AI "how did the site do last week?" and it answers from your own
numbers, with the date each one was recorded.

<!-- SCREENSHOT SLOT: a metric entity in the Sento console showing the
     auto-recorded series. Capture after a few weeks of operation. -->

## What lands in your workspace

Two metrics, kept current without anyone touching them:

- **Daily visitors** — one observation per complete day, straight from
  Google Analytics (GA4).
- **Weekly search clicks** — one observation per finished week, straight
  from Google Search Console.

Values are recorded verbatim as the source returns them. The courier
never rounds, never estimates, never fills a gap with a guess, and never
records the same day twice. Everything it writes appears in your
workspace's logs under its own name.

## What you need

- A Sento workspace with two metric entities for these numbers, and a
  courier connection key with read and write granted on both.
- A free [Windsor.ai](https://windsor.ai) account with your Google
  Analytics and Search Console connected. Windsor handles the Google
  sign-in; you copy one API key.

Two keys total. [DEPLOY.md](DEPLOY.md) walks you through both in plain
language. You can hand that page to Claude and say "help me set this up".

## For developers

A courier, not an analyst: no model calls anywhere in this program. It
fetches through Windsor's connector API, writes observations through
Sento's validated write path, and dedupes with a high-water mark on each
metric's latest observation, so re-runs and backfills are harmless and
the runner is fully stateless.

Point `targetEntity` in `feeds.json` at your own entity names before
running.

```bash
npm install
npm test
cp .env.example .env   # fill in your keys
npm run once           # practice mode: logs what it WOULD write
```

Set `DRY_RUN=false` after reviewing a practice cycle. Deploy as an
always-on worker (`npm start`) on any modern host.

More integrations: [granola-to-sento](https://github.com/veism123/granola-to-sento)
brings your customer meeting notes in the same way.
