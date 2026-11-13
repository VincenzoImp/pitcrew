#!/usr/bin/env node
// Render SVG files to PNG with the headless Chromium of the browser-check skill (playwright-core,
// already a dependency). Usage: node scripts/svg-png.mjs <in.svg> <out.png> [width height] ...
// Pairs and sizes repeat: in out [w h] in out [w h]. Not shipped in the package.
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const jobs = [];
for (let i = 0; i < args.length;) {
  const job = { input: args[i], output: args[i + 1] };
  i += 2;
  if (/^\d+$/.test(args[i] ?? "")) { job.width = Number(args[i]); job.height = Number(args[i + 1]); i += 2; }
  jobs.push(job);
}
if (!jobs.length || jobs.some((j) => !j.output)) {
  console.error("usage: svg-png.mjs <in.svg> <out.png> [width height] ...");
  process.exit(2);
}
const browser = await chromium.launch();
for (const job of jobs) {
  const svg = readFileSync(job.input, "utf8");
  const [, w, h] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/) ?? [];
  const width = job.width ?? Math.ceil(Number(w)), height = job.height ?? Math.ceil(Number(h));
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace(/<svg /, `<svg style="width:${width}px;height:${height}px;display:block" `)}</body></html>`);
  await page.screenshot({ path: job.output, omitBackground: true });
  await page.close();
  console.log(`${job.output}: ${width}x${height}`);
}
await browser.close();
