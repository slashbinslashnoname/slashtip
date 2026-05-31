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

### 1. Run `phoenixd`

[`phoenixd`](https://github.com/ACINQ/phoenixd) is ACINQ's self-custodial
Lightning node daemon — same protocol stack as the Phoenix mobile wallet, but
headless. It sets up channels with ACINQ automatically on first inbound payment
and pays a fixed fee for the service, so you do **not** need to manage your own
peers, watchtowers, or on-chain wallet.

The Pi never runs `phoenixd` itself — Pi Zero 2W has 512 MB RAM and `phoenixd`
needs a JRE. Run it on a small VPS or any always-on box that the Pi can reach.

#### Install

Download the latest binaries from
[github.com/ACINQ/phoenixd/releases](https://github.com/ACINQ/phoenixd/releases)
and unpack to `~/phoenix`:

```bash
# on the phoenixd host (x86_64 Linux example)
mkdir -p ~/phoenix && cd ~/phoenix
curl -sSL https://github.com/ACINQ/phoenixd/releases/download/v0.6.0/phoenixd-0.6.0-linux-x64.zip -o phoenixd.zip
unzip phoenixd.zip && mv phoenixd-*/{phoenixd,phoenix-cli} . && chmod +x phoenixd phoenix-cli
sudo apt-get install -y openjdk-21-jre-headless
```

#### First run + seed

```bash
./phoenixd
# On first launch it prints a seed phrase and the http-password values.
# WRITE THE SEED DOWN OFFLINE. It controls all funds. Then Ctrl+C and edit
# ~/.phoenix/phoenix.conf to set http-bind-ip if needed (defaults to 127.0.0.1).
```

Your `~/.phoenix/phoenix.conf` should end up something like:

```
http-bind-ip=0.0.0.0
http-bind-port=9740
http-password=<long random for full access — keep secret on the server only>
http-password-limited-access=<long random for the Pi — read-only & invoice creation>
```

The Pi uses **only** `http-password-limited-access`. Limited-access endpoints
(`/createinvoice`, `/payments/...`, `/getinfo`, `/websocket` for incoming
payments) let it accept payments but not spend funds.

#### systemd unit for `phoenixd`

```ini
# /etc/systemd/system/phoenixd.service
[Unit]
Description=phoenixd
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=phoenix
WorkingDirectory=/home/phoenix
ExecStart=/home/phoenix/phoenix/phoenixd
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now phoenixd
journalctl -fu phoenixd
```

#### Expose it to the Pi

The Pi needs TCP access to port `9740` on the `phoenixd` host. Pick one:

- **Same LAN** — point the Pi at the LAN IP (`http://192.168.1.x:9740`). Simplest.
- **Public host, port-forward** — open `9740/tcp` on your VPS firewall, point Pi
  at `http://your-host:9740`. The bearer password is the only secret in flight;
  put it behind HTTPS if the Pi is anywhere other than a trusted LAN.
- **Public host, behind nginx/caddy with TLS** — terminate TLS at 443, proxy to
  `127.0.0.1:9740`. Point Pi at `https://your-host`. WebSockets just work
  through both nginx and caddy with the standard `Upgrade`/`Connection` headers.

#### Verify reachability

```bash
curl -u ":<http-password-limited-access>" http://your-phoenixd-host:9740/getinfo
# → JSON with nodeId, channels, chain
```

#### Fund the channel

`phoenixd` opens a channel automatically when someone first pays you. The first
incoming payment is partially consumed by the channel-open fee (ACINQ's
service). Send yourself ~10 000 sat from any LN wallet to seed it. From then on
every payment is instant and routed through that single channel.

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
