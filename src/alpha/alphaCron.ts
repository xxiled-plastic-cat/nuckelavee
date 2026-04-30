import { spawn } from "node:child_process";

import cron from "node-cron";
import dotenv from "dotenv";

dotenv.config();

const schedule = process.env.ALPHA_CRON_SCHEDULE || "*/2 * * * *";
const command = process.env.ALPHA_CRON_COMMAND || "npm run alpha:live";
const once = process.argv.includes("--once");

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

async function main(): Promise<void> {
  if (once) {
    const code = await runTick();
    process.exitCode = code;
    return;
  }
  if (!cron.validate(schedule)) {
    throw new Error(`Invalid ALPHA_CRON_SCHEDULE: ${schedule}`);
  }
  let running = false;
  console.log(`NUCKELAVEE ALPHA CRON`);
  console.log(`Schedule: ${schedule}`);
  console.log(`Command: ${command}`);
  cron.schedule(schedule, async () => {
    if (running) {
      console.log(`[${new Date().toISOString()}] previous tick still running; skipping this schedule`);
      return;
    }
    running = true;
    console.log(`[${new Date().toISOString()}] cron tick start`);
    const exitCode = await runTick();
    console.log(`[${new Date().toISOString()}] cron tick end exit_code=${exitCode}`);
    running = false;
  });
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
