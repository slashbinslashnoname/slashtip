import { AMOUNT_PRESETS_SAT, loadConfig } from "./config.js";
import { createInvoice, watchPayments, type Invoice } from "./phoenix.js";
import { St7789 } from "./display/st7789.js";
import {
  renderError,
  renderExpired,
  renderIdle,
  renderInvoice,
  renderPaid,
  renderSelect,
} from "./display/render.js";
import { WhisplayButton } from "./hardware/button.js";
import { RgbLed } from "./hardware/rgbled.js";
import { play } from "./hardware/audio.js";

type State =
  | { kind: "idle" }
  | { kind: "selecting"; index: number }
  | { kind: "invoice"; invoice: Invoice; expiresAt: number; tickerId: NodeJS.Timeout }
  | { kind: "paid"; amountSat: number }
  | { kind: "expired" }
  | { kind: "error"; message: string };

const SCREEN_SAVE_MS = 60_000;

export class App {
  private lcd = new St7789();
  private led = new RgbLed();
  private button = new WhisplayButton();
  private state: State = { kind: "idle" };
  private stopWs: (() => void) | null = null;
  private lastInteraction = Date.now();
  private screenOff = false;

  async start(): Promise<void> {
    await this.lcd.init();
    await this.transition({ kind: "idle" });

    this.button.on("tap", () => this.onTap());
    this.button.on("long", () => this.onLong());

    this.stopWs = watchPayments((evt) => this.onPayment(evt.paymentHash, evt.amountSat));

    setInterval(() => this.checkScreenSave(), 5_000);

    process.on("SIGINT", () => this.shutdown());
    process.on("SIGTERM", () => this.shutdown());
  }

  private checkScreenSave(): void {
    if (this.screenOff) return;
    if (this.state.kind !== "idle") return;
    if (Date.now() - this.lastInteraction < SCREEN_SAVE_MS) return;
    console.log("[app] screen save -> backlight off");
    this.screenOff = true;
    this.lcd.setBacklight(false);
    this.led.off();
  }

  private wakeIfAsleep(): boolean {
    if (!this.screenOff) return false;
    console.log("[app] wake -> backlight on");
    this.screenOff = false;
    this.lcd.setBacklight(true);
    this.led.idle();
    this.lastInteraction = Date.now();
    return true;
  }

  private async onTap(): Promise<void> {
    this.lastInteraction = Date.now();
    if (this.wakeIfAsleep()) return; // first tap from sleep just wakes
    switch (this.state.kind) {
      case "idle":
        await this.transition({ kind: "selecting", index: 0 });
        break;
      case "selecting": {
        const next = this.state.index + 1;
        if (next >= AMOUNT_PRESETS_SAT.length) {
          await this.transition({ kind: "idle" });
        } else {
          await this.transition({ kind: "selecting", index: next });
        }
        break;
      }
      case "invoice":
      case "paid":
      case "expired":
      case "error":
        await this.transition({ kind: "idle" });
        break;
    }
  }

  private async onLong(): Promise<void> {
    this.lastInteraction = Date.now();
    if (this.wakeIfAsleep()) return;
    if (this.state.kind !== "selecting") return;
    const amount = AMOUNT_PRESETS_SAT[this.state.index]!;
    try {
      const invoice = await createInvoice(amount);
      const expiresAt = Date.now() + loadConfig().invoiceExpirySeconds * 1_000;
      const ticker = setInterval(() => this.tickInvoice(), 1_000);
      await this.transition({ kind: "invoice", invoice, expiresAt, tickerId: ticker });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[app] createInvoice failed:", message);
      await this.transition({ kind: "error", message });
      setTimeout(() => {
        if (this.state.kind === "error") void this.transition({ kind: "idle" });
      }, 3_000);
    }
  }

  private async tickInvoice(): Promise<void> {
    if (this.state.kind !== "invoice") return;
    const remaining = (this.state.expiresAt - Date.now()) / 1_000;
    if (remaining <= 0) {
      clearInterval(this.state.tickerId);
      await this.transition({ kind: "expired" });
      play("expired");
      setTimeout(() => {
        if (this.state.kind === "expired") void this.transition({ kind: "idle" });
      }, 3_000);
      return;
    }
    // Re-render to update countdown
    const frame = await renderInvoice(
      this.state.invoice.bolt11,
      this.state.invoice.amountSat,
      remaining,
    );
    await this.lcd.drawFrame(frame);
  }

  private onPayment(paymentHash: string, amountSat: number): void {
    if (this.state.kind !== "invoice") return;
    if (this.state.invoice.paymentHash !== paymentHash) return;
    clearInterval(this.state.tickerId);
    void this.transition({ kind: "paid", amountSat }).then(() => {
      play("paid");
      setTimeout(() => {
        if (this.state.kind === "paid") void this.transition({ kind: "idle" });
      }, 4_000);
    });
  }

  private async transition(next: State): Promise<void> {
    if (this.state.kind === "invoice" && next.kind !== "invoice") {
      clearInterval(this.state.tickerId);
    }
    console.log(`[app] -> ${next.kind}${next.kind === "selecting" ? ` idx=${next.index} (${AMOUNT_PRESETS_SAT[next.index]} sat)` : ""}${next.kind === "paid" ? ` amount=${next.amountSat}` : ""}${next.kind === "error" ? ` msg=${next.message}` : ""}`);
    this.state = next;

    switch (next.kind) {
      case "idle":
        this.led.idle();
        await this.lcd.drawFrame(renderIdle());
        break;
      case "selecting":
        this.led.selecting();
        await this.lcd.drawFrame(
          renderSelect(
            AMOUNT_PRESETS_SAT[next.index]!,
            next.index,
            AMOUNT_PRESETS_SAT.length,
          ),
        );
        break;
      case "invoice":
        this.led.waitingPayment();
        await this.lcd.drawFrame(
          await renderInvoice(
            next.invoice.bolt11,
            next.invoice.amountSat,
            loadConfig().invoiceExpirySeconds,
          ),
        );
        break;
      case "paid":
        this.led.paid();
        await this.lcd.drawFrame(renderPaid(next.amountSat));
        break;
      case "expired":
        this.led.expired();
        await this.lcd.drawFrame(renderExpired());
        break;
      case "error":
        this.led.expired();
        await this.lcd.drawFrame(renderError(next.message));
        break;
    }
  }

  private shutdown(): void {
    console.log("[app] shutting down");
    this.stopWs?.();
    this.led.off();
    this.lcd.close();
    process.exit(0);
  }
}
