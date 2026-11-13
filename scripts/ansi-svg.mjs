#!/usr/bin/env node
// Turn a terminal capture with ANSI colours (`tmux capture-pane -e -p`) into an SVG for the docs.
// Usage: node scripts/ansi-svg.mjs <capture.ansi> <out.svg> [--title text] [--cols n]
// Each run of text is placed on its terminal column and stretched to its cell width, so box
// drawing lines up whatever monospace font the viewer has. Not shipped in the package.
import { readFileSync, writeFileSync } from "node:fs";

const [input, output, ...rest] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: ansi-svg.mjs <capture.ansi> <out.svg> [--title text] [--cols n]");
  process.exit(2);
}
const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };

// A dark theme close to common terminal defaults.
const BG = "#0d1117", FG = "#d6dde6";
const BASE = ["#1b1f24", "#ff7b72", "#3fb950", "#d29922", "#58a6ff", "#bc8cff", "#39c5cf", "#b1bac4",
  "#6e7681", "#ffa198", "#56d364", "#e3b341", "#79c0ff", "#d2a8ff", "#56d4dd", "#ffffff"];
function color256(n) {
  if (n < 16) return BASE[n];
  if (n >= 232) { const v = 8 + (n - 232) * 10; return `rgb(${v},${v},${v})`; }
  const i = n - 16, c = (x) => (x ? 55 + x * 40 : 0);
  return `rgb(${c(Math.floor(i / 36))},${c(Math.floor(i / 6) % 6)},${c(i % 6)})`;
}

const lines = readFileSync(input, "utf8").replace(/\n+$/, "").split("\n");
const cells = []; // per line: [{ col, text, style }]
let style = {};
for (const line of lines) {
  const runs = [];
  let col = 0, buf = "", start = 0;
  const flush = () => { if (buf) runs.push({ col: start, text: buf, style: { ...style } }); buf = ""; start = col; };
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\x1b" && line[i + 1] === "[") {
      const end = line.slice(i).search(/[A-Za-z]/);
      const code = line.slice(i + 2, i + end);
      if (line[i + end] === "m") {
        flush();
        const p = code === "" ? [0] : code.split(/[;:]/).map(Number);
        for (let k = 0; k < p.length; k++) {
          const v = p[k];
          if (v === 0) style = {};
          else if (v === 1) style.bold = true;
          else if (v === 2) style.dim = true;
          else if (v === 3) style.italic = true;
          else if (v === 4) style.underline = true;
          else if (v === 7) style.inverse = true;
          else if (v === 22) { style.bold = false; style.dim = false; }
          else if (v === 23) style.italic = false;
          else if (v === 24) style.underline = false;
          else if (v === 27) style.inverse = false;
          else if (v >= 30 && v <= 37) style.fg = BASE[v - 30];
          else if (v >= 90 && v <= 97) style.fg = BASE[v - 90 + 8];
          else if (v >= 40 && v <= 47) style.bg = BASE[v - 40];
          else if (v >= 100 && v <= 107) style.bg = BASE[v - 100 + 8];
          else if (v === 39) delete style.fg;
          else if (v === 49) delete style.bg;
          else if ((v === 38 || v === 48) && p[k + 1] === 5) { style[v === 38 ? "fg" : "bg"] = color256(p[k + 2]); k += 2; }
          else if ((v === 38 || v === 48) && p[k + 1] === 2) { style[v === 38 ? "fg" : "bg"] = `rgb(${p[k + 2]},${p[k + 3]},${p[k + 4]})`; k += 4; }
        }
      }
      i += end;
      continue;
    }
    if (line[i] === "\x1b") { i++; continue; }
    const ch = String.fromCodePoint(line.codePointAt(i));
    if (ch.length === 2) i++;
    buf += ch;
    col += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{1f300}-\u{1faff}]/u.test(ch) ? 2 : 1;
  }
  flush();
  cells.push(runs);
}

const CW = 8.4, LH = 18, PAD = 16, TOP = opt("--title") ? 34 : PAD;
const cols = Number(opt("--cols")) || Math.max(...cells.map((r) => r.reduce((m, x) => Math.max(m, x.col + [...x.text].length), 0)), 40);
const width = Math.ceil(cols * CW + PAD * 2), height = Math.ceil(cells.length * LH + TOP + PAD);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const out = [];
out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`);
if (opt("--title")) out.push(`<title>${esc(opt("--title"))}</title>`);
out.push(`<rect width="100%" height="100%" rx="8" fill="${BG}"/>`);
if (opt("--title")) {
  out.push(`<circle cx="18" cy="16" r="5" fill="#ff5f57"/><circle cx="34" cy="16" r="5" fill="#febc2e"/><circle cx="50" cy="16" r="5" fill="#28c840"/>`);
  out.push(`<text x="${width / 2}" y="20" fill="#8b949e" font-family="ui-sans-serif,system-ui,sans-serif" font-size="12" text-anchor="middle">${esc(opt("--title"))}</text>`);
}
out.push(`<g font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,'DejaVu Sans Mono',monospace" font-size="14" xml:space="preserve">`);
cells.forEach((runs, row) => {
  const y = TOP + row * LH;
  for (const r of runs) {
    let fg = r.style.fg ?? FG, bg = r.style.bg;
    if (r.style.inverse) [fg, bg] = [bg ?? BG, fg];
    const len = [...r.text].length;
    if (bg) out.push(`<rect x="${(PAD + r.col * CW).toFixed(1)}" y="${y}" width="${(len * CW).toFixed(1)}" height="${LH}" fill="${bg}"/>`);
    // One <text> per word, on its own column: spaces never get stretched.
    const chars = [...r.text];
    for (let k = 0; k < chars.length;) {
      if (chars[k] === " ") { k++; continue; }
      let e = k;
      while (e < chars.length && chars[e] !== " ") e++;
      const word = chars.slice(k, e).join("");
      const attrs = [`x="${(PAD + (r.col + k) * CW).toFixed(1)}"`, `y="${y + 13}"`, `fill="${fg}"`, `textLength="${((e - k) * CW).toFixed(1)}"`, `lengthAdjust="spacingAndGlyphs"`];
      if (r.style.bold) attrs.push(`font-weight="bold"`);
      if (r.style.dim) attrs.push(`opacity="0.6"`);
      if (r.style.italic) attrs.push(`font-style="italic"`);
      if (r.style.underline) attrs.push(`text-decoration="underline"`);
      out.push(`<text ${attrs.join(" ")}>${esc(word)}</text>`);
      k = e;
    }
  }
});
out.push("</g></svg>");
writeFileSync(output, `${out.join("\n")}\n`);
console.log(`${output}: ${cols} columns, ${cells.length} lines, ${width}x${height}`);
