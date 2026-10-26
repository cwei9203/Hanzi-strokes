// 给每个笔画子集贴上"它像哪个已收录的字"——按词汇表做 argmin，而不是靠阈值。
//
//   node tools/label-sets.mjs            # 打印会补进来的组合
//   node tools/label-sets.mjs --write    # 写回 tools/answers.json
//
// 分工：人决定**这一关有哪几个字**（词汇表），机器决定**哪些笔画组合算这个字**。
// 旧逻辑是反过来的（机器挑名字、人跟着补），所以老是出现"同一组笔画的另一种点法不算"。
//
// 规则：子集 S 的类型（族级）必须和字 C 一致；在所有类型一致且已收录的字里，
// 取形状最像的那个（argmin）。只要最像的那个够像（≤ LIMIT）就收下。

import fs from "node:fs";
import { loadIndex, resample, normalize, matchPair, familyKey, typesOf } from "./lib.mjs";

const LIMIT = Number((process.argv.find(a => a.startsWith("--limit=")) || "--limit=0.20").split("=")[1]);
const MAXMM = Number((process.argv.find(a => a.startsWith("--mm=")) || "--mm=1").split("=")[1]);
const WRITE = process.argv.includes("--write");
const FILE = new URL("./answers.json", import.meta.url);

const idx = loadIndex();
const table = JSON.parse(fs.readFileSync(FILE, "utf8"));
// 人工否决过的组合：机器永远不许再收进来（tools/drops.json）
const DROPS = new Set(JSON.parse(fs.readFileSync(new URL("./drops.json", import.meta.url), "utf8"))
  .map(d => `${d.char}|${[...d.set].sort((a, b) => a - b).join(",")}`));
const norm = ch => { const m = idx[ch].map(s => resample(s)); return normalize(m, true); };

const added = [];
for (const lv of table) {
  const med = idx[lv.char], n = med.length;
  const types = typesOf(med);
  const vocab = [...new Set(lv.answers.flatMap(a => a.n))];
  const refs = vocab.map(c => ({ c, ty: typesOf(idx[c]), norm: norm(c) }));
  const have = new Set(lv.answers.flatMap(a => a.sets.map(s => [...s].sort((x, y) => x - y).join(","))));

  for (let mask = 1; mask < (1 << n) - 1; mask++) {
    const set = [...Array(n).keys()].filter(i => mask & (1 << i));
    const key = [...set].sort((x, y) => x - y).join(",");
    if (have.has(key) || DROPS.has(`${lv.char}|${key}`)) continue;
    const subKey = familyKey(set.map(i => types[i]));
    const mine = normalize(set.map(i => resample(med[i])), true);
    let best = null;
    for (const r of refs) {
      if (familyKey(r.ty) !== subKey) continue;            // 类型不符：竖不能当竖钩
      const m = matchPair(mine, r.norm, { a: set.map(i => med[i]), b: idx[r.c], tol: 75 });
      if (!best || m.cost < best.v) best = { c: r.c, v: m.cost, mm: m.mm };
    }
    if (!best || best.v > LIMIT || best.mm > (best.c.length && MAXMM)) continue;   // 关系差太多就不算
    have.add(key);
    added.push({ char: lv.char, n: best.c, set, v: best.v, mm: best.mm });
    const a = lv.answers.find(x => x.n[0] === best.c) || (lv.answers.push({ n: [best.c], ty: "", sets: [] }), lv.answers.at(-1));
    a.sets.push(set);
  }
}
// 别名：同一组笔画，如果和词汇表里别的字也几乎一样像（差 ≤ MARGIN），一起收下。
// 玩家心里的名字可能不是机器挑的那个——"对：人 / 八"、"对：王 / 丰"。
const MARGIN = 0.06;
for (const lv of table) {
  const med = idx[lv.char];
  const types = typesOf(med);
  const vocab = [...new Set(lv.answers.flatMap(a => a.n))];
  const refs = vocab.map(c => ({ c, ty: typesOf(idx[c]), norm: norm(c) }));
  for (const a of lv.answers) {
    for (const set of a.sets) {
      const subKey = familyKey(set.map(i => types[i]));
      const mine = normalize(set.map(i => resample(med[i])), true);
      const scored = refs.filter(r => familyKey(r.ty) === subKey)
        .map(r => ({ c: r.c, v: matchPair(mine, r.norm, { a: set.map(i => med[i]), b: idx[r.c], tol: 75 }).cost }))
        .sort((x, y) => x.v - y.v);
      if (!scored.length) continue;
      for (const s2 of scored) {
        if (s2.v > scored[0].v + MARGIN) break;
        if (!a.n.includes(s2.c) && s2.c !== "士" && s2.c !== "入") a.n.push(s2.c);
      }
    }
  }
}

// 一组笔画只能属于一个答案（同一组的其他名字是别名，不是第二个槽位）
for (const lv of table) {
  const byKey = new Map(), keep = [];
  for (const a of lv.answers) {
    let host = null;
    for (const set of a.sets) {
      const k = [...set].sort((x, y) => x - y).join(",");
      const h = byKey.get(k);
      if (h) { host = h; break; }
    }
    if (host) {
      for (const set of a.sets) byKey.set([...set].sort((x, y) => x - y).join(","), host);
      for (const n of a.n) if (!host.n.includes(n)) host.n.push(n);
      continue;
    }
    for (const set of a.sets) byKey.set([...set].sort((x, y) => x - y).join(","), a);
    keep.push(a);
  }
  lv.answers = keep;
}

// ty 由实际选中的笔画反推，validate() 只拿它做类型核对
for (const lv of table) {
  const types = typesOf(idx[lv.char]).join(",").split(",");
  for (const a of lv.answers) if (a.sets.length) a.ty = a.sets[0].map(i => types[i]).join(",");
  lv.answers = lv.answers.filter(a => a.sets.length)
    .sort((x, y) => Math.min(...x.sets.map(s => s.length)) - Math.min(...y.sets.map(s => s.length)));
}

console.log(`补了 ${added.length} 个组合：`);
for (const a of added.sort((x, y) => x.v - y.v)) console.log(`  ${a.char}[${a.set.join(",")}] → ${a.n}  ${a.v.toFixed(2)} mm${a.mm}`);
if (WRITE) { fs.writeFileSync(FILE, JSON.stringify(table)); console.log("\n已写回 tools/answers.json"); }
