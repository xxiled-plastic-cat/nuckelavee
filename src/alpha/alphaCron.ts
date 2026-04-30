import { spawn } from "node:child_process";
import { createServer } from "node:http";

import cron from "node-cron";
import dotenv from "dotenv";

dotenv.config();

const schedule = process.env.ALPHA_CRON_SCHEDULE || "*/2 * * * *";
const command = process.env.ALPHA_CRON_COMMAND || "npm run alpha:live";
const once = process.argv.includes("--once");
const healthPort = Number.parseInt(process.env.PORT || process.env.ALPHA_HEALTH_PORT || "", 10);
let running = false;
let lastTickStartedAt: string | undefined;
let lastTickEndedAt: string | undefined;
let lastTickExitCode: number | undefined;

function runTick(): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: true,
      env: process.env,
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function startHealthServer(): void {
  if (!Number.isFinite(healthPort)) return;
  const server = createServer((request, response) => {
    const path = request.url?.split("?")[0] ?? "/";
    if (path !== "/" && path !== "/health" && path !== "/healthz" && path !== "/ready") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: "not_found" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ok: true,
        service: "nuckelavee-alpha-cron",
        schedule,
        command,
        running,
        lastTickStartedAt,
        lastTickEndedAt,
        lastTickExitCode,
      }),
    );
  });
  server.listen(healthPort, "0.0.0.0", () => {
    console.log(`Health server listening on 0.0.0.0:${healthPort}`);
  });
}

async function main(): Promise<void> {
  if (once) {
    const code = await runTick();
    process.exitCode = code;
    return;
  }
  if (!cron.validate(schedule)) {
    throw new Error(`Invalid ALPHA_CRON_SCHEDULE: ${schedule}`);
  }
  console.log(`NUCKELAVEE ALPHA CRON`);
  console.log(`Schedule: ${schedule}`);
  console.log(`Command: ${command}`);
  startHealthServer();
  cron.schedule(schedule, async () => {
    if (running) {
      console.log(`[${new Date().toISOString()}] previous tick still running; skipping this schedule`);
      return;
    }
    running = true;
    lastTickStartedAt = new Date().toISOString();
    console.log(`[${lastTickStartedAt}] cron tick start`);
    const exitCode = await runTick();
    lastTickEndedAt = new Date().toISOString();
    lastTickExitCode = exitCode;
    console.log(`[${lastTickEndedAt}] cron tick end exit_code=${exitCode}`);
    running = false;
  });
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
