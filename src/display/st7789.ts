import spiDevice from "spi-device";
import gpiox from "@iiot2k/gpiox";
import { promisify } from "node:util";

const { open: openSpi } = spiDevice;
const {
  init_gpio,
  set_gpio,
  GPIO_MODE_OUTPUT,
} = gpiox;
type SpiDevice = ReturnType<typeof spiDevice.open>;

/**
 * ST7789V2 driver for the Waveshare WhisPlay HAT (240x280 panel, 180° rotated
 * via MADCTL=0xC0, with a 20-row Y offset because the chip's RAM is 240x320).
 *
 * Pinout (BCM): DC=27, RST=4, BL=22 (active-low). SPI0.0 CE0=GPIO8.
 * Init sequence taken verbatim from Waveshare's WhisPlay.py to guarantee panel
 * compatibility.
 */

export const LCD_WIDTH = 240;
export const LCD_HEIGHT = 280;

const DC_PIN = 27;
const RST_PIN = 4;
const BL_PIN = 22;
const Y_OFFSET = 20;
const SPI_SPEED_HZ = 32_000_000;

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class St7789 {
  private spi!: SpiDevice;
  private spiTransfer!: (
    m: { sendBuffer: Buffer; byteLength: number }[],
  ) => Promise<void>;

  async init(): Promise<void> {
    init_gpio(DC_PIN, GPIO_MODE_OUTPUT, 0);
    init_gpio(RST_PIN, GPIO_MODE_OUTPUT, 0);
    init_gpio(BL_PIN, GPIO_MODE_OUTPUT, 1); // active-low → 1 = off during init

    await new Promise<void>((resolve, reject) => {
      this.spi = openSpi(0, 0, { mode: 0, maxSpeedHz: SPI_SPEED_HZ }, (err) =>
        err ? reject(err) : resolve(),
      );
    });
    this.spiTransfer = promisify(this.spi.transfer.bind(this.spi)) as never;

    await this.resetPanel();
    await this.initPanel();
    set_gpio(BL_PIN, 0); // backlight on
  }

  setBacklight(on: boolean): void {
    set_gpio(BL_PIN, on ? 0 : 1);
  }

  private async resetPanel(): Promise<void> {
    set_gpio(RST_PIN, 1);
    await sleepMs(100);
    set_gpio(RST_PIN, 0);
    await sleepMs(100);
    set_gpio(RST_PIN, 1);
    await sleepMs(120);
  }

  private async cmd(cmd: number, ...args: number[]): Promise<void> {
    set_gpio(DC_PIN, 0);
    await this.write(Buffer.from([cmd]));
    if (args.length) {
      set_gpio(DC_PIN, 1);
      await this.write(Buffer.from(args));
    }
  }

  private async write(buf: Buffer): Promise<void> {
    const MAX = 4096;
    for (let off = 0; off < buf.length; off += MAX) {
      const slice = buf.subarray(off, Math.min(off + MAX, buf.length));
      await this.spiTransfer([
        { sendBuffer: slice, byteLength: slice.length },
      ]);
    }
  }

  private async initPanel(): Promise<void> {
    await this.cmd(0x11); // sleep out
    await sleepMs(120);
    await this.cmd(0x36, 0xc0); // MADCTL: MY+MX (180° rotation)
    await this.cmd(0x3a, 0x05); // COLMOD: 16bpp RGB565
    await this.cmd(0xb2, 0x0c, 0x0c, 0x00, 0x33, 0x33);
    await this.cmd(0xb7, 0x35);
    await this.cmd(0xbb, 0x32);
    await this.cmd(0xc2, 0x01);
    await this.cmd(0xc3, 0x15);
    await this.cmd(0xc4, 0x20);
    await this.cmd(0xc6, 0x0f);
    await this.cmd(0xd0, 0xa4, 0xa1);
    await this.cmd(
      0xe0,
      0xd0, 0x08, 0x0e, 0x09, 0x09, 0x05, 0x31, 0x33, 0x48, 0x17, 0x14, 0x15, 0x31, 0x34,
    );
    await this.cmd(
      0xe1,
      0xd0, 0x08, 0x0e, 0x09, 0x09, 0x15, 0x31, 0x33, 0x48, 0x17, 0x14, 0x15, 0x31, 0x34,
    );
    await this.cmd(0x21); // invert on
    await this.cmd(0x29); // display on
  }

  private async setWindow(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): Promise<void> {
    await this.cmd(0x2a, x0 >> 8, x0 & 0xff, x1 >> 8, x1 & 0xff);
    const ya = y0 + Y_OFFSET;
    const yb = y1 + Y_OFFSET;
    await this.cmd(0x2b, ya >> 8, ya & 0xff, yb >> 8, yb & 0xff);
    await this.cmd(0x2c);
  }

  /** Push a full framebuffer (RGB565 big-endian, LCD_WIDTH*LCD_HEIGHT*2 bytes). */
  async drawFrame(rgb565: Buffer): Promise<void> {
    if (rgb565.length !== LCD_WIDTH * LCD_HEIGHT * 2) {
      throw new Error(
        `frame size ${rgb565.length} != expected ${LCD_WIDTH * LCD_HEIGHT * 2}`,
      );
    }
    await this.setWindow(0, 0, LCD_WIDTH - 1, LCD_HEIGHT - 1);
    set_gpio(DC_PIN, 1);
    await this.write(rgb565);
  }

  close(): void {
    try {
      set_gpio(BL_PIN, 1); // backlight off
    } catch {}
    this.spi?.close(() => {});
  }
}
