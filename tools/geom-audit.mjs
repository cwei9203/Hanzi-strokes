// 已有关卡的体检：每组的笔画，在【笔画类型相同】的候选里，最像谁？
//
//   node tools/geom-audit.mjs
//
// 只回答排序问题，不回答成立与否。比例差异不算错（王 → 干 是对的）。
import fs from "node:fs";
import { loadIndex, typesOf, resample, normalize, matchCost, sortedTypeKey, isWord } from "./lib.mjs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const src = html.split("<script>")[1].split("</script>")[0];
const LEVELS = eval(src.match(/const LEVELS = (\[[\s\S]*?\n\];)/)[1].replace(/;$/, ""));

const idx = loadIndex();

// 名字 → 类型，用来筛掉类型不符的候选
const TYPE_OF = {};
for (const lv of LEVELS) for (const a of lv.answers) for (const n of a.n) TYPE_OF[n] = a.ty;

// 和关卡字笔画数相同的候选，按「笔数|类型」分桶
const buckets = new Map();
for (const [c, m] of Object.entries(idx)) {
  if (!isWord(c) || m.length > 5) continue;
  const k = `${m.length}|${sortedTypeKey(typesOf(m))}`;
  (buckets.get(k) || buckets.set(k, []).get(k)).push({ c, norm: normalize(m.map(s => resample(s))) });
}

let worst = 0;
for (const lv of LEVELS) {
  const med = idx[lv.char];
  const types = typesOf(med);
  console.log(`── ${lv.char}（${types.join(" ")}）`);

  // 同一关里所有声明的答案名，是唯一的合法候选集
  const names = new Set(lv.answers.flatMap(a => a.n));

  for (const a of lv.answers) {
    const cells = [];
    for (const set of a.sets) {
      const key = `${set.length}|${sortedTypeKey(set.map(i => types[i]))}`;
      const mine = normalize(set.map(i => resample(med[i])));
      const top = (buckets.get(key) || [])
        .filter(o => names.has(o.c))
        .map(o => ({ c: o.c, v: matchCost(mine, o.norm) }))
        .sort((x, y) => x.v - y.v)
        .slice(0, 2);
      const rank = top.findIndex(t => a.n.includes(t.c)) + 1;
      if (rank !== 1) worst++;
      cells.push({ set, top, rank });
    }
    const bad = cells.find(c => c.rank !== 1);
    console.log(`  ${a.n.join("/").padEnd(6)} ${bad ? "⚠" : "✓"}   ` +
      cells.map(c => `[${c.set.join("")}] ` + c.top.map(t => `${t.c}${t.v.toFixed(2)}`).join(" ")).join("  |  "));
  }
}

console.log(worst === 0
  ? "\n✓ 每组笔画在本关的类型相符候选里都最像自己。"
  : `\n⚠ ${worst} 组最像的不是标的名字，看一眼。`);
