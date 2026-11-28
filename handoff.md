# code-audit handoff

## 待办登记（标准）

> 本段是本产品唯一活跃待办入口；完成一项改 `[x]`，并在「最近变更」留证据。
> 最近同步：2026-11-29

<!-- tier0:todos v1 -->
| id | title | status | priority | owner | next | evidence | updated |
|---|---|---|---|---|---|---|---|
| CA-01 | 0.3.0 推送远端并同步 main | done | p1 | owner | 0.3.0 已 push `origin/dev`，并经 PR #1（merge `2bc4949`）合入 `origin/main`；本地 `dev` 与远端一致 | `handoff.md` | 2026-11-29 |
| CA-02 | commerce-os CI 接入审计门 | blocked | p1 | self | 0.3.0 推送后，在 commerce-os CI 增加 `code-audit --profile release` | `commerce-os/docs/delivery/2026-11-22-audit-gate.md` | 2026-11-25 |
<!-- /tier0:todos -->

0.3.0 已推送远端并经 PR #1 合入 `main`（2026-11-29 复核：本地 `dev` 与 `origin/dev` 一致，`origin/main` 含 0.3.0 提交 `305ec6e`）。release 本地实测 6/6 passed。

## 当前状态（2026-11-25 复核）

- 版本 **0.3.0**：profile 选择、检查 `kind`、`requirementIds`/`acceptanceIds`、`summary` 与证据 SHA-256（commit `c94d5f0`）。
- 自带 CI：`.github/workflows/ci.yml`（self-audit，commit `193ec2a`）。
- 本地门：19 个测试、self audit 全绿（2026-11-22 记录，见 bayjf `docs/tier0/handoff.md`）。
- 远端：`origin/dev` 与 `origin/main` 均已包含 0.3.0（经 PR #1 合入，merge `2bc4949`）。

## 最近变更

- 2026-11-25：按 bayjf 组合级 handoff 对账建立本文件，登记两条活跃待办；未改代码。
- 2026-11-29：复核发现 0.3.0 已 push `origin/dev` 并经 PR #1 合入 `origin/main`（merge `2bc4949`），CA-01 实为 done；更新本文件纠正过期的「领先 7 个提交未 push」描述。
