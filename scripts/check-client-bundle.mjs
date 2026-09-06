import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const root = new URL("../dist/client/client/", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL(".vite/manifest.json", root), "utf8"),
);
const entry = Object.keys(manifest).find((key) => manifest[key].isEntry);
assert(entry, "The client build must have an entry point.");

function staticFiles(key, seen = new Set()) {
  if (seen.has(key)) return seen;
  assert(manifest[key], `Missing manifest entry: ${key}`);
  seen.add(key);
  for (const dependency of manifest[key].imports ?? [])
    staticFiles(dependency, seen);
  return seen;
}

const initial = staticFiles(entry);
assert(
  ![...initial].some((key) =>
    /ProductLayout|draft-context|Page|exceljs/i.test(key),
  ),
  "Product routes, draft state, and ExcelJS must stay outside the landing page's static import graph.",
);
const routes = Object.keys(manifest).filter((key) =>
  /src\/app\/routes\/.+Page\.tsx$/.test(key),
);
assert(
  routes.length >= 7,
  "Product screens must remain separate dynamic entries.",
);
for (const route of routes) {
  assert(manifest[route].isDynamicEntry, `${route} must load on demand.`);
  assert(
    ![...staticFiles(route)].some((key) => /exceljs/i.test(key)),
    `${route} must defer ExcelJS until an XLSX is parsed.`,
  );
}
assert(
  Object.entries(manifest).some(
    ([key, chunk]) => /exceljs/i.test(key) && chunk.isDynamicEntry,
  ),
  "ExcelJS must have a dynamic entry.",
);
const sizes = await Promise.all(
  [...initial].map(async (key) => {
    const bytes = await readFile(new URL(manifest[key].file, root));
    return { raw: bytes.length, gzip: gzipSync(bytes).length };
  }),
);
const total = sizes.reduce(
  (sum, size) => ({ raw: sum.raw + size.raw, gzip: sum.gzip + size.gzip }),
  { raw: 0, gzip: 0 },
);
assert(
  total.gzip <= 110_000,
  `Initial JavaScript exceeds the 110 kB gzip budget: ${total.gzip} bytes.`,
);
console.log(
  `Initial JavaScript: ${(total.raw / 1000).toFixed(2)} kB / ${(total.gzip / 1000).toFixed(2)} kB gzip across ${initial.size} static chunks. ${routes.length} product route entries defer ExcelJS.`,
);
