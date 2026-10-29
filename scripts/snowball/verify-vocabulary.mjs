// Checks the generated stemmers against the full reference vocabularies of snowball-data
// (https://github.com/snowballstem/snowball-data, ukrainian/ and english/: voc.txt = words, output.txt = reference stems).
// Needs a built core (`pnpm build`). Not part of CI: the vocabularies are large; CI runs the committed 1-in-100 sample.
//
// Usage: node scripts/snowball/verify-vocabulary.mjs <uk|en> <voc.txt> <output.txt>
import { readFileSync } from "node:fs";
import { stemToken } from "../../packages/core/dist/index.js";

const [, , language, vocPath, outputPath] = process.argv;
if ((language !== "uk" && language !== "en") || !vocPath || !outputPath) {
  console.error(
    "usage: node scripts/snowball/verify-vocabulary.mjs <uk|en> <voc.txt> <output.txt>",
  );
  process.exit(2);
}
const words = readFileSync(vocPath, "utf8")
  .split("\n")
  .filter((line) => line !== "");
const stems = readFileSync(outputPath, "utf8")
  .split("\n")
  .filter((line) => line !== "");
if (words.length !== stems.length) {
  console.error(`voc has ${words.length} words but output has ${stems.length} stems`);
  process.exit(2);
}
let mismatches = 0;
for (let i = 0; i < words.length; i++) {
  const got = stemToken(words[i], language);
  if (got !== stems[i]) {
    mismatches++;
    if (mismatches <= 20) {
      console.error(`MISMATCH ${words[i]}: got ${got}, reference ${stems[i]}`);
    }
  }
}
console.log(`${language}: ${words.length} words, ${mismatches} mismatches`);
process.exit(mismatches === 0 ? 0 : 1);
