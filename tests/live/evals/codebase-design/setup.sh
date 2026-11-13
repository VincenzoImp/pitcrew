#!/bin/bash
set -e
mkdir -p orders
printf 'export const validate = (o) => { if (!o.items?.length) throw new Error("empty"); return o; };\n' > orders/validate.js
printf 'export const price = (o) => ({ ...o, total: o.items.reduce((s, i) => s + i.price, 0) });\n' > orders/price.js
printf 'import { validate } from "./validate.js";\nimport { price } from "./price.js";\nexport const intake = (o) => price(validate(o));\n' > orders/intake.js
cat > orders/repository.js <<'J'
// Repository over the store.
import { store } from "./store.js";
export const save = (o) => store.save(o);
export const load = (id) => store.load(id);
J
printf 'const m = new Map();\nexport const store = { save: (o) => m.set(o.id, o), load: (id) => m.get(id) };\n' > orders/store.js
printf 'import { intake } from "./intake.js";\nimport { save } from "./repository.js";\nexport const handle = (o) => save(intake(o));\n' > orders/handler.js
git add -A && git commit -qm init
