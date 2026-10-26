// 全流程自测：起一个无头 Chromium，按真实坐标点笔画，把每一关都打通一遍。
//
//   node tools/play-test.mjs
//   CHROME=/path/to/chrome node tools/play-test.mjs      # 换浏览器
//
// 为什么不用 DOM 直接调 toggle()：那样绕过了命中判定，测不出"点哪根选哪根"。

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const BIN = process.env.CHROME || process.env.HOME +
  "/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const PAGE = new URL("../index.html", import.meta.url).href;
const PORT = 9399;

const chrome = spawn(BIN, ["--headless=new", `--remote-debugging-port=${PORT}`,
  "--no-first-run", "--user-data-dir=/tmp/chaizi-play", "about:blank"], { stdio: "ignore" });
const wait = ms => new Promise(r => setTimeout(r, ms));

let targets;
for (let i = 0; i < 60; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (targets.length) break; } catch {}
  await wait(200);
}
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener("open", r));

let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener("message", e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown")
    errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return "ERR " + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
  return r.result?.result?.value;
};

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Page.navigate", { url: PAGE });
await wait(900);

// 每关：按 sets[0] 的笔画顺序，用真实坐标点在 svg 上，再按落笔
const out = await ev(`(async()=>{
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rows = [];
  localStorage.removeItem("chaizi.v2"); store = load();
  for (let g = 0; g < LEVELS.length; g++) {
    loadLevel(g); await sleep(20);
    const svg = el.board.querySelector("svg"), gr = svg.querySelector("g");
    const paths = [...svg.querySelectorAll(".st")];
    const dmin = (pt, i) => { let m = 1e9;
      paths.forEach((p, j) => { if (j === i) return; const L = p.getTotalLength();
        for (let k = 0; k <= 20; k++) { const t = p.getPointAtLength(L * k / 20); m = Math.min(m, Math.hypot(t.x - pt.x, t.y - pt.y)); } });
      return m; };
    // 鼠标坐标是整数像素，所以每根笔画都挑"离别的笔画最远"的那个点去点
    const scr = i => { const path = paths[i], L = path.getTotalLength(); let best = null, bs = -1;
      for (const f of [0.15, 0.25, 0.35, 0.5, 0.65, 0.75, 0.85]) {
        const t = path.getPointAtLength(L * f), m = dmin(t, i);
        if (m > bs) { bs = m; best = t; } }
      const q = best.matrixTransform(gr.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; };
    const clickAt = (x, y) => svg.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: y }));
    const bad = [];
    for (const a of lv.data.answers) {
      document.getElementById("clr").click();
      for (const i of a.sets[0]) { const q = scr(i); clickAt(q.x, q.y); }
      if (sel.slice().sort().join() !== a.sets[0].slice().sort().join())
        bad.push(a.n[0] + " 选中" + sel.join(",") + " 应为" + a.sets[0].join(","));
      document.getElementById("go").click(); await sleep(15);
    }
    await sleep(500);
    const done = document.getElementById("panel").hidden === false;
    rows.push({ 关: g + 1, 字: lv.data.char, 答案: lv.data.answers.length, 通关: done, 错: bad });
    if (!done) break;
    document.getElementById("pBtn").click(); await sleep(30);
  }
  return rows;
})()`);

if (typeof out === "string") { console.log(out); process.exit(1); }
let fail = 0;
for (const r of out) {
  if (!r.通关 || r.错.length) fail++;
  console.log(`${r.通关 && !r.错.length ? "✓" : "✗"} 第${r.关}关 ${r.字} ${r.答案}个答案` +
    (r.错.length ? "  " + r.错.join(" / ") : ""));
}
const total = await ev("JSON.stringify(load())");
console.log(`\n${out.length} 关，失败 ${fail}，存档 ${total}`);
if (errors.length) console.log("页面异常：\n" + errors.join("\n"));
ws.close(); chrome.kill();
process.exit(fail || errors.length ? 1 : 0);
