import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const AMOUNT_PRESETS_SAT = [100, 1_000, 10_000, 100_000] as const;
export type AmountPreset = (typeof AMOUNT_PRESETS_SAT)[number];

export interface Config {
  phoenixdUrl: string;
  phoenixdPassword: string;
  invoiceExpirySeconds: number;
  invoiceDescription: string;
  logLevel: string;
}

let cached: Config | null = null;

export function loadConfig(): Config {
  if (cached) return cached;
  const sudoHome = process.env.SUDO_USER
    ? `/home/${process.env.SUDO_USER}`
    : null;
  const candidates = [
    join(homedir(), ".phoenix-pos", ".env"),
    ...(sudoHome ? [join(sudoHome, ".phoenix-pos", ".env")] : []),
    join(process.cwd(), ".env"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      loadEnv({ path });
      break;
    }
  }

  const required = (name: string): string => {
    const v = process.env[name];
    if (!v) throw new Error(`${name} is required (set in ~/.phoenix-pos/.env)`);
    return v;
  };

  cached = {
    phoenixdUrl: required("PHOENIXD_URL").replace(/\/+$/, ""),
    phoenixdPassword: required("PHOENIXD_PASSWORD"),
    invoiceExpirySeconds: Number(process.env.INVOICE_EXPIRY_SECONDS ?? 300),
    invoiceDescription: process.env.INVOICE_DESCRIPTION ?? "slashbin POS",
    logLevel: process.env.LOG_LEVEL ?? "info",
  };
  return cached;
}
