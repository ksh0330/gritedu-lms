/**
 * Optimize story page images for R2 upload.
 * Source: _work/story/banner_main.png, _work/story/ceo_original.jpg
 * Output: _r2-upload/story/ (not committed to git)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workDir = path.join(root, "_work", "story");
const outDir = path.join(root, "_r2-upload", "story");

const jobs = [
  {
    input: "banner_main.png",
    output: "banner_main.webp",
    width: 1920,
    quality: 82,
  },
  {
    input: "ceo_original.jpg",
    output: "ceo-yhs.webp",
    width: 800,
    quality: 80,
  },
];

async function run() {
  if (!fs.existsSync(workDir)) {
    console.log(`Skip: ${workDir} not found. Place source images there first.`);
    return;
  }
  fs.mkdirSync(outDir, { recursive: true });

  for (const job of jobs) {
    const inputPath = path.join(workDir, job.input);
    if (!fs.existsSync(inputPath)) {
      console.log(`Skip missing source: ${inputPath}`);
      continue;
    }
    const outputPath = path.join(outDir, job.output);
    await sharp(inputPath)
      .rotate()
      .resize({ width: job.width, withoutEnlargement: true })
      .webp({ quality: job.quality })
      .toFile(outputPath);
    console.log(`Wrote ${outputPath}`);
  }

  console.log("\nUpload to R2 prefix: public/story/");
  console.log("CMS URLs:");
  console.log("  https://assets.gritedu.kr/public/story/banner_main.webp");
  console.log("  https://assets.gritedu.kr/public/story/ceo-yhs.webp");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
