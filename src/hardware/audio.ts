import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(here, "..", "..", "assets");

const SOUNDS = {
  paid: join(assetsDir, "kaching.wav"),
  expired: join(assetsDir, "error.wav"),
} as const;

export function play(sound: keyof typeof SOUNDS): void {
  const path = SOUNDS[sound];
  if (!existsSync(path)) {
    console.warn(`[audio] missing ${path}, skipping`);
    return;
  }
  // aplay routes through the default ALSA card, which we set to wm8960 in install-pi.sh.
  const proc = spawn("aplay", ["-q", path], { stdio: "ignore", detached: true });
  proc.on("error", (e) => console.warn(`[audio] aplay error: ${e.message}`));
  proc.unref();
}
