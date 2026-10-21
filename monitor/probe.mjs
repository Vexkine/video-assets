#!/usr/bin/env node
// Do CDN cho Vexkine/video-assets: raw, jsDelivr @master, jsDelivr @<sha>. Node 20+, khong phu thuoc goi.
// Dung: node monitor/probe.mjs [--n 40] [--conc 10] [--grid 60] [--gridconc 6] [--timeout 20000] [--repo Vexkine/video-assets] [--ref master] [--sha <commit>] [--pretty]
// In dung 1 dong JSON ra stdout (log ra stderr). Thoat 1 neu vuot nguong, 0 neu dat, 2 neu loi dung.
import { execFileSync } from "node:child_process";
import { hostname } from "node:os";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const N = +arg("n", 40), CONC = +arg("conc", 10), GRID = +arg("grid", 60), GCONC = +arg("gridconc", 6);
const TIMEOUT = +arg("timeout", 20000), REPO = arg("repo", "Vexkine/video-assets"), REF = arg("ref", "master");
// Nguong dat (CDN-PLAN.md muc 5): p95 TTFB < 1500 ms o tep nong, loi < 1%, khong timeout.
const MAX_P95 = 1500, MAX_ERR = 0.01;

const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 1 << 26 });
const sha = arg("sha") ?? git("rev-parse", "HEAD").trim();
// ls-tree thay vi doc thu muc: chay duoc ca khi checkout khong co blob (workflow dung --filter=blob:none).
const files = git("ls-tree", "-z", "--name-only", "HEAD", "assets/").split("\0")
  .filter((f) => f.endsWith(".svg")).map((f) => f.slice("assets/".length));
if (files.length < N + 20) { console.error(`chi co ${files.length} svg trong assets/`); process.exit(2); }
const shuffled = [...files].sort(() => Math.random() - 0.5);
const sample = shuffled.slice(0, N), gridSet = shuffled.slice(0, GRID); // luoi gom mau da do + them tep chua ai goi

const SOURCES = {
  raw: (p) => `https://raw.githubusercontent.com/${REPO}/${REF}/assets/${encodeURIComponent(p)}`,
  jsdelivr_master: (p) => `https://cdn.jsdelivr.net/gh/${REPO}@${REF}/assets/${encodeURIComponent(p)}`,
  jsdelivr_sha: (p) => `https://cdn.jsdelivr.net/gh/${REPO}@${sha}/assets/${encodeURIComponent(p)}`,
};

const cacheOf = (h) => (h.get("cf-cache-status") ?? h.get("x-cache") ?? "-").split(",")[0].trim().toUpperCase();
let colo = null;
async function one(url) {
  const t0 = performance.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
    const ttfb = performance.now() - t0;
    await r.arrayBuffer();
    if (!colo && url.includes("jsdelivr")) colo = (r.headers.get("cf-ray") ?? "").split("-")[1] ?? null;
    return { s: r.status, ttfb, total: performance.now() - t0, cache: cacheOf(r.headers) };
  } catch (e) {
    return { s: e.name === "TimeoutError" || e.name === "AbortError" ? "timeout" : "error", ttfb: 0, total: performance.now() - t0, cache: "-" };
  }
}
async function run(urls, conc) {
  const out = []; let i = 0; const t0 = performance.now();
  await Promise.all(Array.from({ length: conc }, async () => { while (i < urls.length) out.push(await one(urls[i++])); }));
  return summarize(out, (performance.now() - t0) / 1000);
}
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? null; };
function summarize(rs, wall) {
  const ok = rs.filter((r) => r.s === 200), cnt = (f) => rs.filter(f).length;
  const t = ok.map((r) => Math.round(r.ttfb)), d = ok.map((r) => Math.round(r.total));
  const cache = {}; for (const r of rs) cache[r.cache] = (cache[r.cache] ?? 0) + 1;
  return {
    n: rs.length, ok: ok.length, e404: cnt((r) => r.s === 404), timeout: cnt((r) => r.s === "timeout"),
    other: cnt((r) => r.s !== 200 && r.s !== 404 && r.s !== "timeout"), wallS: +wall.toFixed(1),
    ttfbP50: pct(t, 0.5), ttfbP95: pct(t, 0.95), totalP50: pct(d, 0.5), totalP95: pct(d, 0.95), cache, t, d,
  };
}

const failures = [], sources = {};
for (const [name, mk] of Object.entries(SOURCES)) {
  console.error(`# ${name}`);
  const first = await run(sample.map(mk), CONC);            // lan dau: co the tep chua nong
  const warm = await run(sample.map(mk), CONC);             // lan hai: cung tep, da nong
  const grid = await run(gridSet.map(mk), GCONC);           // mo phong editor: luoi 60 hinh tai luoi, 6 luong
  sources[name] = { first, warm, grid };
  const bad = (p, x) => x.n - x.ok > x.n * MAX_ERR || x.timeout > 0;
  if (bad("first", first)) failures.push(`${name}: lan dau ${first.n - first.ok}/${first.n} loi (404=${first.e404}, timeout=${first.timeout})`);
  if (bad("warm", warm)) failures.push(`${name}: lan nong ${warm.n - warm.ok}/${warm.n} loi`);
  if (warm.ttfbP95 === null || warm.ttfbP95 >= MAX_P95) failures.push(`${name}: p95 TTFB nong ${warm.ttfbP95} ms >= ${MAX_P95}`);
  if (bad("grid", grid)) failures.push(`${name}: luoi ${grid.n - grid.ok}/${grid.n} loi (timeout=${grid.timeout})`);
}

// index/release.json: chi tinh khi ton tai tren raw (chua phat hanh chi muc thi bo qua).
let release = { exists: false };
const rel = (b) => fetch(b, { signal: AbortSignal.timeout(TIMEOUT) }).then(async (r) => ({ s: r.status, body: r.status === 200 ? await r.text() : "" })).catch(() => ({ s: "error", body: "" }));
const rr = await rel(`https://raw.githubusercontent.com/${REPO}/${REF}/index/release.json`);
if (rr.s === 200) {
  const jj = await rel(`https://cdn.jsdelivr.net/gh/${REPO}@${REF}/index/release.json`);
  let commit = null; try { commit = JSON.parse(rr.body).commit ?? null; } catch {}
  release = { exists: true, raw: rr.s, jsdelivr: jj.s, commit, matchesHead: commit ? commit === sha || sha.startsWith(commit) : null };
  if (jj.s !== 200) failures.push(`release.json: jsDelivr tra ${jj.s}`);
}

const result = {
  time: new Date().toISOString(),
  runner: process.env.GITHUB_ACTIONS ? `github-actions/${process.env.RUNNER_OS ?? "?"}/${process.env.RUNNER_ARCH ?? "?"}` : `local/${hostname()}`,
  region: process.env.MONITOR_REGION ?? null, colo, sha, n: N, grid: GRID, gridConc: GCONC, conc: CONC,
  sources, release, pass: failures.length === 0, failures,
};
console.log(JSON.stringify(result, null, process.argv.includes("--pretty") ? 2 : 0));
process.exit(result.pass ? 0 : 1);
