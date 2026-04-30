Yep — below is a **single full Codex spec** for the Alpha Arcade side of Nuckelavee.

It combines:

* Alpha scanner
* paper trading
* P&L tracking
* safe live-dry-run
* explicitly gated tiny live trading
* micro market-making strategy

It should sit **independently** from the Div3rsaFi side.

---

# Codex Spec: Nuckelavee Alpha Arcade Module

## Goal

Add a standalone **Alpha Arcade module** to Nuckelavee.

The module should start with scanner, paper trading, live-dry-run, and explicitly gated tiny live trading for a low-risk reward-market-making bot.

The goal is not high-frequency gambling or directional betting.

The goal is:

```text
Earn small, repeatable Alpha Arcade LP rewards first, with spread capture as secondary upside:
- target: $10–$50/month initially
- scale naturally if Alpha Arcade volume grows
- avoid large directional exposure
```

Alpha Arcade has an official SDK/MCP stack. The MCP exposes market browsing, orderbooks, position checks, split/merge, order placement, cancel/amend, and WebSocket market/orderbook streams. The SDK docs also state prices and quantities use microunits, where `1_000_000 = 1.00` and `500_000 = 0.50`. ([npmjs.com][1])

---

# 1. Hard Scope

Build the Alpha module independently from the existing Div3rsaFi module.

Do not modify Div3rsaFi logic except to add command routing if required.

The Alpha module must support:

```text
- alpha:scan
- alpha:rewards
- alpha:watch
- alpha:market <slug-or-id>
- alpha:paper
- alpha:paper-watch
- alpha:paper-report
- alpha:live-dry-run
- alpha:live
```

Live trading is included in this build, but only through the explicit `alpha:live` command and only when confirmation flags and tiny caps are present.

---

# 2. Strategy

Primary strategy:

```text
Reward-qualified LP market making
```

Secondary strategy:

```text
Conservative spread capture from resting limit orders
```

Tertiary strategy:

```text
Parity / split-merge opportunity detection
```

Avoid:

```text
- directional betting
- prediction-only strategies
- increasing exposure after losses
- trading near resolution
- chasing prices
```

The bot should behave like this:

```text
1. Find Alpha reward markets paying LP incentives.
2. Prefer markets with high daily rewards, low/medium competition, and practical reward-zone constraints.
3. Place tiny qualifying paper quotes near midpoint and within the market's max reward spread.
4. Track reward eligibility time and estimated hourly/daily USDC rewards.
5. Track conservative fills, exits, and trading P&L separately from reward estimates.
6. Keep inventory small and balanced.
7. Use spread capture as secondary upside, not the main reason to quote.
8. Prepare live-dry-run output before any real trading.
```

---

# 3. Expected Project Structure

Add a new module:

```text
/src
  /alpha
    alphaClient.ts
    alphaConfig.ts
    alphaTypes.ts

    alphaMarketScanner.ts
    alphaOrderbookScanner.ts
    alphaRewardScanner.ts
    alphaMakerScanner.ts
    alphaParityScanner.ts
    alphaSplitMergeScanner.ts

    quoteEngine.ts
    alphaRiskManager.ts
    paperTrader.ts
    fillTracker.ts
    rewardTracker.ts
    pnlTracker.ts
    liveReadiness.ts

    alphaFormatter.ts
    alphaCommands.ts

  /div3rsa
    existing files remain separate

  index.ts
```

Shared utility files are fine, but Alpha must not depend on Div3rsa-specific types or assumptions.

Command wiring should keep Alpha separate from Div3rsaFi:

```text
- Prefer package scripts that call an Alpha entrypoint directly, e.g. tsx src/alpha/alphaCommands.ts scan.
- Avoid adding Alpha logic to the existing Div3rsaFi command runner beyond minimal package script wiring.
- Keep Alpha persisted state in its own bot store file.
```

---

# 4. Package / Integration Expectations

Use Alpha’s official tooling where possible.

Preferred packages:

```text
@alpha-arcade/sdk
@alpha-arcade/mcp if useful for agent/tool access
```

Implementation expectations:

```text
- Prefer SDK for programmatic TypeScript bot code.
- MCP can be referenced as the public capability surface, but normal app code should use SDK/client calls where possible.
- Do not scrape Alpha Arcade’s frontend.
- Do not use wallet or mnemonic in scan/paper modes.
```

Alpha SDK/MCP facts to respect:

```text
- Alpha has on-chain orderbooks.
- Orderbooks are split by YES and NO, each with bids and asks.
- Orderbook entries include price, quantity, escrow app ID, and owner.
- Prices and quantities are microunits.
- 1_000_000 = 1.00.
- 500_000 = 0.50.
- SDK quantity 1_000_000 = 1 share.
- SDK position 1 = YES, 0 = NO.
- SDK order side uses buying/selling semantics; MCP docs may expose side as 1 = buy, 0 = sell.
- get_orderbook / SDK getOrderbook uses marketAppId.
- get_full_orderbook / SDK getFullOrderbookFromApi uses Alpha marketId and requires ALPHA_API_KEY.
- MCP read-only market and orderbook tools work without ALPHA_API_KEY.
- get_reward_markets should be attempted without ALPHA_API_KEY first; some MCP/API versions may require ALPHA_API_KEY for the reward-market REST path.
- Reward markets return fields such as totalRewards and rewardsPaidOut when available.
- WebSocket orderbook streams use slug.
- WebSocket orderbook streams can provide fresher data than on-chain reads.
- Reward markets pay USDC to qualifying liquidity providers hourly according to Alpha's reward rules.
- Reward eligibility depends on resting limit orders being close enough to the market midpoint, inside each market's max spread / reward zone, meeting the market's minimum aggregate contract size for the wallet/market, and resting for at least 3 minutes.
- LP provision on both YES and NO is more favorable than one-sided liquidity, so live selection should prefer paired reward-qualified quotes where caps allow.
- Trading tools require wallet credentials.
```

---

# 5. Commands

Add package scripts:

```text
alpha:scan
alpha:rewards
alpha:watch
alpha:market
alpha:paper
alpha:paper-watch
alpha:paper-report
alpha:live-dry-run
alpha:live
alpha:typecheck if useful
```

Expected examples:

```text
npm run alpha:scan
npm run alpha:rewards
npm run alpha:watch
npm run alpha:market -- <slug-or-id>
npm run alpha:paper
npm run alpha:paper-watch
npm run alpha:paper-report
npm run alpha:live-dry-run
npm run alpha:live
```

---

# 6. Environment Config

Create Alpha-specific config.

```text
ALPHA_API_KEY=

ALPHA_SCAN_ORDERBOOK_LIMIT=25
ALPHA_SPREAD_SCAN_ORDERBOOK_LIMIT=75
ALPHA_MAX_MARKETS_PER_SCAN=100
ALPHA_SCAN_INTERVAL_MS=10000
ALPHA_STREAM_TIMEOUT_MS=15000

ALPHA_REWARDS_REQUIRE_API_KEY=false
ALPHA_MIN_DAILY_REWARD_USD=1
ALPHA_MIN_REWARD_ZONE_CENTS=2
ALPHA_REWARD_ZONE_BUFFER_CENTS=0.5
ALPHA_MAX_REWARD_COMPETITION=medium

ALPHA_MIN_EDGE_BPS=75
ALPHA_PARITY_BUFFER_BPS=75
ALPHA_MIN_MAKER_SPREAD_CENTS=4
ALPHA_ENABLE_SPREAD_CAPTURE=true
ALPHA_SPREAD_SCAN_ORDERBOOK_LIMIT=75
ALPHA_SPREAD_ORDER_SIZE_USD=1
ALPHA_MIN_SPREAD_CAPTURE_CENTS=0.5
ALPHA_SPREAD_ENTRY_MIN_DWELL_SECONDS=600
ALPHA_SPREAD_EXIT_EDGE_CENTS=1
ALPHA_SPREAD_EXIT_MIN_DWELL_SECONDS=1800
ALPHA_MIN_SPREAD_MIDPOINT=0.01
ALPHA_MAX_SPREAD_MIDPOINT=0.99
ALPHA_MAX_SPREAD_MARKET_EXPOSURE_USD=2
ALPHA_MIN_TIME_TO_CLOSE_MINUTES=60
ALPHA_MAX_TIME_TO_CLOSE_HOURS=168

ALPHA_MIN_MIDPOINT=0.20
ALPHA_MAX_MIDPOINT=0.80

ALPHA_TARGET_QUOTE_SIZE_USD=3
ALPHA_MAX_ORDER_SIZE_USD=3
ALPHA_MAX_MARKET_EXPOSURE_USD=6
ALPHA_MAX_TOTAL_EXPOSURE_USD=12
ALPHA_MAX_OPEN_ORDERS=10
ALPHA_MAX_LIVE_OPEN_ORDERS=6
ALPHA_MAX_LIVE_ORDERS_PER_MARKET=2

ALPHA_ORDER_REFRESH_MS=15000
ALPHA_QUOTE_REFRESH_THRESHOLD_CENTS=1
ALPHA_MIN_ALGO_BALANCE=3
ALPHA_REWARD_MIN_DWELL_SECONDS=180

ALPHA_PAPER_STARTING_BALANCE_USD=50

ALPHA_ENABLE_LIVE_TRADING=true
ALPHA_CONFIRM_RISK=true
ALPHA_WALLET_ADDRESS=
ALPHA_WALLET_MNEMONIC=
PAYER_MNEMONIC=
```

Expectations:

```text
- ALPHA_API_KEY is optional.
- Without API key, use live markets and available orderbook methods.
- LP reward scanning should try MCP get_reward_markets without an API key first.
- If the installed MCP version returns an API-key-required error for get_reward_markets, reward commands should print a clear setup/version message and non-reward scan/paper modes should still work.
- If ALPHA_API_KEY is present, use it for API-backed reward metadata.
- Wallet/mnemonic must never be required for scan or paper modes.
- ALPHA_WALLET_ADDRESS is required for live-dry-run so it can inspect open orders and positions.
- Live mode uses ALPHA_WALLET_MNEMONIC if present, otherwise PAYER_MNEMONIC.
- PAYER_MNEMONIC may be reused for Alpha live trading, but only after live flags pass.
- ALPHA_MAX_LIVE_OPEN_ORDERS exists because each live limit order locks roughly 0.957 ALGO minimum-balance collateral until cancelled or filled.
- Live trading must not start accidentally.
```

---

# 7. Alpha Client

Create `alphaClient.ts`.

The client should hide SDK/MCP implementation details.

Required client methods:

```text
getAgentGuide()
getLiveMarkets()
getRewardMarkets()
getMarket(marketIdOrSlug)
getOrderbook(marketAppId)
getFullOrderbook(marketId)
streamOrderbook(slug, timeoutMs)
streamLiveMarkets(durationMs)
getOpenOrders(walletAddress)          live-dry-run/future live only
getPositions(walletAddress)           live-dry-run/future live only
```

For v1/v2:

```text
Only read-only methods should be used.
```

Identifier rules:

```text
- Use Alpha `id` / `marketId` as the canonical market identity in persisted state and reports.
- Use `marketAppId` for on-chain orderbook reads and future order placement.
- Use `slug` for WebSocket subscriptions and user-facing market lookup when available.
- Use `escrowAppId` only for individual order identities from full orderbooks, open orders, cancels, and amendments.
- For multi-choice markets, trade and scan each option's `marketAppId`; do not treat the parent market as tradeable if it only contains `options[]`.
- `getFullOrderbookFromApi(marketId)` / MCP `get_full_orderbook` expects Alpha market ID, not marketAppId.
- `getOrderbook(marketAppId)` expects marketAppId.
- `subscribeOrderbook(slug)` / MCP `stream_orderbook` expects slug.
```

Orderbook source priority:

```text
1. WebSocket snapshot if slug is available and stream succeeds.
2. Full REST orderbook if ALPHA_API_KEY is available.
3. Standard/on-chain orderbook fallback.
```

Every normalised orderbook must include:

```text
source:
- websocket
- full_rest_orderbook
- onchain_orderbook
- unavailable
```

Failure expectations:

```text
- If one orderbook source fails, fall back to the next.
- If all sources fail, mark orderbook unavailable.
- Do not crash the whole scan because one market fails.
```

---

# 8. Alpha Types

Create `alphaTypes.ts`.

Use independent Alpha types.

## AlphaMarket

Fields:

```text
id
marketAppId
slug
title
category
status
closeTime
resolved
yesPrice if available
noPrice if available
volume if available
liquidity if available
reward:
- isRewardMarket
- totalRewardsUsd if available
- rewardsPaidOutUsd if available
- dailyRewardsUsd if available
- lastPayoutUsd if available
- maxRewardSpreadCents if available
- competitionLevel if available
options if multi-choice
raw
```

## AlphaOrderbook

Fields:

```text
marketId
marketAppId
slug
source
yesBid
yesAsk
noBid
noAsk
yesMid
noMid
yesSpread
noSpread
bestSpread
bids
asks
yesSideOrders
noSideOrders
raw
```

## AlphaOpportunity

Fields:

```text
type
marketId
slug
title
edgeBps
confidence
classification
reason
requiredAction
warnings
reward:
- rewardEligible
- estimatedRewardUsdPerHour
- estimatedRewardUsdPerDay
- rewardZoneDistanceCents
- competitionLevel
- rewardReason
```

Classifications:

```text
OBSERVATION
CANDIDATE
MECHANICAL
DANGER
```

## AlphaPaperOrder

Fields:

```text
id
marketId
slug
title
side
outcome
price
sizeShares
sizeUsd
notionalUsd
reservedUsd
filledShares
remainingShares
createdAt
updatedAt
status
reason
```

Where:

```text
side = bid | ask
outcome = YES | NO
status = open | filled | cancelled | expired
```

## AlphaPaperPosition

Fields:

```text
marketId
slug
title
yesShares
noShares
avgYesCost
avgNoCost
realisedPnl
unrealisedPnl
lastMark
```

---

# 9. Microunit Normalisation

Alpha prices and quantities must be normalised immediately in the client wrapper.

Rules:

```text
raw price 1_000_000 => 1.00
raw price 500_000 => 0.50
raw quantity 1_000_000 => 1 share
```

All scanner, quote, risk, paper and P&L code should operate on decimal prices:

```text
0.00 to 1.00
```

Do not allow raw microunits outside `alphaClient.ts`.

Sizing rules:

```text
- Internally store quantities as decimal shares.
- Convert SDK/MCP raw quantities by dividing by 1_000_000.
- Convert decimal shares back to microunits only inside future live execution wrappers.
- Treat ALPHA_TARGET_QUOTE_SIZE_USD and ALPHA_MAX_ORDER_SIZE_USD as max notional exposure, not share count.
- For a buy quote: sizeShares = quoteSizeUsd / price.
- Round sizeShares down to 6 decimal places before persistence or future execution.
- notionalUsd = price * sizeShares.
- Reject quotes where price <= 0, price >= 1, or rounded sizeShares <= 0.
```

---

# 10. Market Surface Scanner

Purpose:

```text
Find which Alpha markets are worth monitoring.
```

For every live market, compute:

```text
- has orderbook
- has bid
- has ask
- two-sided / one-sided / empty
- spread
- midpoint
- time to close
- category
- volume if available
- liquidity if available
```

Output rankings:

```text
- top reward markets by daily USDC rewards
- top reward markets by low competition
- top reward-qualified maker candidates
- top active markets by liquidity
- top active markets by volume
- top widest spreads
- top maker candidates
- markets near close
- empty / one-sided / two-sided counts
```

Acceptance expectations:

```text
- Scanner handles missing data gracefully.
- Scanner does not require orderbook for every market.
- Scanner respects ALPHA_SCAN_ORDERBOOK_LIMIT.
- Scanner clearly reports how many books were scanned.
```

---

# 11. LP Reward Scanner

Purpose:

```text
Find Alpha markets where resting limit orders can earn hourly USDC LP rewards.
```

Use:

```text
getRewardMarkets()
```

MCP/API expectations:

```text
- MCP read-only tools should work without ALPHA_API_KEY.
- get_reward_markets should be attempted without ALPHA_API_KEY.
- If get_reward_markets returns an API-key-required error, treat that as an installed MCP/API limitation, not as a global MCP requirement.
- Returned markets may include totalRewards, rewardsPaidOut, daily reward values, max spread / reward-zone constraints, competition level, last payout, and options[] for multi-choice markets.
- If a reward field is unavailable, keep the market but mark the estimate as unknown rather than inventing a value.
```

For every reward market or tradeable option, compute:

```text
- rewardMarketId
- marketAppId
- slug
- title
- dailyRewardsUsd if available
- totalRewardsUsd if available
- rewardsPaidOutUsd if available
- remainingRewardsUsd if computable
- lastPayoutUsd if available
- maxRewardSpreadCents if available
- minContracts / minimum aggregate reward contract size if available
- competitionLevel if available
- midpoint
- reward zone:
  - maxRewardSpread = maxRewardSpreadCents / 100
  - lower = midpoint - maxRewardSpread
  - upper = midpoint + maxRewardSpread
- whether current proposed quote is inside reward zone
- whether aggregate wallet/address resting contracts in the market meet the market minimum
- whether the order has rested for at least 3 minutes before counting estimated rewards
- estimated share of rewards if enough data is available
```

Ranking:

```text
Rank higher for:
- higher dailyRewardsUsd
- lower competition
- larger remaining reward pool
- practical maxRewardSpreadCents
- smaller aggregate minimum reward contract size that fits within configured caps
- stable midpoint
- ability to quote both YES and NO reward-eligible sides
- two-sided book with enough depth to avoid accidental crossing
- markets with recent payouts

Rank lower or reject for:
- high competition unless dailyRewardsUsd is large enough
- missing max spread / reward-zone constraints
- very tight reward zones that would force crossing or adverse selection
- near-close markets
- extreme midpoint markets
```

Output example:

```text
[LP REWARD CANDIDATE]
Market: <title>
Slug: <slug>
Daily rewards: $50.00
Last payout: $2.08
Competition: Medium
Max reward spread: ±3c
Midpoint: 0.505
Reward zone: 0.475 to 0.535
Suggested quote: YES bid 0.49 size $1.00 notional
Estimated rewards: unknown until live wallet/order share data is available
Warnings: reward estimate is not realised P&L
```

Reward accounting rule:

```text
LP rewards are the primary expected profit source, but they must be reported separately from trading P&L unless Alpha exposes actual paid/accrued wallet rewards.
```

---

# 12. Maker Candidate Scanner

Purpose:

```text
Rank markets for conservative spread capture and reward-qualified quoting.
```

Candidate requirements:

```text
- live/open market
- not resolved
- two-sided orderbook exists
- if reward market: proposed quote can sit inside the reward zone without crossing the book
- if non-reward market: outcome spread >= ALPHA_MIN_MAKER_SPREAD_CENTS for YES and/or NO
- midpoint between ALPHA_MIN_MIDPOINT and ALPHA_MAX_MIDPOINT
- time to close >= ALPHA_MIN_TIME_TO_CLOSE_MINUTES
- time to close <= ALPHA_MAX_TIME_TO_CLOSE_HOURS
```

Outcome selection:

```text
- Evaluate YES and NO independently.
- Quote only outcomes whose own bid/ask spread, midpoint, depth, and risk checks pass.
- It is acceptable to quote YES only, NO only, or both, but never force both sides for symmetry.
- Prefer the outcome with the healthier book if risk budget only allows one quote pair.
```

Rank higher for:

```text
- active LP rewards
- higher estimated reward value
- lower competition
- quote can sit near midpoint inside max reward spread
- wider spread
- midpoint closer to 0.50
- more visible depth
- visible recent activity, if available
- healthier two-sided book
```

Classifications:

```text
Excellent:
- spread >= 6c
- midpoint 0.25 to 0.75
- good visible depth
- time to close > 1 hour

Good:
- spread >= 4c
- midpoint 0.20 to 0.80

Weak:
- passes minimum filters but has weak depth or stale data
```

Output example:

```text
[MAKER CANDIDATE]
Market: <title>
Slug: <slug>
Reward: $50/day, competition medium, max spread ±3c
YES bid/ask: 0.43 / 0.51
Spread: 8c
Midpoint: 0.47
Classification: CANDIDATE
Reason: reward-paying market, quote can sit inside reward zone, two-sided book
Expectation: hourly LP rewards first; possible spread capture if filled and exited
Warnings: adverse selection possible
```

---

# 13. Parity Scanner

Purpose:

```text
Find mechanical YES/NO pricing gaps.
```

Prediction market invariant:

```text
YES + NO ≈ 1
```

Detect:

```text
YES ask + NO ask < 1 - (ALPHA_PARITY_BUFFER_BPS / 10000)
YES bid + NO bid > 1 + (ALPHA_PARITY_BUFFER_BPS / 10000)
```

Output:

```text
[PARITY GAP]
Market: <title>
YES ask + NO ask = 0.96
Raw edge: 400 bps
Classification: MECHANICAL
Required action: buy both sides, then merge if supported
Warnings: check size, fees, slippage, merge availability, and settlement risk
```

Expectations:

```text
- This may be rare.
- It is still worth scanning because it is one of the cleanest mechanical checks.
- Do not claim profit unless executable size and fees are known.
```

---

# 14. Split / Merge Scanner

Purpose:

```text
Detect theoretical split/merge arbitrage.
```

Alpha has split/merge position-management primitives according to SDK/MCP docs. v2 should detect only, not execute. ([Mintlify][2])

Detect:

```text
Buy both below 1:
YES ask + NO ask < 1 - (ALPHA_PARITY_BUFFER_BPS / 10000)

Sell both above 1:
YES bid + NO bid > 1 + (ALPHA_PARITY_BUFFER_BPS / 10000)
```

Scanner relationship:

```text
- Parity scanner owns the raw YES+NO invariant checks.
- Split/merge scanner reuses parity candidates and adds required theoretical action, size/depth, and split/merge-specific warnings.
- v2 detects only; it does not execute split or merge transactions.
```

Report:

```text
- raw edge
- estimated depth if available
- fee/slippage buffer
- required theoretical action
- warnings
```

Example:

```text
[SPLIT/MERGE CANDIDATE]
Market: <title>
YES bid + NO bid = 1.04
Raw edge: 400 bps
Required theoretical action: split USDC into YES/NO, sell both sides
Warnings: not executed in v2; confirm exact platform fees and available depth
```

---

# 15. Quote Engine

Purpose:

```text
Generate conservative market-making quotes for paper mode and live-dry-run.
```

For each selected maker candidate:

```text
mid = (bestBid + bestAsk) / 2
spread = bestAsk - bestBid
```

For reward markets, quote placement starts from the reward zone, not from spread capture:

```text
maxRewardSpread = maxRewardSpreadCents / 100
rewardBuffer = ALPHA_REWARD_ZONE_BUFFER_CENTS / 100
rewardLower = midpoint - maxRewardSpread
rewardUpper = midpoint + maxRewardSpread
preferredBid = midpoint - rewardBuffer
preferredAsk = midpoint + rewardBuffer
```

Reward quote rules:

```text
- The quote must remain inside the market's max reward spread / reward zone.
- The quote must not cross the current book.
- The market's minimum aggregate reward contract size is checked across all eligible wallet orders in that market.
- If preferredBid would cross the ask, move it down or reject.
- If preferredAsk would cross the bid, move it up or reject.
- If no reward-zone metadata is available, do not estimate rewards for that market.
- It is better to miss a reward than to place a quote that creates obvious adverse-selection risk.
```

Spread capture quote rules:

```text
- Spread capture is independent from LP reward eligibility.
- Use ALPHA_SPREAD_ORDER_SIZE_USD for spread-entry bids.
- Only quote spread entries when the outcome has a true two-sided book.
- The outcome spread must be at least ALPHA_MIN_SPREAD_CAPTURE_CENTS.
- The outcome midpoint must be within ALPHA_MIN_SPREAD_MIDPOINT and ALPHA_MAX_SPREAD_MIDPOINT, which are separate from reward midpoint filters.
- Place the bid inside the spread near midpoint, with ALPHA_SPREAD_EXIT_EDGE_CENTS reserved for exit edge.
- Keep spread-entry bids resting for at least ALPHA_SPREAD_ENTRY_MIN_DWELL_SECONDS unless filled or clearly unsafe.
- If inventory exists, generate an inventory_exit ask only up to verified wallet/state inventory.
- Keep inventory_exit asks resting for at least ALPHA_SPREAD_EXIT_MIN_DWELL_SECONDS unless filled or clearly unsafe.
- Spread orders remain subject to ALPHA_MAX_SPREAD_MARKET_EXPOSURE_USD, market cap, total cap, and open-order caps.
```

Quotes are outcome-specific:

```text
- Generate quotes independently for YES and NO.
- Use that outcome's own best bid, best ask, midpoint, spread, and visible depth.
- A market may receive YES quotes, NO quotes, both, or neither.
- Do not infer NO quotes from YES prices unless the client explicitly marked those prices as derived.
```

Default quote:

```text
botBid = mid - spread * 0.25
botAsk = mid + spread * 0.25
```

Example:

```text
Best bid: 0.42
Best ask: 0.50
Mid: 0.46
Spread: 0.08

Bot bid: 0.44
Bot ask: 0.48
```

Quote size:

```text
ALPHA_TARGET_QUOTE_SIZE_USD
```

Sizing:

```text
sizeShares = min(ALPHA_TARGET_QUOTE_SIZE_USD, ALPHA_MAX_ORDER_SIZE_USD) / quotePrice
notionalUsd = quotePrice * sizeShares
```

Spread-entry sizing:

```text
sizeShares = min(ALPHA_SPREAD_ORDER_SIZE_USD, ALPHA_MAX_ORDER_SIZE_USD) / quotePrice
```

For paper mode, round `sizeShares` down to 6 decimals and persist both `sizeShares` and `notionalUsd`.

Constraints:

```text
- quote must not cross the book
- quote must remain inside spread
- quote must not exceed max order size
- quote must pass risk manager
- quote must respect inventory skew
- ask quote must not sell more shares than paper inventory holds
```

Inventory skew:

```text
If already holding YES:
- reduce or disable YES bid
- make YES ask more competitive to exit

If already holding NO:
- reduce or disable NO bid
- make NO ask more competitive to exit
```

Goal:

```text
Stay flat or near-flat.
```

---

# 16. Paper Trader

Purpose:

```text
Simulate the micro market-making strategy without wallet risk.
```

Paper mode should simulate:

```text
- cash balance
- open paper orders
- paper fills
- positions
- reward eligibility windows
- estimated LP rewards
- realised P&L
- unrealised P&L
- stale order cancellation
- strategy-level stats
```

Use JSON files, no database:

```text
/state/alpha-bot-state.json
/logs/alpha-paper-events.jsonl
```

The Alpha bot store must be independent from the existing Div3rsaFi state file. This JSON store is temporary; it should be easy to migrate to a database later.

Paper state should include:

```text
startingBalance
cash
openOrders
positionsByMarket
realisedPnl
unrealisedPnl
estimatedRewardsUsd
estimatedRewardsByMarket
rewardEligibleSeconds
totalPnl
fills
cancelledOrders
strategyStats
lastUpdated
```

Cash and inventory rules:

```text
- Paper bids reserve cash immediately: reservedUsd = price * sizeShares.
- Filled bids convert reserved cash into YES/NO shares.
- Cancelled/expired bids release unused reserved cash.
- Paper asks are allowed only against existing paper inventory.
- Paper asks reserve shares immediately so the same shares cannot be sold twice.
- No paper shorting.
- No negative cash.
```

---

# 17. Conservative Fill Simulation

Paper fills must be conservative.

A paper bid fills only if the market crosses into it:

```text
Bot YES bid = 0.44
Later best YES ask <= 0.44
=> simulate fill
```

A paper ask fills only if the market crosses into it:

```text
Bot YES ask = 0.48
Later best YES bid >= 0.48
=> simulate fill
```

Do not assume a fill merely because the bot is at best bid or best ask.

Partial fill rules:

```text
- If visible crossed depth is available, fill at most the lesser of remaining paper order size and crossed visible depth.
- If visible crossed depth is unavailable, fill the whole remaining paper order only when crossed.
- Track filledShares and remainingShares on every paper order.
- Leave partially filled orders open until they become stale, are cancelled by risk rules, or fully fill.
```

This avoids overestimating profitability.

Expectations:

```text
- Paper results will likely understate fills.
- That is acceptable.
- Better to be pessimistic before live trading.
```

---

# 18. P&L Tracker

Track:

```text
- starting balance
- current cash
- open exposure
- realised P&L
- unrealised P&L
- estimated LP rewards
- reward-eligible time
- reward markets quoted
- total P&L
- number of fills
- number of cancellations
- markets traded
- win/loss count
- average spread captured
- largest loss
- largest one-sided exposure
- P&L by strategy
- P&L by market
```

Realised P&L:

```text
- Buying YES/NO opens or increases inventory at weighted average cost.
- Selling YES/NO through a simulated ask realises P&L against that outcome's average cost.
- Do not realise P&L merely because the mark moves.
- If future settlement support is added, winning shares realise at 1.00 and losing shares realise at 0.00.
- Split/merge P&L should remain report-only until split/merge execution is explicitly implemented.
```

Reward P&L:

```text
- LP rewards are the primary target, but estimated rewards are not realised trading P&L.
- If Alpha provides actual paid/accrued wallet rewards, report them as actualRewardsUsd.
- If only reward pool and competition data are available, report estimatedRewardsUsd separately.
- Do not add estimatedRewardsUsd into realisedPnl.
- totalEstimatedResult = realisedPnl + unrealisedPnl + estimatedRewardsUsd.
- totalRealisedResult = realisedPnl + actualRewardsUsd, if actualRewardsUsd is available.
```

Mark-to-market:

```text
Use current midpoint where available.
If midpoint is unavailable, mark conservatively:
- YES position marked at best YES bid if selling
- NO position marked at best NO bid if selling
- if no bid exists, mark at 0 for safety
```

Report example:

```text
NUCKELAVEE ALPHA PAPER REPORT

Starting balance: $50.00
Cash: $48.20
Open exposure: $1.80
Realised P&L: +$0.42
Unrealised P&L: -$0.08
Estimated LP rewards: +$0.31
Total trading P&L: +$0.34
Total estimated result: +$0.65

Fills: 9
Cancelled orders: 22
Markets traded: 3
Reward markets quoted: 2
Reward-eligible time: 4h 12m
Avg spread captured: 3.2c
Largest one-sided exposure: $2.00
```

---

# 19. Risk Manager

Every proposed paper/live-dry-run order must pass risk checks.

Hard reject if:

```text
- total exposure would exceed ALPHA_MAX_TOTAL_EXPOSURE_USD
- market exposure would exceed ALPHA_MAX_MARKET_EXPOSURE_USD
- order size exceeds ALPHA_MAX_ORDER_SIZE_USD
- open order count exceeds ALPHA_MAX_OPEN_ORDERS
- market closes too soon
- midpoint outside configured range
- outcome spread below configured minimum
- orderbook source unavailable
- data is stale
- quote would cross the book
- reward quote would sit outside the configured reward zone
- quote would increase already one-sided inventory too much
- ask quote would sell more shares than current paper/live inventory
- bid quote would require more cash than available after existing reserves
```

Risk decision fields:

```text
allowed
reason
riskLevel: low | medium | high
```

No silent risk failures.

Every rejected action must have a readable reason.

---

# 20. Order Lifecycle

Paper and live-dry-run should use the same intended lifecycle.

```text
1. Select top maker candidates.
2. Prefer reward-qualified candidates.
3. Generate quotes inside reward zone when available.
4. Risk-check quotes.
5. Place paper orders or print dry-run intended orders.
6. Track reward eligibility.
7. Monitor market/orderbook.
8. Cancel stale or no-longer-eligible orders.
9. Detect fills.
10. Update positions.
11. Rebalance if inventory becomes one-sided.
```

At the start of each live tick:

```text
- reconcile open wallet orders from Alpha / on-chain data
- keep existing live orders when the intended quote is effectively unchanged
- only cancel or replace when current market state requires a different quote
- spread live slots across markets using ALPHA_MAX_LIVE_ORDERS_PER_MARKET
- skip live submissions when ALGO is below ALPHA_MIN_ALGO_BALANCE
```

Cancel/amend when:

```text
- no reward-qualified or maker-qualified quote exists for that market/outcome/side
- intended quote price moved by more than ALPHA_QUOTE_REFRESH_THRESHOLD_CENTS
- reward eligibility is lost
- outcome spread collapsed below threshold
- market moved near close
- exposure cap would be exceeded
- inventory became too one-sided
```

---

# 21. Live Dry Run

Implement `alpha:live-dry-run`.

It should run the same logic as future live mode but never submit transactions.

Wallet requirement:

```text
- Requires ALPHA_WALLET_ADDRESS.
- Does not require ALPHA_WALLET_MNEMONIC.
- May read open orders and positions for ALPHA_WALLET_ADDRESS.
- Must never sign, submit, cancel, amend, split, merge, or claim.
```

Output:

```text
NUCKELAVEE ALPHA LIVE DRY RUN

Would place:
- Market: <title>
- YES bid 0.44 size $1.00 notional / 2.272727 shares
- YES ask 0.48 size $1.00 notional / 2.083333 shares

Would cancel:
- stale order abc123

Risk:
- market exposure after orders: $2 / $5
- total exposure after orders: $7 / $25
- open orders after actions: 8 / 10
```

Expectations:

```text
- No signing.
- No wallet signing or transaction action.
- No order submission.
- Wallet address is used only for read-only order/position awareness.
- Must be safe to run repeatedly.
```

---

# 22. Live Mode Guardrails

Implement `alpha:live` in this build.

Live trading must use tiny caps and refuse to start unless all guardrails pass.

Live mode must refuse to start unless:

```text
ALPHA_ENABLE_LIVE_TRADING=true
ALPHA_CONFIRM_RISK=true
ALPHA_WALLET_ADDRESS is present
ALPHA_WALLET_MNEMONIC or PAYER_MNEMONIC is present
ALPHA_MAX_TOTAL_EXPOSURE_USD is present
ALPHA_MAX_MARKET_EXPOSURE_USD is present
ALPHA_MAX_ORDER_SIZE_USD is present
ALPHA_MAX_LIVE_OPEN_ORDERS is present
mode is exactly live
```

Startup warning:

```text
LIVE MODE ENABLED

Max total exposure: $10
Max market exposure: $3
Max order size: $1
Max live open orders: 4
Approx ALGO MBR locked per order: 0.957 ALGO

This bot can lose money.
```

Live behaviour:

```text
- Place only risk-approved reward-qualified limit orders.
- Save every returned escrowAppId.
- Cancel stale or no-longer-eligible orders when safe.
- Never place market orders in the first rollout.
```

This prevents accidental live trading while allowing deliberately capped reward-market LP operation.

---

# 23. Command Output Expectations

## alpha:scan

```text
NUCKELAVEE / ALPHA ARCADE

Markets loaded: 128
Tradeable markets: 91
Orderbooks scanned: 25
Source mix:
- websocket: 20
- full REST: 0
- on-chain: 5

Market surface:
- two-sided books: 14
- one-sided books: 7
- empty books: 4
- avg spread: 6.2c

Reward markets:
- reward markets loaded: 12
- top daily reward: $50.00
- best competition: low

Top LP reward candidates:
1. <market title> — $50/day — max spread ±3c — competition medium
2. <market title> — $30/day — max spread ±3c — competition low

Top maker candidates:
1. <market title> — spread 9c — midpoint 0.44
2. <market title> — spread 7c — midpoint 0.58

Parity gaps:
None above threshold

Split/merge candidates:
None above threshold
```

## alpha:rewards

```text
NUCKELAVEE / ALPHA REWARDS

Reward markets loaded: 12

Top LP reward candidates:
1. <market title>
   Daily rewards: $50.00
   Last payout: $2.08
   Competition: Medium
   Max reward spread: ±3c
   Midpoint: 0.505
   Suggested quote: YES bid 0.50 size $1.00 notional / 2.000000 shares

Estimated rewards are not realised P&L.
```

## alpha:watch

```text
[14:31:10] markets=91 rewards=12 books=25 lp=5 maker=5 parity=0 splitMerge=0
Top LP: <slug> daily=$50.00 maxSpread=3c competition=medium midpoint=0.505
```

## alpha:market

```text
ALPHA MARKET DETAIL

Title: <market title>
Slug: <slug>
Status: live
Close: <time>
Category: sports

Orderbook source: websocket
YES bid/ask: 0.42 / 0.50
NO bid/ask: 0.49 / 0.57
Spread: 8c
Midpoint: 0.46

Parity:
YES ask + NO ask = 1.07
YES bid + NO bid = 0.91
No mechanical arb.

Market-making:
Candidate: yes
LP rewards: yes
Daily rewards: $50.00
Competition: Medium
Max reward spread: ±3c
Reason: reward-paying market, quote can sit inside reward zone, two-sided book
```

## alpha:paper-watch

```text
[14:31:10] lpCandidates=5 openOrders=8 rewardEligible=8 fills=0 cash=$50.00 exposure=$0.00 tradingPnl=$0.00 estRewards=$0.02
[14:31:20] lpCandidates=4 openOrders=8 rewardEligible=7 fills=1 cash=$49.00 exposure=$1.00 tradingPnl=$0.00 estRewards=$0.03
```

## alpha:paper-report

```text
NUCKELAVEE ALPHA PAPER REPORT

Starting balance: $50.00
Cash: $48.20
Open exposure: $1.80
Realised P&L: +$0.42
Unrealised P&L: -$0.08
Estimated LP rewards: +$0.31
Total trading P&L: +$0.34
Total estimated result: +$0.65

Fills: 9
Cancelled orders: 22
Markets traded: 3
Reward markets quoted: 2
Reward-eligible time: 4h 12m
Avg spread captured: 3.2c
Largest one-sided exposure: $2.00
```

---

# 24. Success Criteria Before Real Live Trading

Do not enable real trading until paper mode shows:

```text
- at least 24 hours runtime
- no crashes
- reward markets discovered when ALPHA_API_KEY is available
- reward eligibility tracked separately from fills
- estimated LP rewards reported separately from trading P&L
- at least 20 simulated fills
- no runaway exposure
- largest one-sided exposure under configured cap
- positive or near-flat trading P&L before estimated rewards, or clearly positive reward-adjusted estimate with bounded inventory
- evidence of reward-zone compliance
- evidence of actual spread capture as secondary upside
- no repeated “buy high, mark lower” behaviour
```

Initial future live settings should be tiny:

```text
ALPHA_TARGET_QUOTE_SIZE_USD=3
ALPHA_MAX_ORDER_SIZE_USD=3
ALPHA_MAX_MARKET_EXPOSURE_USD=6
ALPHA_MAX_TOTAL_EXPOSURE_USD=12
```

---

# 25. Acceptance Criteria

This Codex task is complete when:

```text
- Alpha module exists independently from Div3rsaFi module
- Alpha scan command works
- Alpha rewards command works or prints a clear ALPHA_API_KEY setup message
- Alpha watch command works
- Alpha market detail command works
- Orderbooks are normalised to decimal 0–1 prices
- Scanner ranks LP reward candidates first
- Scanner ranks maker candidates
- Scanner detects parity gaps if present
- Scanner detects theoretical split/merge opportunities if present
- Paper mode runs with no wallet
- Paper-watch persists state to /state/alpha-bot-state.json
- Paper report prints trading P&L and estimated LP rewards separately
- Risk manager blocks unsafe quotes
- Live-dry-run requires ALPHA_WALLET_ADDRESS, prints intended actions, and submits nothing
- Live mode requires explicit `alpha:live`, ALPHA_ENABLE_LIVE_TRADING=true, and ALPHA_CONFIRM_RISK=true
- Live mode uses ALPHA_WALLET_MNEMONIC or PAYER_MNEMONIC only after guardrails pass
- Live mode enforces tiny caps and ALGO MBR-aware open order cap
- Real trading occurs only through the explicitly gated `alpha:live` command
```

---

# 26. Implementation Notes for Codex

Keep the first implementation boring.

Prefer:

```text
simple
readable
safe
observable
```

Over:

```text
clever
aggressive
fully automated
high performance
```

The desired first outcome is not profit.

The desired first outcome is:

```text
A working Alpha Arcade LP reward radar + conservative paper reward-market maker.
```

Once this shows stable paper behaviour, we can add the real execution layer behind strict caps.

[1]: https://www.npmjs.com/package/%40alpha-arcade/mcp?activeTab=readme&utm_source=chatgpt.com "alpha-arcade/mcp"
[2]: https://mintlify.com/phara23/alpha-sdk/quickstart?utm_source=chatgpt.com "Quickstart - Alpha SDK"
