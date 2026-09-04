import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const generatedPath = fileURLToPath(new URL("../dist/client/mailflow/wrangler.json", import.meta.url));
const validatedPath = fileURLToPath(new URL("../dist/client/mailflow/wrangler.staging-validated.json", import.meta.url));
const config = JSON.parse(await readFile(generatedPath, "utf8"));

const database = config.d1_databases?.find((binding) => binding.binding === "DB");
const queue = config.queues?.producers?.find((binding) => binding.binding === "CAMPAIGN_QUEUE");
const expected = {
  name: "mailflow-staging",
  origin: "https://mailflow-staging.kyzer-hono-test.workers.dev",
  database: "mailflow-staging-db",
  queue: "mailflow-staging-campaign-ticks",
};

if (
  config.name !== expected.name
  || config.vars?.PUBLIC_ORIGIN !== expected.origin
  || database?.database_name !== expected.database
  || queue?.queue !== expected.queue
) {
  throw new Error("Refusing staging deployment because the generated Wrangler config does not target only staging resources.");
}

await writeFile(validatedPath, `${JSON.stringify(config)}\n`, "utf8");
console.log(`Validated isolated staging config for ${expected.name}.`);
