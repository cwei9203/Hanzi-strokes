// 并排对比页：左边是关卡字里选中的那几笔，右边是目标字的真实笔迹。
// 两边同一套数据、同一个比例（都按关卡字的墨迹框对齐），所以形状可比。
//
//   node tools/compare.mjs levels.json sheet.html
//
// 机器只负责把图摆出来，判"像不像"是人的事。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [specFile, outFile] = process.argv.slice(2);
const SPEC = JSON.parse(fs.readFileSync(specFile, "utf8"));
const DIR = path.join(os.tmpdir(), "chaizi-hanzi", "package");
const glyph = ch => {
  const j = JSON.parse(fs.readFileSync(path.join(DIR, `${ch}.json`), "utf8"));
  return j.strokes;
};

const box = strokes => {
  // 粗算墨迹框：把路径里的所有数字当点（会把控制点算进去，只作参照，够用）
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const d of strokes) {
    const n = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map(m => +m[0]);
    for (let i = 0; i + 1 < n.length; i += 2) {
      x0 = Math.min(x0, n[i]); x1 = Math.max(x1, n[i]);
      y0 = Math.min(y0, n[i + 1]); y1 = Math.max(y1, n[i + 1]);
    }
  }
  return { x0, y0, x1, y1 };
};

const cell = (lvStrokes, target, set, label) => {
  const b = box(lvStrokes);
  const pad = 40;
  const vb = `${b.x0 - pad} ${900 - b.y1 - pad} ${b.x1 - b.x0 + pad * 2} ${b.y1 - b.y0 + pad * 2}`;
  const left = lvStrokes.map((d, i) =>
    `<path d="${d}" fill="${set.includes(i) ? "#b5382c" : "#ece5d5"}"/>`).join("");
  const right = target ? target.map(d => `<path d="${d}" fill="#241f19"/>`).join("") : "";
  return `<div class="c">
    <div class="pair">
      <svg viewBox="${vb}"><g transform="translate(0,900) scale(1,-1)">${left}</g></svg>
      <svg viewBox="${vb}"><g transform="translate(0,900) scale(1,-1)">${right}</g></svg>
    </div>
    <div class="l">${label}</div>
  </div>`;
};

let cells = "";
for (const lv of SPEC) {
  const ls = glyph(lv.char);
  for (const a of lv.answers)
    cells += cell(ls, glyph(a.n[0]), a.sets[0],
      `${lv.char}[${a.sets[0].join(",")}] → ${a.n[0]}` + (a.v != null ? ` ${a.v.toFixed(2)}` : ""));
}
fs.writeFileSync(outFile, `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;padding:10px;background:#fbf8f2;font:12px/1.4 ui-monospace,monospace;color:#241f19;
       display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
  .c{border:1px solid #e3dbcb;border-radius:6px;background:#fffdf8}
  .pair{display:flex}
  .pair svg{width:50%;height:200px;display:block}
  .pair svg+svg{border-left:1px dashed #e3dbcb}
  .l{text-align:center;padding:2px 0 4px;font-size:11px;color:#6b6255}
</style>${cells}`);
console.log(`${outFile}: ${cells.split('<div class="c">').length - 1} 组`);
