# AGENTS.md — code-audit 工程规则

本仓是内部工具/载体仓，不参与 Tier 0–4 产品分级。

## 硬边界

- 只允许可信本地仓库作为输入；首版没有容器隔离，禁止拿不可信代码直接跑。
- 禁止 `shell: true`；所有检查命令必须用 `argv` 数组传给 `spawn`。
- 禁止把密钥、token、cookie 写进配置或报告。
- 默认不联网；需要网络的检查由调用方显式配置，且必须在报告里标记。
- 输出流必须限长，禁止无上限把子进程输出读进内存。
- 超时必须可配置，默认 120s，最大 600s。

## 工程纪律

- Node ≥ 22，ESM，import 路径带 `.js` 后缀。
- TypeScript 严格全开：`strict` / `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` / `noUnusedLocals` / `noUnusedParameters`。
- 配置格式变化必须同步 `README.md` 与 `examples/audit.config.json`。
- 新能力先做确定性证据，再考虑 LLM 解释层；LLM 不能单独决定门禁通过。

## 验证门

```bash
npm run typecheck && npm test && npm run build
```

## 提交

- 英文原子提交：`<type>(<scope>): <subject>`。
- 不 push；提交作者必须是用户本人，禁止 AI co-author trailer。
- 未授权不得 commit。
