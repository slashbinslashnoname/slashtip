import canvas from "canvas";
import QRCode from "qrcode";
import { LCD_HEIGHT, LCD_WIDTH } from "./st7789.js";
import { rgbaToRgb565BE } from "./pixels.js";

const { createCanvas, Image } = canvas;
type CanvasRenderingContext2D = ReturnType<ReturnType<typeof createCanvas>["getContext"]>;

const W = LCD_WIDTH;
const H = LCD_HEIGHT;

const PALETTE = {
  bg: "#0b0b0f",
  fg: "#fafafa",
  dim: "#6b7280",
  accent: "#f7931a", // Bitcoin orange
  ok: "#22c55e",
  err: "#ef4444",
  qrBg: "#ffffff",
  qrFg: "#000000",
} as const;

function newCtx(): { ctx: CanvasRenderingContext2D; toFrame: () => Buffer } {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = PALETTE.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  return {
    ctx,
    toFrame: () => {
      const { data } = ctx.getImageData(0, 0, W, H);
      return rgbaToRgb565BE(Buffer.from(data.buffer), W * H);
    },
  };
}

function formatSats(n: number): string {
  return n.toLocaleString("en-US");
}

export function renderIdle(): Buffer {
  const { ctx, toFrame } = newCtx();
  ctx.fillStyle = PALETTE.accent;
  ctx.font = "bold 28px sans-serif";
  ctx.fillText("⚡ slashbin POS", W / 2, 60);

  ctx.fillStyle = PALETTE.fg;
  ctx.font = "20px sans-serif";
  ctx.fillText("Tap to charge", W / 2, H / 2 - 10);

  ctx.fillStyle = PALETTE.dim;
  ctx.font = "13px sans-serif";
  ctx.fillText("100 → 1k → 10k → 100k sat", W / 2, H / 2 + 18);
  ctx.fillText("hold to confirm", W / 2, H / 2 + 38);

  ctx.fillStyle = PALETTE.dim;
  ctx.font = "10px sans-serif";
  ctx.fillText("phoenixd · lightning", W / 2, H - 18);
  return toFrame();
}

export function renderSelect(amountSat: number, index: number, total: number): Buffer {
  const { ctx, toFrame } = newCtx();
  ctx.fillStyle = PALETTE.dim;
  ctx.font = "13px sans-serif";
  ctx.fillText("Charge", W / 2, 40);

  ctx.fillStyle = PALETTE.accent;
  ctx.font = "bold 44px sans-serif";
  ctx.fillText(formatSats(amountSat), W / 2, H / 2 - 20);

  ctx.fillStyle = PALETTE.fg;
  ctx.font = "18px sans-serif";
  ctx.fillText("sats", W / 2, H / 2 + 18);

  // dots indicator
  const dotY = H / 2 + 50;
  const spacing = 16;
  const startX = W / 2 - ((total - 1) * spacing) / 2;
  for (let i = 0; i < total; i++) {
    ctx.fillStyle = i === index ? PALETTE.accent : PALETTE.dim;
    ctx.beginPath();
    ctx.arc(startX + i * spacing, dotY, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = PALETTE.dim;
  ctx.font = "12px sans-serif";
  ctx.fillText("tap: next  ·  hold: confirm", W / 2, H - 22);
  return toFrame();
}

export async function renderInvoice(
  bolt11: string,
  amountSat: number,
  secondsLeft: number,
): Promise<Buffer> {
  const { ctx, toFrame } = newCtx();

  ctx.fillStyle = PALETTE.fg;
  ctx.font = "bold 22px sans-serif";
  ctx.fillText(`${formatSats(amountSat)} sat`, W / 2, 22);

  // QR
  const qrSize = 200;
  const qrPng = await QRCode.toBuffer(bolt11.toUpperCase(), {
    type: "png",
    width: qrSize,
    margin: 1,
    color: { dark: PALETTE.qrFg, light: PALETTE.qrBg },
    errorCorrectionLevel: "L",
  });
  const img = new Image();
  img.src = qrPng;
  const qrX = (W - qrSize) / 2;
  const qrY = 44;
  ctx.fillStyle = PALETTE.qrBg;
  ctx.fillRect(qrX - 6, qrY - 6, qrSize + 12, qrSize + 12);
  ctx.drawImage(img, qrX, qrY, qrSize, qrSize);

  ctx.fillStyle = PALETTE.dim;
  ctx.font = "12px sans-serif";
  ctx.fillText(
    `expires in ${formatCountdown(secondsLeft)}`,
    W / 2,
    qrY + qrSize + 18,
  );
  ctx.fillText("tap to cancel", W / 2, H - 14);
  return toFrame();
}

export function renderPaid(amountSat: number): Buffer {
  const { ctx, toFrame } = newCtx();
  ctx.fillStyle = PALETTE.ok;
  ctx.beginPath();
  ctx.arc(W / 2, 110, 55, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = PALETTE.bg;
  ctx.lineWidth = 9;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(W / 2 - 24, 112);
  ctx.lineTo(W / 2 - 6, 130);
  ctx.lineTo(W / 2 + 28, 92);
  ctx.stroke();

  ctx.fillStyle = PALETTE.fg;
  ctx.font = "bold 24px sans-serif";
  ctx.fillText("PAID", W / 2, 200);
  ctx.fillStyle = PALETTE.accent;
  ctx.font = "bold 22px sans-serif";
  ctx.fillText(`${formatSats(amountSat)} sat`, W / 2, 232);
  return toFrame();
}

export function renderExpired(): Buffer {
  const { ctx, toFrame } = newCtx();
  ctx.fillStyle = PALETTE.err;
  ctx.beginPath();
  ctx.arc(W / 2, 110, 55, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = PALETTE.bg;
  ctx.lineWidth = 9;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(W / 2 - 22, 88);
  ctx.lineTo(W / 2 + 22, 132);
  ctx.moveTo(W / 2 + 22, 88);
  ctx.lineTo(W / 2 - 22, 132);
  ctx.stroke();

  ctx.fillStyle = PALETTE.fg;
  ctx.font = "bold 22px sans-serif";
  ctx.fillText("EXPIRED", W / 2, 200);
  return toFrame();
}

export function renderError(message: string): Buffer {
  const { ctx, toFrame } = newCtx();
  ctx.fillStyle = PALETTE.err;
  ctx.font = "bold 18px sans-serif";
  ctx.fillText("ERROR", W / 2, 80);
  ctx.fillStyle = PALETTE.fg;
  ctx.font = "13px sans-serif";
  wrapText(ctx, message, W / 2, 120, W - 20, 18);
  return toFrame();
}

function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): void {
  const words = text.split(" ");
  let line = "";
  let cursorY = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cursorY);
      cursorY += lineHeight;
      line = word;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, cursorY);
}
