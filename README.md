# code-audit

代码审计 + 测试证据跑器。它不是一个“AI 看代码”的产品，而是一条可复现的证据流水线：

- 读取仓库里的 `audit.config.json`
- 按配置顺序执行检查命令（无 shell）
- 收集退出码、耗时、stdout/stderr（有上限）
- 输出 `report.json` + `report.md` 证据包
- 必选检查失败时以非零退出码结束，可直接作为门禁

## 快速开始

```bash
npm install
npm run build
node dist/cli.js --repo /path/to/repo --config audit.config.json --out .code-audit
```

也可以本地 link 后使用命令入口：

```bash
npm link
code-audit --repo . --config audit.config.json --out .code-audit
```

## 配置

```json
{
  "version": 1,
  "checks": [
    {
      "id": "typecheck",
      "title": "TypeScript typecheck",
      "argv": ["npm", "run", "typecheck"],
      "required": true,
      "timeoutMs": 120000
    },
    {
      "id": "test",
      "title": "Unit tests",
      "argv": ["npm", "test"],
      "required": true,
      "timeoutMs": 300000
    }
  ]
}
```

约束：

- `argv` 必须是数组，禁止 `shell: true`；参数原样传给子进程。
- `id` 必须唯一。
- `cwd` 只能是仓库内的相对目录。
- 默认 `required: true`，默认超时 120s，最大 600s。
- 每个输出流最多保留 2 MiB，超出部分只记录截断字节数。

## 输出

默认写到 `--out` 指定目录：

- `report.json`：机器可读证据包
- `report.md`：人读摘要
- `checks/<id>.stdout.log` / `checks/<id>.stderr.log`

退出码：

- `0`：所有必选检查通过
- `1`：至少一个必选检查失败 / 超时 / 启动错误
- `2`：配置或运行参数错误

## 边界

- **只允许可信本地仓库**。当前没有容器隔离，不能拿来跑不可信代码。
- **不做 AI 代码审查**。LLM 解释、修复建议、测试生成是后续独立层。
- **不做网络访问控制**。首版由调用方保证仓库和命令可信；容器/网络隔离是下一阶段。
- 这是独立工具仓，不依赖特定产品线。
