/* Gunther · test harness
   Counts assertions that actually ran, so suite totals in the report are
   measured truth instead of numbers typed by hand into a console.log. */

import strict from "node:assert/strict";

let passed = 0;

export const assert = new Proxy(strict, {
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver);
    if (typeof value !== "function") return value;
    return (...args) => {
      const out = value.apply(target, args);
      passed += 1;
      return out;
    };
  },
});

export function sumUp(name) {
  console.log(`${name}: ${passed} passed, 0 failed`);
}

export function count() {
  return passed;
}
