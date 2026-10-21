#!/usr/bin/env node
// Tong hop du lieu do CDN (data/*.jsonl tu nhanh `monitor`) thanh bang theo nguon: tong, theo ngay, theo gio (UTC).
// Dung: node monitor/report.mjs [duong-dan ...] [--since 2026-10-21[T06:00]] [--phase first|warm|grid] [--short]
// Khong co duong dan: doc ./data (vd sau `git worktree add /tmp/mon origin/monitor` roi chay trong do) hoac
// `node monitor/report.mjs --fetch` de lay data/ tu nhanh monitor qua `git show`.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const since = opt("since") ? new Date(opt("since").length <= 10 ? opt("since") + "T00:00:00Z" : opt("since")) : null;
const onlyPhase = opt("phase");
const paths = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));

let lines = [];
if (argv.includes("--fetch")) {
  execFileSync("git", ["fetch", "origin", "monitor"], { stdio: "ignore" });
  const names = execFileSync("git", ["ls-tree", "--name-only", "origin/monitor", "data/"], { encoding: "utf8" }).split("\n").filter((f) => f.endsWith(".jsonl"));
  for (const f of names) lines.push(...execFileSync("git", ["show", `origin/monitor:${f}`], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n"));
} else {
  for (const p of paths.length ? paths : ["data"]) {
    const fs = statSync(p).isDirectory() ? readdirSync(p).filter((f) => f.endsWith(".jsonl")).map((f) => join(p, f)) : [p];
    for (const f of fs) lines.push(...readFileSync(f, "utf8").split("\n"));
  }
}
const runs = lines.filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } })
  .filter((r) => !since || new Date(r.time) >= since).sort((a, b) => a.time.localeCompare(b.time));
if (!runs.length) { console.error("khong co du lieu"); process.exit(1); }

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
const acc = () => ({ runs: 0, n: 0, ok: 0, e404: 0, timeout: 0, other: 0, t: [], d: [], hit: 0 });
function add(a, x) {
  a.runs++; a.n += x.n; a.ok += x.ok; a.e404 += x.e404; a.timeout += x.timeout; a.other += x.other;
  a.t.push(...x.t); a.d.push(...x.d); a.hit += x.cache.HIT ?? 0;
}
const fmt = (v) => (v === null ? "-" : String(v));
const row = (key, a) => [...key, a.runs, a.n, `${(100 * (a.n - a.ok) / a.n).toFixed(1)}%`, a.e404, a.timeout,
  fmt(pct(a.t, 0.5)), fmt(pct(a.t, 0.95)), fmt(pct(a.d, 0.95)), `${(100 * a.hit / a.n).toFixed(0)}%`];

function table(title, keyCols, bucketOf) {
  const groups = new Map();
  for (const r of runs) for (const [src, phases] of Object.entries(r.sources)) for (const [ph, x] of Object.entries(phases)) {
    if (onlyPhase && ph !== onlyPhase) continue;
    const k = [...bucketOf(r), src, ph].join("\t");
    if (!groups.has(k)) groups.set(k, acc());
    add(groups.get(k), x);
  }
  const head = [...keyCols, "nguon", "pha", "lan", "mau", "loi", "404", "timeout", "TTFB p50", "TTFB p95", "tong p95", "HIT"];
  const rows = [...groups].sort().map(([k, a]) => row(k.split("\t"), a));
  console.log(`\n## ${title}\n`);
  console.log(`| ${head.join(" | ")} |\n|${head.map(() => "---").join("|")}|`);
  for (const r of rows) console.log(`| ${r.join(" | ")} |`);
}

const failed = runs.filter((r) => !r.pass).length;
console.log(`# Bao cao CDN: ${runs.length} lan do, ${runs[0].time} .. ${runs.at(-1).time}, ${failed} lan vuot nguong`);
console.log(`Runner: ${[...new Set(runs.map((r) => r.runner + (r.colo ? `/${r.colo}` : "")))].join(", ")}. Don vi ms; TTFB/tong chi tinh yeu cau 200; gio theo UTC.`);
table("Tong", [], () => []);
if (!argv.includes("--short")) {
table("Theo ngay", ["ngay"], (r) => [r.time.slice(0, 10)]);
table("Theo gio (UTC)", ["gio"], (r) => [r.time.slice(11, 13)]);
}
