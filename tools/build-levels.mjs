// 关卡草案：给定一批字，跑提案 + 合并同名 + 排掉不合法的组合，输出可直接进 index.html 的骨架。
//
//   node tools/build-levels.mjs 玉 生 再 ... > levels.json
//
// 产出的答案只是"机器觉得行"，每条都还要过 tools/compare.mjs 的并排对比。

import { loadIndex, typesOf } from "./lib.mjs";
import { buildBuckets, proposalsFor } from "./propose.mjs";

const DROP = new Set(["士"]);      // 士/土 只差比例，留一个就够，免得答案槽看着像重复

const args = process.argv.slice(2).filter(a => !a.startsWith("--"));
const MAXSCORE = Number((process.argv.find(a => a.startsWith("--score=")) || "--score=0.20").split("=")[1]);
const MAXMM = Number((process.argv.find(a => a.startsWith("--mm=")) || "--mm=0").split("=")[1]);   // 0=拓扑必须完全吻合
const chars = args;
const idx = loadIndex();
const buckets = buildBuckets(idx, 6, true);   // 横竖各拉满：比例不算错

const out = [];
for (const ch of chars) {
  const r = proposalsFor(idx, ch, buckets, { maxMM: MAXMM, maxScore: MAXSCORE, stretch: true });
  if (!r || !r.proposals.length) { console.error(`跳过 ${ch}：没有可用组合`); continue; }
  const types = r.ty.split(",");
  // 一组笔画可能同时像好几个字（十/土），全都收下——只收"最像的那个"正是漏答案的根源
  const byName = new Map();
  for (const p of r.proposals) {
    for (const t of p.top) {
      if (DROP.has(t.c) || t.v > MAXSCORE) continue;
      const cur = byName.get(t.c);
      if (cur) { cur.sets.push(p.set); cur.score = Math.min(cur.score, +t.v.toFixed(3)); }
      else byName.set(t.c, { n: [t.c], ty: p.types.join(","), sets: [p.set], score: +t.v.toFixed(3) });
    }
  }
  const answers = [...byName.values()].map(a => {
    // 同名多种点法时，类型集合可能不同（一 可以是任意一根横），ty 取第一组的
    const seen = new Set();
    a.sets = a.sets.filter(s => !seen.has(s.join(",")) && seen.add(s.join(",")));
    return a;
  });
  out.push({ char: ch, ty: r.ty, n: r.n, answers });
}
process.stdout.write(JSON.stringify(out, null, 0));
console.error(`${out.length} 关，${out.reduce((s, l) => s + l.answers.length, 0)} 个答案`);
