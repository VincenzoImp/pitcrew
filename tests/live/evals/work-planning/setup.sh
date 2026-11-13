#!/bin/bash
set -e
cat > orders.js <<'J'
// Orders in memory. status: "new" | "shipped"
const orders = new Map();
export const place = (id, items) => orders.set(id, { id, items, status: "new" });
export const ship = (id) => { orders.get(id).status = "shipped"; };
export const get = (id) => orders.get(id);
J
git add -A && git commit -qm init
