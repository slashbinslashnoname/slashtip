import WebSocket from "ws";
import { loadConfig } from "./config.js";

export interface Invoice {
  bolt11: string;
  paymentHash: string;
  amountSat: number;
}

export interface PaymentReceived {
  paymentHash: string;
  amountSat: number;
}

function basicAuth(): string {
  const c = loadConfig();
  return "Basic " + Buffer.from(`:${c.phoenixdPassword}`).toString("base64");
}

export async function createInvoice(amountSat: number): Promise<Invoice> {
  const c = loadConfig();
  const body = new URLSearchParams({
    amountSat: String(amountSat),
    description: c.invoiceDescription,
    expirySeconds: String(c.invoiceExpirySeconds),
  });
  const res = await fetch(`${c.phoenixdUrl}/createinvoice`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`createinvoice ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    serialized: string;
    paymentHash: string;
    amountSat?: number;
  };
  return {
    bolt11: json.serialized,
    paymentHash: json.paymentHash,
    amountSat: json.amountSat ?? amountSat,
  };
}

export type PaymentListener = (event: PaymentReceived) => void;

export function watchPayments(onPayment: PaymentListener): () => void {
  let stopped = false;
  let ws: WebSocket | null = null;
  let backoff = 1_000;
  const wsUrl =
    loadConfig()
      .phoenixdUrl.replace(/^http/, "ws")
      .replace(/^wss?/, (m) => (m === "https" ? "wss" : m)) + "/websocket";

  const connect = () => {
    if (stopped) return;
    ws = new WebSocket(wsUrl, { headers: { Authorization: basicAuth() } });

    ws.on("open", () => {
      backoff = 1_000;
      console.log(`[phoenix] websocket open ${wsUrl}`);
    });

    ws.on("message", (raw) => {
      let evt: unknown;
      try {
        evt = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (
        typeof evt === "object" &&
        evt !== null &&
        (evt as { type?: string }).type === "payment_received"
      ) {
        const e = evt as { paymentHash: string; amountSat: number };
        onPayment({ paymentHash: e.paymentHash, amountSat: Number(e.amountSat) });
      }
    });

    const reconnect = (reason: string) => {
      if (stopped) return;
      console.warn(`[phoenix] websocket ${reason}; reconnecting in ${backoff}ms`);
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 30_000);
    };

    ws.on("close", () => reconnect("closed"));
    ws.on("error", (err) => reconnect(`error: ${err.message}`));
  };

  connect();
  return () => {
    stopped = true;
    ws?.close();
  };
}
