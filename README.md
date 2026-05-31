# slashtip

A pocket-sized Lightning tip jar / point-of-sale terminal that runs on a
**Raspberry Pi Zero 2W** + **Waveshare WhisPlay HAT** and talks to a remote
[`phoenixd`](https://github.com/ACINQ/phoenixd) Lightning daemon.

One button, four preset amounts, live QR, payment-confirmed beep.

## Hardware

| Part                      | Notes                                                                |
| ------------------------- | -------------------------------------------------------------------- |
| Raspberry Pi Zero 2 W     | ~$15, quad-core ARM64, 512 MB RAM                                    |
| Waveshare WhisPlay HAT    | 1.69" 240×280 ST7789V2 IPS LCD, WM8960 audio codec, 1 user button, RGB LED |
| microSD (8 GB+)           | Pi OS Bookworm or Trixie (64-bit)                                    |
| Speaker (optional)        | 3.5 mm or solder onto the HAT's pads for the ka-ching                |

GPIO map (BCM): LCD `DC=27 RST=4 BL=22`, SPI0.0 CE0=8, button `17`, RGB LED `R=25 G=24 B=23`.

## What it does

```
   IDLE                          ┐
    │  tap                       │ 60s no tap →
    ▼                            │ backlight off
   SELECTING ─tap→ 100 → 1k → 10k → 100k → IDLE
    │
    │  long-press (≥500 ms)
    ▼
   INVOICE (QR + countdown) ─tap→ IDLE
    │
    │  websocket: payment_received
    ▼
   PAID (✓ + ka-ching) ─3s→ IDLE
```

- **Tap** to cycle through 100 / 1 000 / 10 000 / 100 000 sat.
- **Long-press (≥500 ms)** to confirm and create a real `phoenixd` invoice.
- Scan the on-screen QR with any Lightning wallet.
- The Pi keeps a WebSocket open to `phoenixd`; on `payment_received` the screen
  flips to PAID, the WM8960 plays a ka-ching, the RGB LED flashes green.
- After 60 s idle the backlight turns off (screen-save). Any button event wakes it.

## Architecture

| File                          | Role                                                         |
| ----------------------------- | ------------------------------------------------------------ |
| `src/index.ts`                | entrypoint                                                   |
| `src/app.ts`                  | state machine + screen-save scheduler                         |
| `src/config.ts`               | env loading (`~/.phoenix-pos/.env`)                          |
| `src/phoenix.ts`              | `phoenixd` HTTP `/createinvoice` + WebSocket `/websocket`     |
| `src/display/st7789.ts`       | ST7789V2 driver (libgpiod via @iiot2k/gpiox + spi-device)    |
| `src/display/render.ts`       | node-canvas → RGB565 framebuffer for each UI state           |
| `src/display/pixels.ts`       | RGBA→RGB565 packer                                            |
| `src/hardware/button.ts`      | polled+debounced tap/long-press detector                     |
| `src/hardware/rgbled.ts`      | software-PWM RGB indicator                                    |
| `src/hardware/audio.ts`       | `aplay` wrapper for the WM8960                               |

The ST7789V2 init sequence is taken verbatim from Waveshare's reference
`WhisPlay.py` to guarantee panel compatibility.

GPIO is driven through `@iiot2k/gpiox` (libgpiod v2). We deliberately avoid
`pigpio` because its C-level signal handler caught harmless job-control signals
(SIGCONT, SIGSTKFLT) and crashed the app.

## Setup

### 1. Configure `phoenixd`

You need a `phoenixd` instance reachable from the Pi over HTTP, with
`http-password-limited-access` set in `phoenix.conf`. The Pi only ever needs the
limited-access password — it creates invoices and reads payment events but
cannot pay anyone.

### 2. Provision the Pi

```bash
# from your dev machine
rsync -az --exclude node_modules --exclude dist --exclude .git --exclude .env \
  ./ slashbin@<pi>:/home/slashbin/phoenix-pos/

ssh slashbin@<pi> 'bash /home/slashbin/phoenix-pos/scripts/install-pi.sh'
```

`install-pi.sh` installs build deps (cairo/pango/jpeg for node-canvas, alsa-utils,
sox), synthesizes the ka-ching/error WAVs with sox, `npm install`s, and
`tsc`-builds.

### 3. Credentials

```bash
ssh slashbin@<pi>
install -d -m 700 ~/.phoenix-pos
cat > ~/.phoenix-pos/.env <<'EOF'
PHOENIXD_URL=http://your-phoenixd-host:9740
PHOENIXD_PASSWORD=<http-password-limited-access from phoenix.conf>
INVOICE_EXPIRY_SECONDS=300
INVOICE_DESCRIPTION=slashtip
EOF
chmod 600 ~/.phoenix-pos/.env
```

### 4. Autostart

```bash
sudo systemctl enable --now phoenix-pos
journalctl -fu phoenix-pos
```

The unit file in `systemd/phoenix-pos.service` runs as `slashbin` (a member of
the `gpio`, `spi`, and `audio` groups) — no `sudo` required at runtime.

## Development

```bash
npm install --ignore-scripts --force   # local typecheck only; native deps are arm64-Linux
npm run typecheck
bash scripts/deploy.sh --restart       # rsync + rebuild + systemctl restart on the Pi
```

Run with `BUTTON_DEBUG=1` to get a `[btn] PRESS / RELEASE / LONG` trace per event.

## License

MIT
