# 拆字 · Hanzi-strokes

点选一个汉字里的笔画，拼出藏在其中的其他字。

纯前端单文件，没有构建、没有依赖、离线可玩：打开 `index.html` 就行。

- 30 关 / 167 个答案 / 248 种笔画组合
- 笔画整根选，不能截断、不能变形；类型必须一致（竖不能当竖钩）
- 比例不算错，拓扑才算错（谁穿过谁、谁在哪起笔、谁两头出头）
- 同一组笔画能读成几个字就都收（人/八、王/丰、上/工/土）

设计文档、判定规则、以及"为什么没有全自动判定"的实测数据都在 **[DESIGN.md](DESIGN.md)**。

## 加一关

```bash
node tools/gen-level.mjs 玉          # 枚举笔画子集，列出候选字
node tools/propose.mjs 玉 立 正       # 批量提案（类型 + 形状过滤）
node tools/build-levels.mjs 玉 … > /tmp/draft.json
node tools/compare.mjs /tmp/draft.json /tmp/sheet.html   # 并排对比图，人眼判决
node tools/label-sets.mjs --write    # 全部子集按词汇表标注（补所有等价点法）
node tools/sync-levels.mjs           # 写回 index.html
node tools/play-test.mjs             # 无头浏览器通关自测
```

- `tools/answers.json`：关卡答案的唯一真相（人工审过）
- `tools/drops.json`：人工否决过的组合，机器重跑不会复活
- 笔画数据来自 [hanzi-writer-data](https://github.com/chanind/hanzi-writer-data)（首次运行会自动下载并缓存，约 47MB）
