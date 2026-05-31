/**
 * Pack an RGBA Buffer (4 bytes/px from node-canvas) into RGB565 big-endian
 * (the byte order ST7789 expects on SPI).
 */
export function rgbaToRgb565BE(rgba: Buffer, pixelCount: number): Buffer {
  const out = Buffer.allocUnsafe(pixelCount * 2);
  for (let i = 0, o = 0; i < pixelCount; i++, o += 2) {
    const p = i * 4;
    const r = rgba[p]!;
    const g = rgba[p + 1]!;
    const b = rgba[p + 2]!;
    const v = ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
    out[o] = (v >> 8) & 0xff;
    out[o + 1] = v & 0xff;
  }
  return out;
}
