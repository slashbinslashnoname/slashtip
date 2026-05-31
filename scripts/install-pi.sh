#!/usr/bin/env bash
# Run on the Pi (over SSH): bash scripts/install-pi.sh
set -euo pipefail

echo "==> apt deps (canvas + alsa + sox)"
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  build-essential pkg-config git \
  libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
  alsa-utils sox

echo "==> pigpio (built from source; Debian Trixie dropped the daemon)"
if [[ ! -f /usr/local/lib/libpigpio.so ]]; then
  rm -rf /tmp/pigpio-src
  git clone --depth 1 https://github.com/joan2937/pigpio.git /tmp/pigpio-src
  make -C /tmp/pigpio-src -j"$(nproc)"
  sudo make -C /tmp/pigpio-src install
fi

echo "==> set WM8960 as default ALSA card"
if ! grep -q 'defaults.pcm.card' "$HOME/.asoundrc" 2>/dev/null; then
  CARD_INDEX=$(aplay -l 2>/dev/null | awk -F'[: ]' '/wm8960/{print $2; exit}')
  if [[ -n "${CARD_INDEX:-}" ]]; then
    cat > "$HOME/.asoundrc" <<EOF
defaults.pcm.card $CARD_INDEX
defaults.pcm.device 0
defaults.ctl.card $CARD_INDEX
EOF
    echo "  default ALSA card -> $CARD_INDEX (wm8960)"
  fi
fi

echo "==> synthesize sound assets if missing"
cd "$(dirname "$0")/.."
mkdir -p assets
if [[ ! -f assets/kaching.wav ]]; then
  # cheerful two-note arpeggio
  sox -n -r 44100 -c 1 assets/kaching.wav \
    synth 0.10 sine 988 fade 0 0.10 0.02 \
    : synth 0.20 sine 1319 fade 0 0.20 0.04 \
    norm -1
fi
if [[ ! -f assets/error.wav ]]; then
  sox -n -r 44100 -c 1 assets/error.wav \
    synth 0.18 sine 220 fade 0 0.18 0.04 \
    norm -3
fi

echo "==> npm install (canvas takes a few minutes to compile)"
npm install --omit=optional --fetch-timeout=600000 --fetch-retries=5

echo "==> build"
npm run build

echo "==> install systemd unit"
sudo install -m 644 systemd/phoenix-pos.service /etc/systemd/system/phoenix-pos.service
sudo systemctl daemon-reload

echo
echo "Done. Make sure /home/slashbin/.phoenix-pos/.env exists, then:"
echo "  sudo systemctl enable --now phoenix-pos"
echo "  journalctl -fu phoenix-pos"
