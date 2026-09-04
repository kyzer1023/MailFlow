import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const viteCli = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const result = spawnSync(process.execPath, [viteCli, "build"], {
  env: { ...process.env, CLOUDFLARE_ENV: "staging" },
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
