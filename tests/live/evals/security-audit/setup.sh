#!/bin/bash
set -e
cat > package.json <<'J'
{ "name": "thumbs", "version": "1.0.0", "type": "module", "scripts": { "start": "node server.js", "test": "node --test" } }
J
cat > README.md <<'J'
# thumbs
Public HTTP service: anyone can request a thumbnail of an uploaded image, and list uploads.
No login. Runs as one Node process next to the uploads folder.
J
cat > server.js <<'J'
import { execSync } from "node:child_process";
import { createServer } from "node:http";
import { listUploads } from "./uploads.js";

// GET /thumb?file=<name>  -> a 64x64 thumbnail of uploads/<name>
// GET /uploads?sort=<name|size|date> -> uploads as JSON
createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/thumb") {
    const file = url.searchParams.get("file") ?? "";
    const out = execSync("convert uploads/" + file + " -resize 64x64 png:-");
    res.writeHead(200, { "content-type": "image/png" }).end(out);
  } else if (url.pathname === "/uploads") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(listUploads(url.searchParams.get("sort"))));
  } else {
    res.writeHead(404).end();
  }
}).listen(8080);
J
cat > uploads.js <<'J'
import { readdirSync, statSync } from "node:fs";

// Sort keys a client may ask for, mapped to the field they sort by.
const SORT = { name: "name", size: "size", date: "mtime" };

export function listUploads(sort) {
  const key = Object.hasOwn(SORT, sort ?? "") ? SORT[sort] : "name";
  const files = readdirSync("uploads").map((name) => ({ name, ...statSync(`uploads/${name}`) }));
  // The sort key is built into a comparator from source text, as the old reporting module did.
  const compare = new Function("a", "b", `return a.${key} < b.${key} ? -1 : a.${key} > b.${key} ? 1 : 0;`);
  return files.sort(compare).map((f) => ({ name: f.name, size: f.size }));
}
J
mkdir uploads && touch uploads/.keep && git add -A && git commit -qm init
