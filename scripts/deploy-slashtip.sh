#!/usr/bin/env bash
# slashtip deploy/setup — run ON the Pi.  Idempotent.
# - writes phoenixd config to ~/.phoenix-pos/.env (where src/config.ts looks first)
# - npm install + build
# - installs + starts slashtip.service (SPI already enabled, phoenixd is remote)
set -uo pipefail

APP="$HOME/slashtip"
ENVF="$HOME/.phoenix-pos/.env"
SVC=/etc/systemd/system/slashtip.service
U=$(whoami)

echo "================ slashtip deploy ($(date -u +%H:%M:%SZ)) ================"
cd "$APP" || { echo "FATAL: $APP missing"; exit 1; }

# ---- 1. config (.env) ------------------------------------------------------
mkdir -p "$(dirname "$ENVF")"
cat > "$ENVF" <<ENV
PHOENIXD_URL=http://82.67.121.156:9740
PHOENIXD_PASSWORD=5336a0d2c922db7d06d0f02aa4350f6ef9e347899b9013d05e53a51e3c0b697d
INVOICE_EXPIRY_SECONDS=300
INVOICE_DESCRIPTION=slashbin POS
LOG_LEVEL=info
ENV
chmod 600 "$ENVF"
echo "[env] wrote $ENVF (PHOENIXD_URL=http://82.67.121.156:9740, password set)"

# ---- 2. build --------------------------------------------------------------
echo "[build] npm install ..."
npm install --no-audit --no-fund && echo "[build] install OK" || { echo "[build] !! install FAILED"; exit 1; }
echo "[build] npm run build ..."
npm run build && echo "[build] build OK -> dist/" || { echo "[build] !! build FAILED"; exit 1; }

# ---- 3. systemd unit -------------------------------------------------------
echo "[svc] writing $SVC"
sudo tee "$SVC" >/dev/null <<UNIT
[Unit]
Description=slashtip — Lightning tip jar / POS (phoenixd + WhisPlay HAT)
After=network-online.target sound.target
Wants=network-online.target

[Service]
Type=simple
User=$U
WorkingDirectory=$APP
EnvironmentFile=-$ENVF
ExecStart=/usr/bin/node $APP/dist/index.js
Restart=on-failure
RestartSec=3
SupplementaryGroups=gpio spi audio
MemoryMax=380M

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable slashtip.service
sudo systemctl restart slashtip.service
sleep 4

# ---- 4. verify -------------------------------------------------------------
echo "================ status ================"
echo "active : $(systemctl is-active slashtip)"
echo "enabled: $(systemctl is-enabled slashtip)"
echo "dist   : $([ -f $APP/dist/index.js ] && echo built || echo MISSING)"
echo "---- other custom services (should be none) ----"
systemctl list-units --type=service --state=running --no-legend --no-pager \
  | grep -iE 'miniapptg|openclaw|phoenix-pos' || echo "  none"
echo "---- journal (last 15) ----"
journalctl -u slashtip -n 15 --no-pager -o cat
echo "================ done ================"
