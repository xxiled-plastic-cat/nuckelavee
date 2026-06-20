import type { WalletPosition } from "@alpha-arcade/sdk";

import type { AlphaConfig, AlphaMode } from "./alphaConfig.js";
import { AlphaSdkClient, fromMicroUnits, type MarketChainStatus } from "./alphaClient.js";
import { saveAlphaState } from "./alphaStateStore.js";
import type { AlphaBotState, AlphaPaperPosition } from "./alphaTypes.js";

type ClaimMode = Extract<AlphaMode, "live-dry-run" | "live">;

export type ClaimAction = {
  kind: "claim" | "skip";
  message: string;
};

function fmtUsd(value: number): string {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(4)}`;
}

function findStatePositionEntry(
  state: AlphaBotState,
  marketAppId: number,
): { key: string; position: AlphaPaperPosition } | undefined {
  for (const [key, position] of Object.entries(state.positionsByMarket)) {
    if (position.marketAppId === marketAppId) return { key, position };
  }
  return undefined;
}

/**
 * USDC received for redeeming a winning side; losing sides burn for nothing.
 * outcome === 1 means YES resolved true, outcome === 0 means NO resolved true.
 * For any other (e.g. voided) outcome we cannot reliably value the redemption,
 * so we still claim but leave realised PnL untouched.
 */
function usdcForSide(outcome: number | undefined, side: "YES" | "NO", shares: number): number | undefined {
  if (outcome === 1) return side === "YES" ? shares : 0;
  if (outcome === 0) return side === "NO" ? shares : 0;
  return undefined;
}

export async function runResolvedClaimLane(input: {
  liveClient: AlphaSdkClient;
  config: AlphaConfig;
  mode: ClaimMode;
  walletPositions: WalletPosition[];
  state: AlphaBotState;
}): Promise<ClaimAction[]> {
  const { liveClient, config, mode, walletPositions, state } = input;
  if (!config.enableResolvedClaim) {
    return [{ kind: "skip", message: "Resolved claim disabled (ALPHA_ENABLE_RESOLVED_CLAIM=false)" }];
  }
  const actions: ClaimAction[] = [];

  for (const position of walletPositions) {
    const yesShares = fromMicroUnits(position.yesBalance) ?? 0;
    const noShares = fromMicroUnits(position.noBalance) ?? 0;
    if (yesShares <= 0 && noShares <= 0) continue;

    let resolution: MarketChainStatus;
    try {
      resolution = await liveClient.getMarketResolution(position.marketAppId);
    } catch {
      continue;
    }
    if (resolution.isResolved !== true) continue;

    const title = position.title || `market ${position.marketAppId}`;
    const outcome = resolution.outcome;
    const sides: Array<{ side: "YES" | "NO"; assetId: number; shares: number }> = [];
    if (yesShares > 0) sides.push({ side: "YES", assetId: position.yesAssetId, shares: yesShares });
    if (noShares > 0) sides.push({ side: "NO", assetId: position.noAssetId, shares: noShares });

    for (const { side, assetId, shares } of sides) {
      if (mode === "live-dry-run") {
        const usdc = usdcForSide(outcome, side, shares);
        actions.push({
          kind: "claim",
          message: `Would claim ${shares.toFixed(6)} ${side} share(s) of resolved ${title}${
            usdc !== undefined ? ` (~$${usdc.toFixed(2)} USDC)` : ""
          }`,
        });
        continue;
      }

      try {
        const result = await liveClient.claim({ marketAppId: position.marketAppId, assetId });
        const usdc = usdcForSide(outcome, side, shares);
        let realised: number | undefined;
        const entry = findStatePositionEntry(state, position.marketAppId);
        if (entry) {
          const avgCost = side === "YES" ? entry.position.avgYesCost ?? 0 : entry.position.avgNoCost ?? 0;
          if (usdc !== undefined) {
            realised = usdc - shares * avgCost;
            entry.position.realisedPnl += realised;
            state.realisedPnl += realised;
          }
          if (side === "YES") {
            entry.position.yesShares = 0;
            entry.position.avgYesCost = 0;
          } else {
            entry.position.noShares = 0;
            entry.position.avgNoCost = 0;
          }
          if (entry.position.yesShares <= 1e-6 && entry.position.noShares <= 1e-6) {
            delete state.positionsByMarket[entry.key];
          }
        }
        await saveAlphaState(config.stateKey, state);
        actions.push({
          kind: "claim",
          message: `Claimed ${shares.toFixed(6)} ${side} share(s) of resolved ${title}${
            realised !== undefined ? `; realised=${fmtUsd(realised)}` : ""
          } txIds=${result.txIds.join(",")}`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[alpha-live] resolved claim failed market=${position.marketAppId} side=${side}: ${message}`);
        actions.push({ kind: "skip", message: `Resolved claim failed ${title} ${side}: ${message}` });
      }
    }
  }

  return actions;
}
