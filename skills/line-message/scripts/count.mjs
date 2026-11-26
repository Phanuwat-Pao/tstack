// Count a LINE message the way LINE does: UTF-16 code units.
// Usage: node count.mjs <file>
// Prints "<count> / 5000" and exits 1 when the message is over the limit.
import { readFileSync } from "node:fs";

const LIMIT = 5000;
const file = process.argv[2];
if (!file) {
  console.error("usage: node count.mjs <file>");
  process.exit(2);
}

const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n").replace(/\n+$/, "");
const count = text.length; // JS string length is UTF-16 code units
console.log(`${count} / ${LIMIT}`);
if (text.includes("```")) {
  console.error("contains ``` which breaks the copy block");
  process.exit(1);
}
process.exit(count > LIMIT ? 1 : 0);
