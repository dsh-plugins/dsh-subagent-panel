# npm 发布配置

本插件使用 `.github/workflows/npm-publish.yml` 完成质量检查，再调用组织共享的 [npm 发布工作流](https://github.com/dsh-plugins/dsh-npm-publish) 发布单一 npm 包。

## 触发与版本

| 事件 | 行为 |
| --- | --- |
| Pull Request | 只运行质量检查 |
| 手动运行工作流 | 只运行质量检查 |
| 推送 `main` | 全部质量检查通过后，将 `X.Y.Z-dev.<run_id>` 发布到 `next` |
| 推送 `vX.Y.Z` 标签 | 校验标签与 `package.json` 的稳定版本严格一致，再发布到 `latest` |

`package.json` 的 `version` 始终保留 `X.Y.Z` 格式。正式发布后，共享工作流将 `npm-latest.json` 写回 `main`；若主分支仍为刚发布的版本，同时递增补丁版本。已发布版本重跑时会核对 `gitHead`，防止复用其他提交的版本号。

## 质量检查矩阵

工作流固定 Node.js 24，pnpm 使用 `packageManager` 中的 `11.17.0`；共享发布任务也显式使用同一 pnpm 版本。

| 平台 | 架构 | GitHub 执行器 |
| --- | --- | --- |
| Linux | x64 | `ubuntu-24.04` |
| Linux | arm64 | `ubuntu-24.04-arm` |
| Windows | x64 | `windows-2025` |
| Windows | arm64 | `windows-11-arm` |
| macOS | x64 | `macos-15-intel` |
| macOS | arm64 | `macos-15` |

上述执行器来自 [GitHub 官方列表](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。每项执行 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test`、`pnpm build` 和 `npm pack --dry-run`。`setup-node` 按操作系统、原生架构和锁文件哈希隔离 pnpm 缓存。发布任务重新安装依赖，不恢复质量检查缓存。

产物为 `@dsh-plugin/dsh-subagent-panel` 的 JavaScript npm 包，tarball 名为 `dsh-plugin-dsh-subagent-panel-<version>.tgz`，由 npm 注册表分发。Codex、Claude Code 的平台依赖由 npm 依赖包提供。本仓库不生成桌面安装器，不设置系统代码签名密钥或按架构区分的 Release 附件；发布时生成 npm 来源证明。

质量检查运行本地协议与时间线测试，不连接模型服务。真实模型会话验证见 [本地验证记录](verification.md)。跨平台运行结果以 GitHub Actions 为准。

## 发布认证

推荐使用 npm Trusted Publisher，通过 OpenID Connect（OIDC）授权 GitHub Actions 发布。npm 中的配置应指向调用方：

| 字段 | 值 |
| --- | --- |
| Organization or user | `dsh-plugins` |
| Repository | `dsh-subagent-panel` |
| Workflow filename | `npm-publish.yml` |
| Environment name | 留空 |
| Allowed actions | 允许 `npm publish` |

调用方和共享工作流均授予发布任务 `id-token: write`；正式发布的元数据写回任务使用 `contents: write`。质量检查只有 `contents: read`，不会接收 npm 发布凭据。

尚未建立可信发布关系时，可配置具有该包发布权限的仓库或组织 Secret `NPM_TOKEN`，工作流将其显式传给共享发布任务；使用 OIDC 时可以不配置该 Secret。首次发布前需要完成其中一种认证方式。

可信发布配置、调用方匹配规则与来源证明说明见 [npm 官方文档](https://docs.npmjs.com/trusted-publishers/)。配置应在准备执行首次发布时完成，避免长时间未使用导致过期。
