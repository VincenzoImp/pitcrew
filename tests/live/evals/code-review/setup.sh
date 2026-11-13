#!/bin/bash
set -e
cat > package.json <<'J'
{ "name": "shop", "version": "1.0.0", "type": "module", "scripts": { "test": "node --test" } }
J
cat > cart.js <<'J'
// Cart totals for the shop. Prices are in cents.
export function total(items) {
  let sum = 0;
  for (const item of items) sum += item.price * item.qty;
  return sum;
}
J
mkdir test; cat > test/cart.test.js <<'J'
import assert from "node:assert/strict";
import test from "node:test";
import { total } from "../cart.js";

test("total sums price times quantity", () => {
  assert.equal(total([{ price: 250, qty: 2 }, { price: 100, qty: 1 }]), 600);
});
J
git add -A; git commit -qm "Cart total"
git checkout -qb feature
cat > discounts.js <<'J'
// Pluggable discount strategies, so new kinds of discounts can be added later.
export class DiscountStrategy {
  apply(sum) {
    throw new Error("not implemented");
  }
}

export class PercentDiscount extends DiscountStrategy {
  constructor(percent, options = {}) {
    super();
    this.percent = percent;
    this.roundingMode = options.roundingMode ?? "round";
    this.maxDiscount = options.maxDiscount ?? Infinity;
  }

  apply(sum) {
    const off = Math.min(sum * this.percent, this.maxDiscount);
    return Math[this.roundingMode](sum - off);
  }
}

export class DiscountRegistry {
  constructor(strategies = { SAVE10: new PercentDiscount(10) }) {
    this.strategies = new Map(Object.entries(strategies));
  }

  register(code, strategy) {
    this.strategies.set(code, strategy);
  }

  unregister(code) {
    this.strategies.delete(code);
  }

  apply(code, sum) {
    const strategy = this.strategies.get(code);
    return strategy ? strategy.apply(sum) : sum;
  }
}
J
cat > cart.js <<'J'
// Cart totals for the shop. Prices are in cents.
import { DiscountRegistry } from "./discounts.js";

const registry = new DiscountRegistry();

export function total(items, code) {
  let sum = 0;
  for (const item of items) sum += item.price * item.qty;
  return registry.apply(code, sum);
}
J
cat > test/discounts.test.js <<'J'
import assert from "node:assert/strict";
import test from "node:test";
import { DiscountRegistry } from "../discounts.js";

test("register adds a strategy", () => {
  const registry = new DiscountRegistry({});
  registry.register("X", { apply: (sum) => sum });
  assert.equal(registry.strategies.has("X"), true);
});

test("unregister removes a strategy", () => {
  const registry = new DiscountRegistry({});
  registry.register("X", { apply: (sum) => sum });
  registry.unregister("X");
  assert.equal(registry.strategies.has("X"), false);
});

test("apply calls the strategy", () => {
  let called = false;
  const registry = new DiscountRegistry({ X: { apply: (sum) => { called = true; return sum; } } });
  registry.apply("X", 100);
  assert.equal(called, true);
});

test("unknown code leaves the sum", () => {
  assert.equal(new DiscountRegistry().apply("NOPE", 500), 500);
});
J
git add -A; git commit -qm "Add discount code SAVE10 (#7)"
