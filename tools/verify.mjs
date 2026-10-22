#!/usr/bin/env node
// Kiem nhat quan toan kho video-assets (Node 20+, khong phu thuoc goi).
// Dung: node tools/verify.mjs [--changed <base>] [--strict] [--json]
//   --changed <base>  chi kiem tung tep doi so voi <base> (kiem cheo manifest/index van chay toan bo, vi re)
//   --strict          canh bao tinh la loi (thoat ma 1)
// Gioi han da biet: bam tai tinh duoc cho moi SVG (assetId = sha256 8 ky tu dau cua NOI DUNG TEP, ke ca diagram
// da gan id lop, vi Asset Engine bam tren noi dung thuc ghi); anh photo: bam noi dung that, hoac `oid` neu la con tro LFS.
// Bien the recolor cung bam tren noi dung moi nen cung quy tac.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, appendFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const changedBase = args.includes("--changed") ? args[args.indexOf("--changed") + 1] : null;
const strict = flag("--strict");
const A = join(ROOT, "assets"), I = join(ROOT, "index");
const t0 = Date.now();
const errors = [], warnings = [];
const err = (c, m) => errors.push([c, m]);
const warn = (c, m) => warnings.push([c, m]);
const sha = (b, n) => createHash("sha256").update(b).digest("hex").slice(0, n);
const git = (...a) => { try { return execFileSync("git", ["-C", ROOT, ...a], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; } };
const readJson = (p, c) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch (e) { err(c, `${relative(ROOT, p)}: khong doc duoc JSON (${e.message})`); return null; } };

const ID_RE = /^[a-z0-9-]+\.(icon|diagram|animation|photo)\.[0-9a-f]{8}$/;
const SPDX_OK = /^(CC0-1\.0|LicenseRef-PD|LicenseRef-NASA-PD|MIT|Apache-2\.0|BSD(-[A-Za-z0-9.-]+)?|ISC|Unlicense|OFL-1\.1|MPL-2\.0|CC-BY-[0-9.]+)$/;
const BAD_LIC = /(^|-)(SA|NC|ND)(-|$)|GPL/i; // SA/NC/ND/GPL: loai
const MAX_BYTES = 30 * 1024 * 1024;
const hh = (id) => id.split(".")[2].slice(0, 2);

// ---- tap tep can kiem (che do --changed)
let only = null;
if (changedBase) {
  const out = git("diff", "--name-only", "--diff-filter=d", changedBase, "HEAD");
  if (out === null) { err("changed", `khong so duoc voi ${changedBase} (git fetch du lich su chua?)`); } else only = new Set(out.split("\n").filter(Boolean));
}
const inScope = (rel) => !only || only.has(rel);

// ---- (a) manifest <-> tep
const manifest = readJson(join(A, "manifest.json"), "manifest") ?? {};
const ids = Object.keys(manifest);
const onDisk = new Set(readdirSync(A).filter((f) => f !== "manifest.json"));
const wanted = new Set();
for (const id of ids) {
  const e = manifest[id];
  if (!ID_RE.test(id)) { err("assetId", `${id}: sai mau <nguon>.<nhom>.<bam8>`); continue; }
  const cls = id.split(".")[1];
  if (e.class !== cls) err("assetId", `${id}: class '${e.class}' khac nhom trong id '${cls}'`);
  const m = /^assets\/(.+)\.([a-z]+)$/.exec(e.file ?? "");
  if (!m || m[1] !== id) err("tenTep", `${id}: file='${e.file}' phai la assets/${id}.<duoi>`);
  const ext = m?.[2];
  if (ext && !(cls === "photo" ? ["jpg", "png", "webp"] : ["svg", "json"]).includes(ext)) err("tenTep", `${id}: duoi .${ext} khong hop le cho class ${cls}`);
  if (m) { wanted.add(`${m[1]}.${ext}`); if (!onDisk.has(`${m[1]}.${ext}`)) err("thieuTep", `${id}: manifest co nhung khong co tep ${e.file}`); }
  const L = e.license ?? {};
  if (!L.spdx) err("giayPhep", `${id}: thieu license.spdx`);
  else if (L.spdx === "CC-BY") { // loi that tren kho hien tai (wellcome.photo.a1cea735): SPDX khong co phien ban; tam la canh bao, --strict thanh loi
    warn("giayPhep", `${id}: spdx 'CC-BY' khong phien ban (khong phai ma SPDX chuan, nen la CC-BY-4.0)`);
    if (!L.attribution) err("giayPhep", `${id}: CC-BY thieu attribution`);
  } else if (BAD_LIC.test(L.spdx) || !SPDX_OK.test(L.spdx)) err("giayPhep", `${id}: spdx '${L.spdx}' ngoai allowlist`);
  else if (/^CC-BY-/.test(L.spdx) && !L.attribution) err("giayPhep", `${id}: ${L.spdx} thieu attribution`);
  if (!L.source || !L.source.includes(":")) err("giayPhep", `${id}: license.source phai bat dau '<nguon>:'`);
  if (cls === "photo") { if (!(e.width > 0 && e.height > 0) || e.viewBox) err("schema", `${id}: photo can width+height, khong viewBox`); }
  else if (!e.viewBox || e.width || e.height) err("schema", `${id}: ${cls} can viewBox, khong width/height`);
}
for (const f of onDisk) if (!wanted.has(f)) err("mocoi", `assets/${f}: tep mo coi (khong co muc manifest)`);

// ---- (b)(c)(e) tung tep
const LFS_RE = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\r?\noid sha256:([0-9a-f]{64})\r?\nsize (\d+)/;
const SVG_BAD = [
  [/<script/i, "<script"], [/\son[a-z]+\s*=/i, "thuoc tinh on*="], [/javascript:/i, "javascript:"],
  [/<foreignObject/i, "<foreignObject"], [/<image[\s>]/i, "<image"], [/<!ENTITY/i, "<!ENTITY"],
];
const HREF_RE = /(?:xlink:)?href\s*=\s*["']\s*([^"']*)["']/gi;
let nSvg = 0, nImg = 0, nLfs = 0;
for (const id of ids) {
  const e = manifest[id]; if (!e?.file || !ID_RE.test(id)) continue;
  if (!inScope(e.file)) continue;
  const p = join(ROOT, e.file); if (!existsSync(p)) continue;
  const size = statSync(p).size;
  if (size >= MAX_BYTES) err("kichThuoc", `${e.file}: ${(size / 1048576).toFixed(1)} MB >= 30 MB`);
  const buf = readFileSync(p), want = id.split(".")[2], ext = e.file.split(".").pop();
  if (ext === "svg") {
    nSvg++;
    const s = buf.toString("utf8");
    for (const [re, name] of SVG_BAD) if (re.test(s)) err("anToanSvg", `${e.file}: chua ${name}`);
    for (const m of s.matchAll(HREF_RE)) if (!m[1].startsWith("#")) { err("anToanSvg", `${e.file}: href ra ngoai '${m[1].slice(0, 60)}'`); break; }
    if (sha(buf, 8) !== want) err("toanVen", `${e.file}: sha256(noi dung)[0..8]=${sha(buf, 8)} khac assetId`);
  } else if (cls(id) === "photo") {
    nImg++;
    // anh trong git thuc te la gi (kho phuc vu qua CDN doc blob, khong qua smudge)
    const blob = git("cat-file", "blob", `:${e.file}`);
    const head = (blob ?? buf.subarray(0, 200).toString("latin1"));
    const ptr = LFS_RE.exec(head);
    if (ptr) { nLfs++; warn("lfs", `${e.file}: la con tro Git LFS; raw/jsDelivr chi tra con tro, phai dung media.githubusercontent.com (xem README)`); }
    const real = LFS_RE.test(buf.subarray(0, 200).toString("latin1")) ? null : buf;
    const got = real ? sha(real, 8) : ptr ? ptr[1].slice(0, 8) : null;
    if (got && got !== want) err("toanVen", `${e.file}: bam anh ${got} khac assetId`);
    if (!got) warn("toanVen", `${e.file}: khong tai lai duoc bam anh`);
  } else if (ext === "json") {
    if (sha(buf, 8) !== want) warn("toanVen", `${e.file}: bam json khong khop (quy tac bam animation chua ro)`);
  }
}
function cls(id) { return id.split(".")[1]; }

// ---- (d) index
const relPath = join(I, "release.json");
if (!existsSync(relPath)) err("index", "index/release.json khong ton tai");
else {
  const rel = readJson(relPath, "index");
  if (rel) {
    const listed = new Set(Object.keys(rel.files ?? {}));
    const actual = [];
    const walk = (d) => { for (const n of readdirSync(d, { withFileTypes: true })) { const f = join(d, n.name); n.isDirectory() ? walk(f) : actual.push(relative(ROOT, f)); } };
    walk(I);
    for (const f of actual) if (f !== "index/release.json" && !listed.has(f)) err("index", `${f}: co tren dia nhung khong co trong release.json`);
    const metaIds = new Map(), searchTok = new Set();
    let attrN = 0, nMeta = 0, nSearch = 0, nColl = 0, nAttr = 0;
    const cnt = { meta: 0, search: 0, collections: 0, attribution: 0 };
    for (const [f, [bytes, h]] of Object.entries(rel.files ?? {})) {
      const p = join(ROOT, f);
      if (!existsSync(p)) { err("index", `${f}: release.json liet ke nhung thieu tep`); continue; }
      const b = readFileSync(p);
      if (b.length !== bytes || sha(b, 12) !== h) err("index", `${f}: bam/kich thuoc lech release.json`);
      const part = f.split("/")[1]; if (part in cnt) cnt[part]++;
      const j = f.endsWith(".json") ? (() => { try { return JSON.parse(b.toString()); } catch { err("index", `${f}: JSON hong`); return null; } })() : null;
      if (!j) continue;
      const base = f.split("/").pop().replace(".json", "");
      if (part === "meta") for (const m of j) {
        if (!manifest[m.id]) err("index", `${f}: id mo coi ${m.id}`);
        else if (hh(m.id) !== base) err("index", `${f}: ${m.id} sai phan manh (phai la meta/${hh(m.id)}.json)`);
        if (metaIds.has(m.id)) err("index", `meta trung ${m.id}`); metaIds.set(m.id, 1);
      } else if (part === "search") for (const [t, l] of Object.entries(j)) { searchTok.add(t); for (const id of l) if (!manifest[id]) err("index", `${f}: id mo coi ${id}`); }
      else if (part === "collections") for (const id of j.assets ?? []) { if (!manifest[id]) err("index", `${f}: id mo coi ${id}`); }
      else if (part === "attribution") for (const id of Object.keys(j)) { attrN++; if (!manifest[id]) err("index", `${f}: id mo coi ${id}`); else if (hh(id) !== base) err("index", `${f}: ${id} sai phan manh`); }
    }
    for (const id of ids) if (!metaIds.has(id)) err("index", `${id}: co trong manifest nhung thieu trong meta/${hh(id)}.json`);
    const nAttrExpected = ids.filter((id) => manifest[id].license?.attribution).length;
    if (attrN !== nAttrExpected) err("index", `attribution: ${attrN} muc, manifest co ${nAttrExpected} hinh can ghi cong`);
    const c = rel.counts ?? {}, byCls = {};
    for (const id of ids) byCls[cls(id)] = (byCls[cls(id)] ?? 0) + 1;
    const chk = (k, v) => { if (c[k] !== v) err("index", `counts.${k}=${c[k]} nhung thuc te ${v}`); };
    chk("assets", ids.length); for (const [k, n] of Object.entries(byCls)) chk(`class_${k}`, n);
    for (const k of Object.keys(c)) if (k.startsWith("class_") && !byCls[k.slice(6)]) chk(k, 0);
    chk("meta", cnt.meta); chk("search", cnt.search); chk("collections", cnt.collections); chk("attribution", cnt.attribution);
    chk("attributionEntries", attrN); chk("searchTokens", searchTok.size);
    // release.commit phai la commit co that (index sinh truoc commit hinh; khong ep bang HEAD)
    if (rel.commit && git("cat-file", "-t", rel.commit) === null) warn("index", `release.commit ${rel.commit.slice(0, 8)} khong co trong lich su (clone nong?)`);
  }
}

// ---- quy uoc commit: commit sua assets/ hoac index/ nen co trailer `Asset-Engine: <phien ban>` (chi canh bao, chi voi --changed)
if (changedBase) {
  const log = git("log", "--format=%H%x00%B%x01", `${changedBase}..HEAD`, "--", "assets", "index");
  for (const rec of (log ?? "").split("\x01").map((s) => s.trim()).filter(Boolean)) {
    const [h, body] = rec.split("\x00");
    if (!/^Asset-Engine:\s*\S+/m.test(body ?? "")) warn("commit", `${h.slice(0, 8)}: sua assets/ hoac index/ nhung thieu trailer 'Asset-Engine: <phien ban>'`);
  }
}

// ---- bao cao
const ms = Date.now() - t0;
const group = (l) => { const g = {}; for (const [c, m] of l) (g[c] ??= []).push(m); return g; };
const lines = [];
lines.push(`verify: ${ids.length} muc manifest, ${nSvg} svg + ${nImg} anh kiem tung tep${only ? ` (che do --changed ${changedBase}: ${only.size} tep doi)` : ""}, ${ms} ms`);
lines.push(`ket qua: ${errors.length} loi, ${warnings.length} canh bao${strict ? " (--strict: canh bao tinh la loi)" : ""}`);
for (const [title, l] of [["LOI", errors], ["CANH BAO", warnings]]) {
  const g = group(l);
  for (const [c, ms2] of Object.entries(g)) { lines.push(`\n${title} [${c}] x${ms2.length}`); for (const m of ms2.slice(0, 15)) lines.push(`  - ${m}`); if (ms2.length > 15) lines.push(`  ... va ${ms2.length - 15} muc nua`); }
}
const text = lines.join("\n");
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Kiem tra kho hinh ${errors.length || (strict && warnings.length) ? ":x:" : ":white_check_mark:"}\n\n\`\`\`\n${text}\n\`\`\`\n`);
process.exit(errors.length || (strict && warnings.length) ? 1 : 0);
