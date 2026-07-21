export type X402Config = {
  protocolVersion: number;
  network: string;
  scheme: "exact";
  assetId: string;
  payTo: string;
  facilitatorUrl: string;
  publicBaseUrl: string;
  scanCacheTtlMs: number;
  prices: {
    opportunities: string;
    market: string;
    quotes: string;
    scan: string;
  };
};

function readString(name: string, fallback: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return fallback;
  return value.trim();
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/** Convert a decimal USDC price string (e.g. "0.05") to micro-USDC integer string. */
export function usdcToMicroUsdc(priceUsdc: string): string {
  const normalized = priceUsdc.trim().replace(/^\$/, "");
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid USDC price: ${priceUsdc}`);
  }
  return String(Math.round(value * 1_000_000));
}

export function readX402Config(): X402Config {
  return {
    protocolVersion: readPositiveInt("X402_PROTOCOL_VERSION", 2),
    network: readString("X402_NETWORK", "algorand-mainnet"),
    scheme: "exact",
    assetId: readString("X402_USDC_ASSET_ID", process.env.ALPHA_USDC_ASSET_ID || "31566704"),
    payTo: readString("X402_PAY_TO", ""),
    facilitatorUrl: readString("X402_FACILITATOR_URL", "https://facilitator.goplausible.xyz"),
    publicBaseUrl: readString("X402_PUBLIC_BASE_URL", "http://127.0.0.1:8788"),
    scanCacheTtlMs: readPositiveInt("DISCOVERY_SCAN_CACHE_TTL_MS", 30_000),
    prices: {
      opportunities: readString("X402_PRICE_OPPORTUNITIES", "0.05"),
      market: readString("X402_PRICE_MARKET", "0.02"),
      quotes: readString("X402_PRICE_QUOTES", "0.08"),
      scan: readString("X402_PRICE_SCAN", "0.15"),
    },
  };
}

export function requirementTemplate(config: X402Config, priceUsdc: string) {
  return {
    scheme: config.scheme,
    network: config.network,
    asset: config.assetId,
    payTo: config.payTo || "<set X402_PAY_TO>",
    maxAmountRequired: usdcToMicroUsdc(priceUsdc),
    maxAmountRequiredUnit: "micro-USDC",
    priceUsdc: priceUsdc.replace(/^\$/, ""),
  };
}
