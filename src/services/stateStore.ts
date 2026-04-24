import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { BotState } from "../types/execution.js";

export function emptyBotState(): BotState {
  return { moveHistory: [] };
}

export async function loadBotState(path: string): Promise<BotState> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as BotState;
    return {
      activeTarget: parsed.activeTarget,
      moveHistory: Array.isArray(parsed.moveHistory) ? parsed.moveHistory : [],
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return emptyBotState();
    }
    throw error;
  }
}

export async function saveBotState(path: string, state: BotState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
