// 关卡生成器：给定一个字，枚举它所有笔画子集，列出每个子集在【笔画类型相符】
// 的候选字里最像谁。人来挑名字，机器负责不漏。
//
//   node tools/gen-level.mjs 玉
//   node tools/gen-level.mjs 玉 --top 6
//
// 输出末尾有一段可以直接贴进 index.html 的 answers 骨架。
import { loadIndex, typesOf, resample, normalize, matchCost, sortedTypeKey, isWord } from "./lib.mjs";

const args = process.argv.slice(2);
const ch = args.find(a => !a.startsWith("--"));
const TOP = Number(args.includes("--top") ? args[args.indexOf("--top") + 1] : 4);
const ALIAS = 0.035;   // 和最优解的差距小于这个值 → 认为是同一个字的别名（日/曰 这种要人挑）
if (!ch) {
  console.error("用法: node tools/gen-level.mjs <字> [--top 4]");
  process.exit(1);
}

const idx = loadIndex();
const med = idx[ch];
if (!med) {
  console.error(`字典里没有「${ch}」`);
  process.exit(1);
}

const types = typesOf(med);
const n = med.length;
console.log(`\n${ch}  ${n} 画`);
types.forEach((t, i) => console.log(`  ${i}  ${t}`));
console.log(`\nty 字段: ty:"${types.join(",")}"`);

// 候选字按「笔数 + 类型组合」建索引
const buckets = new Map();
for (const [c, m] of Object.entries(idx)) {
  if (c === ch || m.length > n || !isWord(c)) continue;
  const t = typesOf(m);
  const k = `${m.length}|${sortedTypeKey(t)}`;
  const arr = buckets.get(k) || [];
  arr.push({ c, m, t });
  buckets.set(k, arr);
}
// 每种组合里的候选预先归一化，省得每次重算
for (const arr of buckets.values()) {
  for (const o of arr) o.norm = normalize(o.m.map(s => resample(s)));
}

const results = [];
console.log("");
for (let mask = 1; mask < (1 << n) - 1; mask++) {
  const set = [...Array(n).keys()].filter(i => mask & (1 << i));
  const subTypes = set.map(i => types[i]);
  const k = `${set.length}|${sortedTypeKey(subTypes)}`;
  const mine = normalize(set.map(i => resample(med[i])));

  const scored = (buckets.get(k) || [])
    .map(o => ({ c: o.c, v: matchCost(mine, o.norm) }))
    .sort((a, b) => a.v - b.v)
    .slice(0, TOP);

  if (!scored.length) {
    console.log(`[${set.join("")}] ${subTypes.join("/")}  —— 类型相符的字库里一个都没有`);
    results.push({ set, types: subTypes, top: [] });
    continue;
  }
  console.log(`[${set.join("")}] ${subTypes.join("/").padEnd(14)} ` +
    scored.map(s => `${s.c}${s.v.toFixed(2)}`).join("  "));
  results.push({ set, types: subTypes, top: scored });
}

// 每个笔画组一行。故意不跨组合并——不同笔画组凑出来的同名答案，
// 可能其中一组其实是别的形状（田的 [123] 也会被算成「口」，但它没有左竖）。
console.log(`\n${"─".repeat(64)}\n建议骨架（每组一行，同名答案的合并要手工做，别信自动合并）:\n`);
console.log(`  { char:"${ch}", ty:"${types.join(",")}", answers:[`);
const rows = results.filter(r => r.top.length).sort((a, b) => a.top[0].v - b.top[0].v);
for (const r of rows) {
  const cut = r.top[0].v + ALIAS;
  const names = r.top.filter(t => t.v <= cut).map(t => t.c);
  console.log(`    { n:[${names.map(x => `"${x}"`).join(",")}], ty:"${r.types.join(",")}", sets:[[${r.set.join(",")}]] },` +
    `   // ${r.top[0].v.toFixed(3)}`);
}
console.log(`  ]},`);
console.log(`\n分数低 ≠ 成立。最像的那个也可能根本不是字：木[023] 最像「大」，`);
console.log(`但大的撇要从横的上方穿过去，木的撇是从横上起笔的。类型和几何都过了，还得人看一眼。`);
