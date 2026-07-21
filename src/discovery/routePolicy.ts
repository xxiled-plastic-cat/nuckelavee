import { readX402Config, requirementTemplate, type X402Config } from "./x402Config.js";

export type AccessMode = "free" | "paid";

export type RouteId =
  | "health"
  | "discovery"
  | "openapi"
  | "catalog"
  | "opportunities"
  | "market"
  | "quotes"
  | "scan";

export type RouteDefinition = {
  id: RouteId;
  method: "GET";
  /** Path template as advertised to agents (may include `{param}`). */
  path: string;
  /** Exact path or prefix matcher for the HTTP server. */
  match: (pathname: string) => boolean;
  access: AccessMode;
  /** Env-backed price key for paid routes. */
  priceKey?: keyof X402Config["prices"];
  operationId: string;
  summary: string;
  description: string;
};

export const PAYMENT_HEADERS = [
  "PAYMENT-REQUIRED",
  "PAYMENT-SIGNATURE",
  "PAYMENT-RESPONSE",
] as const;

export const ROUTES: RouteDefinition[] = [
  {
    id: "health",
    method: "GET",
    path: "/health",
    match: (pathname) => pathname === "/health" || pathname === "/healthz" || pathname === "/",
    access: "free",
    operationId: "getHealth",
    summary: "Liveness check",
    description: "Ungated health probe for the discovery API.",
  },
  {
    id: "discovery",
    method: "GET",
    path: "/discovery",
    match: (pathname) => pathname === "/discovery",
    access: "free",
    operationId: "getDiscovery",
    summary: "Route access catalog",
    description:
      "Lists free vs paid discovery routes and x402 payment requirement templates. Call this before paid endpoints.",
  },
  {
    id: "openapi",
    method: "GET",
    path: "/openapi.json",
    match: (pathname) => pathname === "/openapi.json",
    access: "free",
    operationId: "getOpenApi",
    summary: "OpenAPI document",
    description: "OpenAPI 3 document with x402 extensions on paid operations.",
  },
  {
    id: "catalog",
    method: "GET",
    path: "/v1/alpha/catalog",
    match: (pathname) => pathname === "/v1/alpha/catalog",
    access: "free",
    operationId: "getAlphaCatalog",
    summary: "Thin Alpha market catalog",
    description:
      "Free teaser list of live Alpha markets (id, slug, title, status, reward flag). No orderbooks, ranks, or quotes.",
  },
  {
    id: "opportunities",
    method: "GET",
    path: "/v1/alpha/opportunities",
    match: (pathname) => pathname === "/v1/alpha/opportunities",
    access: "paid",
    priceKey: "opportunities",
    operationId: "getAlphaOpportunities",
    summary: "Ranked Alpha opportunities",
    description:
      "Paid ranked LP reward, maker/spread, and parity opportunities with confidence and estimated $/day. Preflight may return 402 with PAYMENT-REQUIRED; retry with PAYMENT-SIGNATURE.",
  },
  {
    id: "market",
    method: "GET",
    path: "/v1/alpha/markets/{marketAppId}",
    match: (pathname) => /^\/v1\/alpha\/markets\/\d+$/.test(pathname),
    access: "paid",
    priceKey: "market",
    operationId: "getAlphaMarket",
    summary: "Alpha market deep dive",
    description:
      "Paid single-market detail with normalized book tops and related opportunity slice. Preflight may return 402; retry with PAYMENT-SIGNATURE.",
  },
  {
    id: "quotes",
    method: "GET",
    path: "/v1/alpha/quotes",
    match: (pathname) => pathname === "/v1/alpha/quotes",
    access: "paid",
    priceKey: "quotes",
    operationId: "getAlphaQuotes",
    summary: "Suggested Alpha quotes",
    description:
      "Paid actionable bid/ask suggestions from the quote engine (reward and spread lanes only; no wallet inventory exits). Preflight may return 402; retry with PAYMENT-SIGNATURE.",
  },
  {
    id: "scan",
    method: "GET",
    path: "/v1/alpha/scan",
    match: (pathname) => pathname === "/v1/alpha/scan",
    access: "paid",
    priceKey: "scan",
    operationId: "getAlphaScan",
    summary: "Full Alpha scan summary",
    description:
      "Paid normalized markets plus orderbook tops (mids/spreads/depth summary). Heaviest compute; responses are TTL-cached. Preflight may return 402; retry with PAYMENT-SIGNATURE.",
  },
];

export function findRoute(pathname: string): RouteDefinition | undefined {
  return ROUTES.find((route) => route.match(pathname));
}

export function freePaths(): string[] {
  return ROUTES.filter((route) => route.access === "free").map((route) => route.path);
}

export function paidPaths(): string[] {
  return ROUTES.filter((route) => route.access === "paid").map((route) => route.path);
}

export type DiscoveryDocument = {
  service: string;
  asOf: string;
  publicBaseUrl: string;
  x402: {
    protocolVersion: number;
    facilitatorUrl: string;
    network: string;
    scheme: "exact";
    assetId: string;
    payTo: string;
    headers: typeof PAYMENT_HEADERS;
  };
  routes: Array<{
    id: RouteId;
    method: "GET";
    path: string;
    access: AccessMode;
    operationId: string;
    summary: string;
    description: string;
    x402?: ReturnType<typeof requirementTemplate>;
  }>;
};

export function buildDiscoveryDocument(config: X402Config = readX402Config()): DiscoveryDocument {
  return {
    service: "nuckelavee-discovery-api",
    asOf: new Date().toISOString(),
    publicBaseUrl: config.publicBaseUrl,
    x402: {
      protocolVersion: config.protocolVersion,
      facilitatorUrl: config.facilitatorUrl,
      network: config.network,
      scheme: config.scheme,
      assetId: config.assetId,
      payTo: config.payTo || "<set X402_PAY_TO>",
      headers: PAYMENT_HEADERS,
    },
    routes: ROUTES.map((route) => {
      const base = {
        id: route.id,
        method: route.method,
        path: route.path,
        access: route.access,
        operationId: route.operationId,
        summary: route.summary,
        description: route.description,
      };
      if (route.access !== "paid" || !route.priceKey) return base;
      return {
        ...base,
        x402: requirementTemplate(config, config.prices[route.priceKey]),
      };
    }),
  };
}
