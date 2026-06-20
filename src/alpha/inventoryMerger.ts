import type { WalletPosition } from "@alpha-arcade/sdk";

import type { AlphaConfig, AlphaMode } from "./alphaConfig.js";
import { AlphaSdkClient, fromMicroUnits } from "./alphaClient.js";
import { saveAlphaState } from "./alphaStateStore.js";
import type { AlphaBotState, AlphaPaperPosition } from "./alphaTypes.js";

type MergeMode = Extract<AlphaMode, "live-dry-run" | "live">;

export type MergeAction = {
  kind: "merge" | "skip";
  message: string;
};

function findStatePositionByAppId(state: AlphaBotState, marketAppId: number): AlphaPaperPosition | undefined {
  return Object.values(state.positionsByMarket).find((position) => position.marketAppId === marketAppId);
}

function fmtUsd(value: number): string {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(4)}`;
}

function applyMergeToState(state: AlphaBotState, marketAppId: number, sets: number): number {
  const position = findStatePositionByAppId(state, marketAppId);
  if (!position) return 0;
  const avgYesCost = position.avgYesCost ?? 0;
  const avgNoCost = position.avgNoCost ?? 0;
  const realised = (1 - avgYesCost - avgNoCost) * sets;
  position.yesShares = Math.max(0, position.yesShares - sets);
  position.noShares = Math.max(0, position.noShares - sets);
  if (position.yesShares <= 1e-6) {
    position.yesShares = 0;
    position.avgYesCost = 0;
  }
  if (position.noShares <= 1e-6) {
    position.noShares = 0;
    position.avgNoCost = 0;
  }
  position.realisedPnl += realised;
  state.realisedPnl += realised;
  return realised;
}

/**
 * Recover capital from inventory holding both YES and NO of the same market.
 * Each matched YES+NO set merges back into exactly $1 of USDC with no market
 * interaction, so this is risk-free and should run before any new placement.
 */
export async function runInventoryMergeLane(input: {
  liveClient: AlphaSdkClient;
  config: AlphaConfig;
  mode: MergeMode;
  walletPositions: WalletPosition[];
  state: AlphaBotState;
}): Promise<MergeAction[]> {
  const { liveClient, config, mode, walletPositions, state } = input;
  if (!config.enableInventoryMerge) {
    return [{ kind: "skip", message: "Inventory merge disabled (ALPHA_ENABLE_INVENTORY_MERGE=false)" }];
  }
  const actions: MergeAction[] = [];
  const minShares = Math.max(0, config.inventoryMergeMinShares);

  for (const position of walletPositions) {
    const yesShares = fromMicroUnits(position.yesBalance) ?? 0;
    const noShares = fromMicroUnits(position.noBalance) ?? 0;
    const sets = Math.min(yesShares, noShares);
    if (sets <= 0 || sets < minShares) continue;

    let resolved = false;
    try {
      const resolution = await liveClient.getMarketResolution(position.marketAppId);
      resolved = resolution.isResolved === true;
    } catch {
      resolved = false;
    }
    if (resolved) {
      // Resolved markets cannot merge; the resolved claim lane recovers these.
      continue;
    }

    const title = position.title || `market ${position.marketAppId}`;
    if (mode === "live-dry-run") {
      actions.push({
        kind: "merge",
        message: `Would merge ${sets.toFixed(6)} set(s) ($${sets.toFixed(2)}) of ${title} back to USDC`,
      });
      continue;
    }

    try {
      const result = await liveClient.mergeShares({ marketAppId: position.marketAppId, amountShares: sets });
      const realised = applyMergeToState(state, position.marketAppId, sets);
      await saveAlphaState(config.stateKey, state);
      actions.push({
        kind: "merge",
        message: `Merged ${sets.toFixed(6)} set(s) ($${sets.toFixed(2)}) of ${title} back to USDC; realised=${fmtUsd(
          realised,
        )} txIds=${result.txIds.join(",")}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[alpha-live] inventory merge failed market=${position.marketAppId}: ${message}`);
      actions.push({ kind: "skip", message: `Inventory merge failed ${title}: ${message}` });
    }
  }

  return actions;
}
