// 把关卡草案写进 index.html：GLYPHS 笔画轮廓 + LEVELS 关卡表，一起替换。
//
//   node tools/sync-levels.mjs                 # 用 tools/answers.json（推荐）
//   node tools/sync-levels.mjs /tmp/draft.json # 用别的草案
//
// 草案里每条答案都应当已经过 tools/compare.mjs 的并排对比。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { familyKey } from "./lib.mjs";

const DIR = path.join(os.tmpdir(), "chaizi-hanzi", "package");
const strokesOf = ch =>
  JSON.parse(fs.readFileSync(path.join(DIR, `${ch}.json`), "utf8")).strokes;

// 默认读已审过的答案表（tools/answers.json，人工验收过的唯一真相），
// 传参才读别的草案。这样重新生成不会把审过的答案悄悄弄丢。
const src = process.argv[2] || new URL("./answers.json", import.meta.url).pathname;
const draft = JSON.parse(fs.readFileSync(src, "utf8"));
const file = new URL("../index.html", import.meta.url);

const chars = draft.map(l => l.char);
const glyphs = "{" + chars.map(ch =>
  `${JSON.stringify(ch)}:${JSON.stringify(strokesOf(ch))}`).join(",") + "}";

let levelSrc = "";
for (const lv of draft) {
  const types = lv.ty.split(",");
  const answers = lv.answers.map(a => {
    const want = familyKey(a.ty.split(","));
    const sets = a.sets.filter(s => familyKey(s.map(i => types[i])) === want);
    // ty 记的是"玩家选中的那几笔的类型"，供 validate() 逐笔核对
    return { ...a, ty: sets[0].map(i => types[i]).join(","), sets };
  }).filter(a => a.sets.length);
  levelSrc += `  { char:${JSON.stringify(lv.char)}, ty:${JSON.stringify(lv.ty)}, answers:[\n` +
    answers.map(a =>
      `    { n:${JSON.stringify(a.n)}, ty:${JSON.stringify(a.ty)}, sets:${JSON.stringify(a.sets)} },`).join("\n") +
    `\n  ]},\n`;
}

// GLYPHS 是一行（原来就是一行），不能跨行替换，否则会吞掉后面的 LEVELS
const html = fs.readFileSync(file, "utf8")
  .replace(/^const GLYPHS = \{.*\};$/m, `const GLYPHS = ${glyphs};`)
  .replace(/const LEVELS = \[[\s\S]*?\n\];/, `const LEVELS = [\n${levelSrc}];`);
fs.writeFileSync(file, html);
console.log(`${chars.length} 关 / ${draft.reduce((s, l) => s + l.answers.length, 0)} 个答案 → index.html (${(html.length / 1024).toFixed(0)}KB)`);
