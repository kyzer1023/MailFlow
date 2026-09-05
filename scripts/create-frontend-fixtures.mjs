import ExcelJS from "exceljs";
import { mkdir, writeFile } from "node:fs/promises";
const directory = new URL("../artifacts/local/", import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL("../.local-preview.html", import.meta.url), '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mail Flow local preview</title></head><body><div id="root"></div><script type="module" src="/scripts/frontend-preview-entry.js"></script></body></html>');
const names = ["Amina Tan", "Wei Jun", "Sara Lim", "Daniel Lee", "Priya Rao"];
const emails = ["amina", "weijun", "sara", "daniel"];
const rows = Array.from({ length: 48 }, (_, index) => [
  names[index] || `Member ${index + 1}`,
  index === 4 ? "" : index === 47 ? "bad-address" : `${emails[index] || `member${index + 1}`}@example.test`,
  index % 2 ? "Afternoon" : "Morning",
]);
await writeFile(new URL("workshop-recipients.csv", directory), [["Name", "Email", "Session"], ...rows].map((row) => row.join(",")).join("\n"));
for (const [filename, header] of [["workshop-recipients.xlsx", "Name"], ["renamed-columns.xlsx", "Full name"]]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Recipients");
  sheet.addRows([[header, "Email", "Session"], ...rows]);
  await workbook.xlsx.writeFile(new URL(filename, directory).pathname.replace(/^\/([A-Za-z]:)/u, "$1"));
}
await writeFile(new URL("agenda.txt", directory), "Synthetic workshop agenda.\n");
await writeFile(new URL("schedule.csv", directory), "Session,Room\nMorning,Room 1\nAfternoon,Room 2\n");
console.log("Created synthetic recipient and attachment fixtures in artifacts/local.");
