const DEBUG_TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

export function isDebugModeEnabled(): boolean {
  const raw = process.env.DEBUG_MODE;
  if (!raw) return false;
  return DEBUG_TRUE_VALUES.has(raw.toLowerCase());
}
