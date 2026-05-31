// Neutralize SIGCONT/SIGPIPE before pigpio installs its handlers.
// pigpio treats these as fatal and terminates; we don't want that.
process.on("SIGCONT", () => {});
process.on("SIGPIPE", () => {});

import { App } from "./app.js";

const app = new App();
app.start().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
