// 候选答案提案：给一批字，枚举每个笔画子集，列出【笔画类型相符 + 在常用字表内】的候选。
//
//   node tools/propose.mjs 玉 立 正            # 文本报告
//   node tools/propose.mjs --json 玉 立 正     # 机读，供 tools/compare.mjs 用
//
// 只提案，不判决。定案前必须过 tools/compare.mjs 的并排对比。

import fs from "node:fs";
import { loadIndex, typesOf, resample, normalize, matchPair, matchCost, sortedTypeKey, familyKey, isWord, topoMismatch } from "./lib.mjs";

// 答案词汇表：全是普通人在正常语境下会认作"字"的常用字。
// 不收部首字（冂匚凵亠）、笔画名（丨丿丶）、生僻字（乂丄）。
const COMMON = "一二三十干工土士上下人入八大太天夫木本未末术才寸丁七王玉主立正生白百目日口中内由甲申电田只兄古石右左且早羊米来半平手毛牛车水小火小山川少不力刀又女子己也元云去开井五六四九千回曲西至共全光先交名各同舌竹虫贝见可哥丁丁";
export const OK = new Set([...COMMON]);

const MAXSCORE = 0.20;

export function proposalsFor(idx, ch, buckets, { maxMM = 0, maxScore = MAXSCORE, stretch = false, allowAll = false } = {}) {
  const med = idx[ch];
  if (!med) return null;
  const types = typesOf(med);
  const n = med.length;
  const out = [];
  for (let mask = 1; mask < (1 << n) - 1; mask++) {
    const set = [...Array(n).keys()].filter(i => mask & (1 << i));
    const subTypes = set.map(i => types[i]);
    const key = `${set.length}|${familyKey(subTypes)}`;
    const mine = normalize(set.map(i => resample(med[i])), stretch);
    const raw = set.map(i => med[i]);
    const scored = (buckets.get(key) || [])
      .filter(o => allowAll || OK.has(o.c))
      .map(o => ({ c: o.c, v0: matchCost(mine, o.norm), norm: o.norm }))
      .filter(o => o.v0 <= maxScore * 1.6)
      .sort((a, b) => a.v0 - b.v0)
      .slice(0, 12)                                    // 贵的拓扑搜索只做前 12 个
      .map(o => {
        const m = matchPair(mine, o.norm, { a: raw, b: idx[o.c], tol: 75 });
        return { c: o.c, v: m.cost, mm: m.mm };
      })
      .filter(o => o.v <= maxScore && o.mm <= maxMM)  // 超分或拓扑不符（mm 大于阈值）的丢
      .sort((a, b) => a.v - b.v)
      .slice(0, 6);
    if (scored.length) out.push({ set, types: subTypes, top: scored });
  }
  return { char: ch, ty: types.join(","), n, proposals: out.sort((a, b) => a.top[0].v - b.top[0].v) };
}

export function buildBuckets(idx, maxStrokes = 6, stretch = false) {
  const buckets = new Map();
  for (const [c, m] of Object.entries(idx)) {
    if (!isWord(c) || m.length > maxStrokes) continue;
    const k = `${m.length}|${familyKey(typesOf(m))}`;
    const arr = buckets.get(k) || [];
    arr.push({ c, norm: normalize(m.map(s => resample(s)), stretch) });
    buckets.set(k, arr);
  }
  return buckets;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const chars = args.filter(a => !a.startsWith("--"));
  const idx = loadIndex();
  const buckets = buildBuckets(idx, 6);
  const res = chars.map(c => proposalsFor(idx, c, buckets)).filter(Boolean);
  if (json) {
    fs.writeFileSync("/tmp/proposals.json", JSON.stringify(res));
    console.error(`/tmp/proposals.json: ${res.length} 个字`);
  } else {
    for (const r of res) {
      console.log(`\n${r.char}（${r.n} 画 ${r.ty}）${r.proposals.length} 组`);
      for (const p of r.proposals)
        console.log(`  [${p.set.join("")}] ${p.types.join("/").padEnd(12)} ` +
          p.top.map(t => `${t.c}${t.v.toFixed(2)}`).join("  "));
    }
  }
}
