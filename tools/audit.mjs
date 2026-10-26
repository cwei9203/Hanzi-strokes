// 关卡体检：把每一关**所有**类型相符、形状接近的候选字列出来，指出哪些还没收进关卡。
//
//   node tools/audit.mjs                 # 文本报告
//   node tools/audit.mjs --sheet /tmp/x  # 另外生成并排对比图（x0.html, x1.html…）
//
// 这是"反着查"：生成器管"提案"，这个管"漏没漏"。
// 判错的代价是混进假答案，漏掉的代价是玩家点了明明像的字却被说不成字——
// 后者更伤，因为它让玩家怀疑整张表。所以只要形状够近就必须出现在这张清单里。

import fs from "node:fs";
import { loadIndex } from "./lib.mjs";
import { buildBuckets, proposalsFor } from "./propose.mjs";

const MAXMM = 1, MAXSCORE = 0.18, PER_SHEET = 20;

// 故意不收的：和已收的字同形或只差比例。列在这儿是为了让审计结果干净，
// 而不是让它们消失在过滤条件里。
const ALIAS = {
  士: "土",      // 只差比例：士 上横长、土 下横长
  入: "人",      // 同形
  八: "人",      // 同形（木/米 的撇捺，槽位显示 人）
};

// 对着"已审过的答案表"查，而不是对着 index.html 查——有些答案可能已审核、
// 只是还没同步进页面，那不算漏。
const LEVELS = JSON.parse(fs.readFileSync(new URL("./answers.json", import.meta.url), "utf8"));

const idx = loadIndex();
const buckets = buildBuckets(idx, 6, true);   // 横竖各拉满：比例不算错

const cells = [];
for (const lv of LEVELS) {
  const known = new Set(lv.answers.flatMap(a => a.n));
  const r = proposalsFor(idx, lv.char, buckets, { maxMM: MAXMM, maxScore: MAXSCORE, stretch: true });
  const best = new Map();
  for (const p of r.proposals) for (const t of p.top) {
    if (known.has(t.c)) continue;
    const cur = best.get(t.c);
    if (!cur || t.v < cur.v) best.set(t.c, { char: lv.char, n: t.c, set: p.set, v: t.v, mm: t.mm });
  }
  cells.push(...best.values());
}
cells.sort((a, b) => a.v - b.v);

const aliased = cells.filter(c => ALIAS[c.n]);
const real = cells.filter(c => !ALIAS[c.n]);
const names = [...new Set(aliased.map(c => `${c.n}≈${ALIAS[c.n]}`))].join(" ");
console.log(`按别名政策排除 ${aliased.length} 条${names ? `（${names}）` : ""}`);
console.log(real.length ? `${real.length} 个候选待判：` : "没有漏网候选。");
for (const c of real)
  console.log(`  ${c.char}[${c.set.join(",")}] → ${c.n}  分 ${c.v.toFixed(2)} mm ${c.mm}`);

const out = process.argv[3];
if (out) {
  for (let i = 0; i < real.length; i += PER_SHEET) {
    const spec = [];
    for (const c of real.slice(i, i + PER_SHEET)) {
      let g = spec.find(s => s.char === c.char);
      if (!g) spec.push(g = { char: c.char, answers: [] });
      g.answers.push({ n: [c.n], sets: [c.set], v: c.v });
    }
    fs.writeFileSync(`${out}${i / PER_SHEET}.json`, JSON.stringify(spec));
  }
  console.log(`\n对比图素材：${out}0.json …（node tools/compare.mjs ${out}0.json ${out}0.html）`);
}
