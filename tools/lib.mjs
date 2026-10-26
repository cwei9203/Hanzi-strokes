// 共用工具：字典缓存、笔画几何、笔画类型分类
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

export const RES = 14;
const CACHE = path.join(os.tmpdir(), "chaizi-hanzi");
const INDEX = path.join(CACHE, "index.json");

/** 全部汉字 → 笔画中心线。首次运行会从 npm 拉 hanzi-writer-data（约 47MB，只拉一次）。 */
export function loadIndex() {
  if (!fs.existsSync(INDEX)) {
    fs.mkdirSync(CACHE, { recursive: true });
    process.stderr.write("首次运行：下载 hanzi-writer-data…\n");
    execSync("npm pack hanzi-writer-data@2.0.1", { cwd: CACHE, stdio: "ignore" });
    execSync("tar xzf hanzi-writer-data-2.0.1.tgz", { cwd: CACHE, stdio: "ignore" });
    const dir = path.join(CACHE, "package");
    const out = {};
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json") || f === "package.json") continue;
      const ch = f.slice(0, -5);
      if ([...ch].length !== 1) continue;
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      if (j.medians) out[ch] = j.medians;
    }
    fs.writeFileSync(INDEX, JSON.stringify(out));
    process.stderr.write(`字典就绪：${Object.keys(out).length} 个字\n`);
  }
  return JSON.parse(fs.readFileSync(INDEX, "utf8"));
}

export function resample(pts, n = RES) {
  const seg = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    seg.push(d);
    total += d;
  }
  if (total === 0) return Array.from({ length: n }, () => [...pts[0]]);
  const out = [];
  for (let k = 0; k < n; k++) {
    let target = (k / (n - 1)) * total, i = 0;
    while (i < seg.length - 1 && target > seg[i]) { target -= seg[i]; i++; }
    const t = seg[i] ? target / seg[i] : 0;
    out.push([
      pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t,
      pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t,
    ]);
  }
  return out;
}

/** 缩放到单位方框。默认等比（保留长宽比）；stretch=true 时横竖各自拉满，
    把"比例不同"从比较里摘出去——游戏规则本来就写着比例不算错。
    例：自 的框比 口 高得多，等比比就过不了，拉开比就成立。 */
export function normalize(strokes, stretch = false) {
  const all = strokes.flat();
  const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  const w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
  const s = Math.max(w, h, 1e-6);
  const sx = stretch ? Math.max(w, 1e-6) : s, sy = stretch ? Math.max(h, 1e-6) : s;
  return strokes.map(st => st.map(([x, y]) => [(x - x0) / sx, (y - y0) / sy]));
}

const pairCost = (a, b) =>
  a.reduce((s, p, i) => s + Math.hypot(p[0] - b[i][0], p[1] - b[i][1]), 0) / RES;

/** 两组笔画的最优配对平均距离（允许笔画顺序不同） */
export function matchCost(sa, sb) { return matchPair(sa, sb).cost; }

/** 同上，同时返回配对（sa[i] ↔ sb[perm[i]]）。
    形状最像的配对不一定拓扑也对，所以在代价可接受的配对里优先挑 mm=0 的。
    raw={a,b,tol} 传原始笔迹，让拓扑用原坐标的绝对容差判；不传就不查拓扑。 */
export function matchPair(sa, sb, raw) {
  const n = sa.length, pc = [];
  for (let i = 0; i < n; i++) { pc.push([]); for (let j = 0; j < n; j++) pc[i].push(pairCost(sa[i], sb[j])); }
  const perms = [];
  const walk = (k, used, perm, sum) => {
    if (k === n) return void perms.push({ sum, perm: [...perm] });
    for (let i = 0; i < n; i++) if (!used[i]) { used[i] = true; perm[k] = i; walk(k + 1, used, perm, sum + pc[k][i]); used[i] = false; }
  };
  walk(0, Array(n).fill(false), Array(n).fill(-1), 0);
  perms.sort((a, b) => a.sum - b.sum);
  const best = perms[0].sum;
  let pick = null;
  for (const p of perms) {
    if (pick && p.sum > best * 1.4 + 0.02) break;
    const mm = raw ? topoMismatch(raw.a, raw.b, p.perm, raw.tol) : 0;
    if (!pick || mm < pick.mm) pick = { cost: p.sum / n, perm: p.perm, mm };
    if (mm === 0) break;
  }
  return pick;
}

/* ── 拓扑关系 ──────────────────────────────────────────────
   判"成立"靠的是谁穿过谁、谁在哪起笔、谁两头出头。比例不管。
   做法：B 的两个端点在 A 的哪一侧（同侧 / 两侧 / 贴线），三笔两两比。
   不看方向、不看长短，所以王→干 成立、正→王 不成立（正左竖不到底横）。 */
const TOUCH = 75;   // 笔画宽度量级。在已验收的 33 组上标定：误报 4 组（12%），
                    // 已否决的 8 组全拦下。所以 mm=0 可以自动放行，mm>0 必须人看。

function sideOf(pt, poly, tol) {
  let best = Infinity, sign = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[i + 1];
    const dx = x2 - x1, dy = y2 - y1;
    const L = Math.hypot(dx, dy) || 1;
    const d = ((pt[0] - x1) * dy - (pt[1] - y1) * dx) / L;   // 带符号垂距
    const t = ((pt[0] - x1) * dx + (pt[1] - y1) * dy) / (L * L);
    const near = t < 0 ? Math.hypot(pt[0] - x1, pt[1] - y1)
               : t > 1 ? Math.hypot(pt[0] - x2, pt[1] - y2)
               : Math.abs(d);
    if (near < best) { best = near; sign = Math.abs(d) < tol ? 0 : Math.sign(d); }
  }
  return best < tol ? 0 : sign;
}

/** B 的两端在 A 的哪儿：'o' 贴上、'-' 同侧、'x' 两侧 */
export function relKey(A, B, tol = TOUCH) {
  const s1 = sideOf(B[0], A, tol), s2 = sideOf(B[B.length - 1], A, tol);
  if (s1 === 0 || s2 === 0) return "o";
  return s1 === s2 ? "-" : "x";
}

/** 两组笔画（已配对）的拓扑有几处不符 */
export function topoMismatch(sa, sb, perm, tol = TOUCH) {
  let bad = 0;
  for (let i = 0; i < sa.length; i++)
    for (let j = i + 1; j < sa.length; j++) {
      const a1 = relKey(sa[i], sa[j], tol) + relKey(sa[j], sa[i], tol);
      const a2 = relKey(sb[perm[i]], sb[perm[j]], tol) + relKey(sb[perm[j]], sb[perm[i]], tol);
      if (a1 !== a2) bad++;
    }
  return bad;
}

/* ── 笔画类型分类 ────────────────────────────────────────────
   坐标是 1024 方格、Y 轴朝上，所以「往下写」= y 减小。
   阈值是拿真实笔画量出来的（见 DESIGN.md §2），不是拍脑袋。          */
const TURN_DEG = 62;      // 超过这个转角认为是一笔折
const DOT_LEN = 0.45;     // 短于字框对角线的这个比例 → 可能是点
const DOT_SLOPE = -0.8;   // 但特别陡的短笔是竖，不是点（中字那根竖只有 0.36 长）

/** 笔画方向。strict=true 用于折笔的每一段：段短，容差要收紧，否则盒子的侧边会被读成撇。 */
function dirLabel(dx, dy, strict = false) {
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  const downTol = strict ? -0.8 : -0.5;
  if (uy > 0.25) return ux < -0.3 ? "左上" : "右上";
  if (uy > downTol) return ux < -0.3 ? "左下" : "右";
  if (ux < -0.5) return "左下";
  if (ux > 0.5) return "右下";
  return "下";
}

const SIMPLE = { 右: "横", 右上: "提", 下: "竖", 左下: "撇", 右下: "捺" };
const BEND = {
  "右|下": "横折", "右|左下": "横撇", "右|右下": "横折", "右|右": "横折",
  "下|右": "竖折", "下|左下": "竖撇", "下|右下": "竖折", "下|左上": "竖钩",
  "左下|右": "撇折", "左下|右下": "撇点", "右下|右": "捺折",
};

/** 弦偏差：最大垂直偏离 / 弦长。撇是弯的（>0.13），竖是直的（<0.09）。 */
function chordDev(pts) {
  const dx = pts[23][0] - pts[0][0], dy = pts[23][1] - pts[0][1];
  const L = Math.hypot(dx, dy) || 1;
  let mx = 0;
  for (const q of pts) {
    mx = Math.max(mx, Math.abs((q[0] - pts[0][0]) * dy - (q[1] - pts[0][1]) * dx) / L);
  }
  return mx / L;
}

export function classify(median, boxSize) {
  const pts = resample(median, 24);
  let len = 0;
  for (let i = 0; i < median.length - 1; i++) {
    len += Math.hypot(median[i + 1][0] - median[i][0], median[i + 1][1] - median[i][1]);
  }

  // 跨 4 个采样点测转角：圆角折只看相邻两点会漏
  const K = 4;
  let worst = 0, at = -1;
  for (let i = K; i < pts.length - K; i++) {
    const ax = pts[i][0] - pts[i - K][0], ay = pts[i][1] - pts[i - K][1];
    const bx = pts[i + K][0] - pts[i][0], by = pts[i + K][1] - pts[i][1];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la < 1e-6 || lb < 1e-6) continue;
    const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
    const deg = Math.acos(cos) * 180 / Math.PI;
    if (deg > worst) { worst = deg; at = i; }
  }

  if (worst > TURN_DEG && at > 0) {
    const s1 = Math.hypot(pts[at][0] - pts[0][0], pts[at][1] - pts[0][1]);
    const s2 = Math.hypot(pts[23][0] - pts[at][0], pts[23][1] - pts[at][1]);
    if (s1 > len * 0.18 && s2 > len * 0.18) {
      const d1 = dirLabel(pts[at][0] - pts[0][0], pts[at][1] - pts[0][1], true);
      const d2 = dirLabel(pts[23][0] - pts[at][0], pts[23][1] - pts[at][1], true);
      return BEND[d1 + "|" + d2] || "折";
    }
  }

  const dx = pts[23][0] - pts[0][0], dy = pts[23][1] - pts[0][1];
  const L = Math.hypot(dx, dy) || 1;
  const uy = dy / L, ux = dx / L;

  // 点：短的、斜的。短横和短的陡竖都不算点。
  if (len < boxSize * DOT_LEN && uy > DOT_SLOPE && Math.abs(uy) > 0.3) return "点";

  // 竖钩：主体往下走，末尾往回挑起
  if (uy < -0.8 && pts[23][1] > pts[21][1] + 0.02 * boxSize) return "竖钩";

  // 陡笔里撇/竖的分界：往左走得多，或者明显弯，就是撇
  if (uy < -0.5) {
    if (ux < -0.35 || (ux < -0.1 && chordDev(pts) > 0.13)) return "撇";
    if (ux > 0.5) return "捺";
    return "竖";
  }
  if (ux < -0.3) return "撇";        // 扁平的长撇（手字第一笔）
  return SIMPLE[dirLabel(dx, dy)];
}

/** 给一个字的全部笔画分类 */
export function typesOf(medians) {
  const all = medians.flat();
  const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  const box = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
  return medians.map(m => classify(m, box));
}

/* ── 笔画类型：细类和族 ─────────────────────────────────────
   分类器把"折笔第一段是竖还是撇"靠 0.5 的余弦阈值分开，换个字就跳：
   去的第三笔（撇折）被读成竖折，云的同一笔被读成撇折。全家 9574 个字里
   84 个字两种标签混用。所以**比较用族，显示用细类**。
   竖和竖钩、捺和点这些不合并——它们的差别不是倾向，是笔画本身。 */
const FAMILY = { 竖折: "折右", 撇折: "折右" };
export const familyOf = t => FAMILY[t] || t;
export const familyKey = types => types.map(familyOf).sort().join(",");

export const sortedTypeKey = types => [...types].sort().join(",");

// 部首区 + 笔画名称 + 古字。这些几何上很像，但玩家不会认它们是「字」。
const NOISE = /[\u2E80-\u2FFF\u31C0-\u31EF]/;
const RADICALS = "丨丿丶亅乀乁乚乛丄丅乂乇亇亍丩丬丱丳丷亠亻彳辶廾廿卅兀尢弋屮囗冂冖凵匚匸卩厶彑彐忄扌氵犭礻衤纟罒耂曰丌卄㔾阝卂龶亖乇乄乊丆乛";
const BANNED = new Set(RADICALS);

/** 是不是一个玩家会认作字的候选 */
export const isWord = c => !NOISE.test(c) && !BANNED.has(c);
