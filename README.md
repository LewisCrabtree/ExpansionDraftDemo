# Expansion Draft Planner

Next.js app for simulating a two-team dynasty expansion draft from a Sleeper league snapshot, using local KeepTradeCut rankings as the primary value source.

## What This Repo Does

This project lets you load one saved Sleeper league snapshot and explore a simulated expansion draft with a UI for:

- keepers per team
- max picks from one existing team
- include rookie picks
- include free agents
- snake vs linear expansion order

It also renders:

- protected keepers by team
- projected selections for both expansion teams
- resulting post-draft league rosters
- team impact charts
- resulting roster value charts

## Current Data Source

The app currently uses:

- Sleeper snapshot data from `data/league-1312262964929110016.snapshot.json`
- KTC rankings from `data/ktc_16032026.csv`

Ranking priority is:

1. manual overrides in `data/player-rankings.overrides.json`
2. KTC CSV values
3. Sleeper `search_rank` fallback

## Local Development

Requirements:

- Node.js 20+
- `pnpm`

Install and run:

```bash
pnpm install
pnpm dev
```

Useful commands:

```bash
pnpm snapshot
pnpm lint
pnpm build
```

## Snapshot Refresh

To refresh the local Sleeper snapshot for this league:

```bash
pnpm snapshot
```

That script writes files into `data/`, including:

- `league-1312262964929110016.snapshot.json`
- `league-1312262964929110016.schema.json`
- `league-1312262964929110016.db-summary.md`

## Deploying to Vercel

Fastest path:

1. Push the repo to GitHub.
2. Import the repo into Vercel.
3. Accept the default Next.js settings.
4. Deploy.

This app reads checked-in local data files, so the basic deployment does not require environment variables.

If you want a one-off deploy from your machine instead:

```bash
pnpm i -g vercel
vercel
vercel deploy --prod
```

## Privacy Note

This repo contains league-specific data in `data/`, including owner names, team names, roster contents, trades, and draft information from the saved Sleeper snapshot.

If you do not want that information to be public:

- keep the GitHub repo private
- or replace/sanitize the contents of `data/` before publishing

## Project Structure

```text
src/app/                Next.js app shell and page
src/components/         planner UI
src/lib/                data loading and shaping
scripts/                Sleeper snapshot fetch script
data/                   local snapshot and ranking inputs
```
