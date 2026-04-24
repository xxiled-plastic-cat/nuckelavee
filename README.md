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

For DigitalOcean worker deployment (non-serverless), run `npm run watch-exec` in a single worker process with the project directory writable so `state/bot-state.json` can be updated.