# nuckelavee

Div3rsaFi scanner and execution-aware liquidity controller.

## Install

```bash
npm install
cp .env.example .env
```

## Commands

```bash
npm run scan
npm run watch
npm run tick-exec
npm run watch-exec
npm run typecheck
```

Alpha module:

```bash
npm run alpha:scan
npm run alpha:rewards
npm run alpha:paper
npm run alpha:paper-report
npm run alpha:live-dry-run
npm run alpha:live
```

Cron runner:

```bash
# Uses ALPHA_CRON_SCHEDULE and ALPHA_CRON_COMMAND from env.
# Defaults to live trading.
npm run alpha:cron

# Common presets
npm run alpha:cron:paper
npm run alpha:cron:live-dry-run
npm run alpha:cron:live
npm run alpha:cron:live:once

# One-shot execution for smoke tests
npm run alpha:cron -- --once
```

Optional filter:

```bash
npm run scan -- --underlying BTC
npm run watch -- --underlying ETH
npm run tick-exec -- --underlying BTC
```

The scan output now includes:

- `MAKER CANDIDATE`: markets with existing two-sided liquidity worth improving.
- `LIQUIDITY SIGNAL`: concrete quote-opening ideas, including thin-book seed opportunities, with suggested YES/NO quote levels and an explanation of why.

## Execution Modes

`tick-exec` runs one target-selection/requote cycle. `watch-exec` runs the same cycle every `TICK_INTERVAL_MS` (default 60 seconds).

State is persisted to a JSON file in the repo by default:

```env
BOT_STATE_PATH=state/bot-state.json
```

This keeps state tracked in the main project as requested. Runtime logs/temp files remain under `.nuckelavee/` and are ignored.

Execution defaults to paper mode:

```env
EXECUTION_MODE=paper
ENABLE_LIVE_TRADING=false
```

Live mode requires both:

```env
EXECUTION_MODE=live
ENABLE_LIVE_TRADING=true
PAYER_MNEMONIC="word1 word2 ... word25"
```

Use a dedicated hot bot wallet only. The mnemonic is never logged; only the public address is derived for signing and matching own orders. The executor follows the official SDK example pattern: `algosdk.mnemonicToSecretKey`, `getNextOrderId`, `buildPlaceOrderTxns`, `buildCancelOrderTxn`, `sendRawTransaction`, and `waitForConfirmation`.

For DigitalOcean App Platform worker deployment, configure the worker command in the dashboard as:

```bash
npm run alpha:cron:live
```

Set these runtime env vars in App Platform:

```env
DATABASE_URL=
ALPHA_API_KEY=
PAYER_MNEMONIC=
ALPHA_ENABLE_LIVE_TRADING=true
ALPHA_CONFIRM_RISK=true
ALPHA_CRON_SCHEDULE=*/2 * * * *
ALPHA_CRON_COMMAND=npm run alpha:live
ALPHA_MAX_ORDER_SIZE_USD=1
ALPHA_MAX_MARKET_EXPOSURE_USD=3
ALPHA_MAX_TOTAL_EXPOSURE_USD=10
ALPHA_MAX_LIVE_OPEN_ORDERS=4
```