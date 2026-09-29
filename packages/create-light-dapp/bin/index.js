#!/usr/bin/env node
// Zero-dependency scaffolder: copies templates/vite-react, replaces placeholders.
import { cpSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
const positional = args.filter((a) => !a.startsWith("--"));

async function ask(q, def) {
  if (!process.stdin.isTTY) return def;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`${q} (${def}) `)).trim();
  rl.close();
  return a || def;
}

const name = positional[0] ?? (await ask("Project name", "my-light-dapp"));
const network = flags.network ?? (await ask("Network [testnet/mainnet]", "testnet"));
const withDao = (flags.dao ?? (await ask("Include Nervos DAO page? [y/n]", "y"))).toString().startsWith("y");
const pm = detectPm();

const dest = join(process.cwd(), name);
if (existsSync(dest)) { console.error(`✖ ${dest} already exists`); process.exit(1); }
cpSync(join(here, "..", "templates", "vite-react"), dest, { recursive: true });

for (const f of walk(dest)) {
  if (!/\.(ts|tsx|json|md|html|yml)$/.test(f)) continue;
  let s = readFileSync(f, "utf8").replaceAll("__APP_NAME__", name).replaceAll("__NETWORK__", network);
  if (!withDao) s = s.replace(/\/\/ dao-start[\s\S]*?\/\/ dao-end\n?/g, "");
  writeFileSync(f, s);
}
if (!withDao) { try { (await import("node:fs")).rmSync(join(dest, "src/pages/Dao.tsx")); } catch {} }

console.log(`\n✔ Created ${name}\n\n  cd ${name}\n  ${pm} install\n  ${pm} run dev\n\nThen open http://localhost:5173 — watch the Network panel: no JSON-RPC.\n`);

function detectPm() {
  const ua = process.env.npm_config_user_agent ?? "";
  if (ua.startsWith("bun")) return "bun";
  if (ua.startsWith("pnpm")) return "pnpm";
  if (ua.startsWith("yarn")) return "yarn";
  return "npm";
}
function* walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== "node_modules") yield* walk(p); } else yield p;
  }
}
