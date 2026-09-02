# Set up Google Analytics to Sento (no coding needed)

This courier is a small helper that runs in the cloud and records your
website's daily visitors and weekly Google Search clicks in your Sento
workspace, automatically, every day. You set it up once, in about fifteen
minutes.

Tip: you can hand this whole page to Claude and say "help me set this up".

## Step 1. Collect your two keys

**Sento key**
1. In your Sento console, make sure you have a metric entity for daily
   visitors and one for weekly search clicks (create them if not).
2. On each, under "Who can write?", add a courier connection and allow it
   to read and write.
3. Open the credentials drawer and create the key. Copy it now. It is
   shown once.
4. Also note your workspace's MCP address from the install guide, like
   `https://app.yourcompany.com/api/mcp`.

**Windsor key**
1. Make an account at windsor.ai and connect your Google Analytics and
   Google Search Console there. Windsor handles the Google sign-in.
2. Copy your API key from the account page.

## Step 2. Point it at your entities

Open `feeds.json` and set each `targetEntity` to the exact names of your
two metric entities in Sento.

## Step 3. Put it in the cloud

Ask whoever runs your company's servers to deploy this repository as an
always-on worker with the start command `npm start`, entering your keys
as environment variables using the names in `.env.example`. Any modern
host works. If that meant nothing to you, forward this page to a
technical person, or to Claude. It is ten minutes of work.

## Step 4. Practice run, then go

The courier starts in practice mode (`DRY_RUN=true`). It fetches your
numbers and logs what it WOULD record, writing nothing. If the numbers
match what Google shows you, change `DRY_RUN` to `false`.

## How you know it is working

Your metrics update themselves: yesterday's visitors appear each morning,
last week's search clicks each Monday. The console's logs page shows
every write under the courier's name. It never overwrites history and
never records the same day twice. Turning it off breaks nothing.
