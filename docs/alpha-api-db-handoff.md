# Alpha API + DB Handoff for Aggregator/Dashboard Agent

This doc is a practical handoff for building an Alpha-focused aggregator/dashboard from this repo.

## 1) How to query Alpha API in this project

This project wraps the Alpha SDK in `src/alpha/alphaClient.ts` via `AlphaSdkClient`.

### Preferred query flow (market aggregation)

1. Load config with `readAlphaConfig()` from `src/alpha/alphaConfig.ts`.
2. Instantiate client:
   - `const client = new AlphaSdkClient(config, false)` for read-only/dashboard use.
3. Fetch markets:
   - `client.getLiveMarkets()` for all live markets.
   - `client.getRewardMarkets()` for reward-focused markets.
4. Merge/dedupe by `marketAppId` (project convention).
5. Fetch orderbooks per market with bounded concurrency (see `loadAlphaScan()` in `src/alpha/alphaMarketScanner.ts`).
6. Persist lifecycle status snapshots with `upsertAlphaMarketStatus()` (optional but recommended for operational dashboards).

### Key SDK wrapper methods

- `getLiveMarkets()`: live market metadata (flattened for multi-option markets).
- `getRewardMarkets()`: reward metadata where available.
- `getMarket(marketIdOrSlug)`: local lookup helper from live markets.
- `getOrderbook(market)`: on-chain orderbook + chain-status guard.
- `getPositions(walletAddress)`: wallet positions.
- `getWalletOpenOrders(walletAddress)`: wallet open orders.
- `getUsdcBalance(walletAddress)` / `getAlgoBalance(walletAddress)`: balances.

### Data normalization rules already implemented

The wrapper normalizes all Alpha microunits so downstream code can use decimals:

- Price: `1_000_000 => 1.00`, `500_000 => 0.50`
- Quantity: `1_000_000 => 1 share`
- Market/reward numeric fields are normalized with heuristics (e.g. `totalRewards`, `volume`, spread cents).

Use wrapper outputs (`AlphaMarket`, `AlphaOrderbook`) and avoid re-decoding raw SDK payloads in dashboard code.

### Important market identity mapping

- Canonical trade key in this project: `marketAppId` (number)
- Also available:
  - `id` (Alpha market/option id string)
  - `slug` (useful for routing and UX)

For aggregation joins, key by `marketAppId` first, then enrich with `id`/`slug`.

### Orderbook reliability behavior

`getOrderbook()` checks on-chain app state first and returns `source: "unavailable"` when market is resolved/inactive.
Do not treat unavailable books as errors; treat them as lifecycle events.

### Ready-to-copy TypeScript query skeleton

```ts
import { readAlphaConfig } from "../src/alpha/alphaConfig.js";
import { AlphaSdkClient } from "../src/alpha/alphaClient.js";

const config = readAlphaConfig();
const client = new AlphaSdkClient(config, false);

const live = await client.getLiveMarkets();
const reward = await client.getRewardMarkets().catch(() => []);

const byAppId = new Map<number, (typeof live)[number]>();
for (const m of [...live, ...reward]) byAppId.set(m.marketAppId, m);
const markets = [...byAppId.values()];

const books = new Map<number, Awaited<ReturnType<typeof client.getOrderbook>>>();
await Promise.all(
  markets.map(async (m) => {
    books.set(m.marketAppId, await client.getOrderbook(m));
  }),
);
```

## 2) What data is available in the project DB

DB access is in `src/db.ts` (Drizzle + Postgres, `DATABASE_URL` required). Schema is in `drizzle/schema.ts`.

Current tables:

1. `bot_states`
2. `alpha_market_status`

### Table: `bot_states`

Purpose: generic JSONB state store keyed by bot/module.

Columns:

- `key` (varchar, PK)
- `state` (jsonb, required)
- `created_at` (timestamptz)
- `updated_at` (timestamptz)

Alpha state key is usually `alpha` (`ALPHA_STATE_KEY` in config).
This table is also reused by other modules (e.g. Polymarket) via different keys.

#### Alpha JSON shape stored in `bot_states.state`

From `AlphaBotState` (`src/alpha/alphaTypes.ts`), useful dashboard fields include:

- Top-level financials:
  - `startingBalance`, `cash`, `realisedPnl`, `unrealisedPnl`, `totalPnl`
  - `estimatedRewardsUsd`, `rewardEligibleSeconds`
- Orders/positions:
  - `openOrders[]`, `positionsByMarket{}`, `fills[]`, `cancelledOrders[]`
- Market-level stats:
  - `estimatedRewardsByMarket{}`
  - `spreadStatsByMarket{}`
  - `parityAttempts[]`
- Operational stats:
  - `strategyStats.*` (ticks, liveOrdersPlaced/cancelled, spread/parity stats)
- Timestamp:
  - `lastUpdated`

### Table: `alpha_market_status`

Purpose: lightweight lifecycle/state cache for known Alpha markets.

Columns:

- `market_app_id` (bigint, PK)
- `market_id` (text)
- `slug` (text)
- `status` (text)
- `is_live` (boolean)
- `is_resolved` (boolean)
- `is_closed` (boolean)
- `end_ts` (bigint)
- `close_time` (timestamptz)
- `last_seen_at` (timestamptz)
- `created_at` / `updated_at` (timestamptz)

Index:

- `alpha_market_status_lifecycle_idx` on (`is_live`, `is_resolved`, `is_closed`)

### How these DB tables are used by Alpha flows

- `bot_states`:
  - read in `loadAlphaState()`
  - upsert in `saveAlphaState()`
- `alpha_market_status`:
  - upsert from scan results and orderbook-derived transitions
  - used to filter out inactive/resolved markets on future scans
  - used by cleanup/reporting utilities to list resolved/known markets

## 3) Useful SQL for dashboard/aggregator

### Load latest Alpha bot state JSON

```sql
select key, state, updated_at
from bot_states
where key = 'alpha';
```

### Read active vs closed market counts

```sql
select
  sum(case when is_live then 1 else 0 end) as live_markets,
  sum(case when is_resolved then 1 else 0 end) as resolved_markets,
  sum(case when is_closed then 1 else 0 end) as closed_markets
from alpha_market_status;
```

### List recent non-live markets (good for de-listing UI)

```sql
select market_app_id, market_id, slug, status, is_live, is_resolved, is_closed, last_seen_at
from alpha_market_status
where is_live = false
order by last_seen_at desc
limit 200;
```

### Pull headline metrics from Alpha JSONB

```sql
select
  state->>'lastUpdated' as state_last_updated,
  (state->>'cash')::numeric as cash,
  (state->>'realisedPnl')::numeric as realised_pnl,
  (state->>'unrealisedPnl')::numeric as unrealised_pnl,
  (state->>'totalPnl')::numeric as total_pnl,
  (state->>'estimatedRewardsUsd')::numeric as estimated_rewards_usd
from bot_states
where key = 'alpha';
```

## 4) Practical dashboard build notes

- For market cards:
  - combine live markets + reward markets
  - attach current orderbook snapshot and lifecycle status
- For wallet view:
  - use live Alpha API calls (`getPositions`, `getWalletOpenOrders`, balances)
  - do not rely on `bot_states` alone for wallet truth
- For bot-ops view:
  - use `bot_states.state` + `alpha_market_status`
- Treat `reward` fields as optional:
  - `dailyRewardsUsd`, `maxRewardSpreadCents`, `minContracts`, etc. can be missing
  - render unknown gracefully instead of coercing to zero
