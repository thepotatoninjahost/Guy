#!/usr/bin/env node
/*
 * Gunther · www packer.
 *
 * The console is served straight from the repo root (index.html + css/ + js/),
 * but Capacitor wants a single webDir. This assembles ./www as an exact,
 * dependency-free copy of the house — nothing to compile, nothing to inject.
 *
 *     node tools/pack-www.mjs
 */

import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const www = join(root, "www");

rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });

for (const item of ["index.html", "favicon.svg", "css", "js"]) {
  const src = join(root, item);
  if (!existsSync(src)) {
    console.error(`pack-www: missing ${item} — the house is incomplete`);
    process.exit(1);
  }
  cpSync(src, join(www, item), { recursive: true });
}

console.log(`www/ packed from ${root}`);
