import gpiox from "@iiot2k/gpiox";
import { EventEmitter } from "node:events";

const { init_gpio, get_gpio, GPIO_MODE_INPUT_PULLDOWN } = gpiox;

const BUTTON_PIN = 17; // BCM 17 (BOARD pin 11) on WhisPlay HAT
const POLL_MS = 10;
const STABLE_TICKS = 3; // 30ms confirmed level → debounces tactile bounce
const LONG_PRESS_MS = 500;
const DEBOUNCE_US = 5_000;
const DEBUG = process.env.BUTTON_DEBUG === "1";

export type ButtonEvent = "tap" | "long";

/**
 * Polled, debounced button driver for the WhisPlay HAT (GPIO 17, active-high
 * per Waveshare wiring). Polling + consecutive-sample debounce + the kernel
 * libgpiod glitch filter give a chatter-proof tap/long detector.
 */
export class WhisplayButton extends EventEmitter {
  private stableLevel = 0;
  private candidateLevel = 0;
  private candidateCount = 0;
  private pressStart: number | null = null;
  private longEmitted = false;

  constructor() {
    super();
    init_gpio(BUTTON_PIN, GPIO_MODE_INPUT_PULLDOWN, DEBOUNCE_US);
    setInterval(() => this.tick(), POLL_MS);
  }

  private tick(): void {
    const lvl = get_gpio(BUTTON_PIN) ? 1 : 0;

    if (lvl === this.candidateLevel) {
      this.candidateCount++;
    } else {
      this.candidateLevel = lvl;
      this.candidateCount = 1;
    }

    if (
      this.candidateLevel !== this.stableLevel &&
      this.candidateCount >= STABLE_TICKS
    ) {
      const prev = this.stableLevel;
      this.stableLevel = this.candidateLevel;

      if (this.stableLevel === 1 && prev === 0) {
        this.pressStart = Date.now();
        this.longEmitted = false;
        if (DEBUG) console.log("[btn] PRESS");
      } else if (this.stableLevel === 0 && prev === 1) {
        const held = this.pressStart ? Date.now() - this.pressStart : 0;
        if (DEBUG)
          console.log(
            `[btn] RELEASE held=${held}ms longEmitted=${this.longEmitted}`,
          );
        if (this.pressStart && !this.longEmitted) {
          this.emit("tap" satisfies ButtonEvent);
        }
        this.pressStart = null;
      }
    }

    if (
      this.stableLevel === 1 &&
      this.pressStart &&
      !this.longEmitted &&
      Date.now() - this.pressStart >= LONG_PRESS_MS
    ) {
      this.longEmitted = true;
      if (DEBUG)
        console.log(`[btn] LONG (held ${Date.now() - this.pressStart}ms)`);
      this.emit("long" satisfies ButtonEvent);
    }
  }
}
