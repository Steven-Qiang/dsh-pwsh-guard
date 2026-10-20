# dsh-pwsh-guard

[![npm](https://img.shields.io/npm/v/dsh-pwsh-guard.svg)](https://www.npmjs.com/package/dsh-pwsh-guard)
[![release](https://github.com/Steven-Qiang/dsh-pwsh-guard/actions/workflows/release.yml/badge.svg)](https://github.com/Steven-Qiang/dsh-pwsh-guard/actions/workflows/release.yml)
[![license](https://img.shields.io/npm/l/dsh-pwsh-guard.svg)](LICENSE)

[English](README.md) | **简体中文**

DeepSeek Harness 插件，把一条约定变成硬约束：**读文件用 `read`、搜内容用 `grep`、找文件用 `glob`**，
不要用 shell 文本命令。

插件用 `ctx.tools.guard` 注册全局守卫，覆盖 `pwsh`、`bash`、`ops_bash`。命令一旦在用 shell 做文件
文本 I/O，就会在执行前被拒绝，拒绝原因里写明该换哪个工具。拒绝文案跟随宿主语言（中文或英文）。

## 规则

| id | 分组 | 拦截 | 改用 |
| --- | --- | --- | --- |
| `search.Select-String`、`search.sls` | textSearch | `Select-String`、`sls` | `grep` |
| `search.findstr`、`search.grep`、`search.rg` | textSearch | `findstr`、`grep`、`rg` | `grep` |
| `read.Get-Content`、`read.gc`、`read.cat`、`read.type` | textRead | `Get-Content` 及其别名 | `read` |
| `read.more`、`read.head`、`read.tail` | textRead | `more`、`head`、`tail` | `read` |
| `bypass.node-eval`、`bypass.python-c`、`bypass.php-r`、`bypass.dotnet-io` | runtimeBypass | 脚本里读文件的 `node -e`、`python -c`、`php -r`、`[IO.File]::ReadAllText` | `read`、`grep` |
| `wait.Start-Sleep`、`wait.sleep` | sleep | `Start-Sleep`、`sleep` | `job_output` 的 wait、`schedule_create` |
| `pipeline.stderr-merge` | stderrMerge | `2>&1` 之后又接管道 | `$LASTEXITCODE`、`2>err.txt` |

两条判定规则用来压低误报：

- **短别名只在命令位置判定**（`^`、`;`、`|`、`&`、`(`、`{`、`$(`），所以 `Get-ChildItem -Type f`、
  `git gc`、`git log --grep=x` 都会放行。
- **引号内的文字不参与判定**，所以 `git commit -m "stop using Select-String"` 会放行；检查脚本内容
  的规则（`node -e ...`）看原文。

## 配置

所有字段都可省略。

```yaml
- id: pwsh-guard
  name: 'dsh-pwsh-guard'
  config:
    enabled: true
    language: auto          # zh | en | auto
    tools: [pwsh, bash, ops_bash]
    disabledGroups: []      # textSearch | textRead | runtimeBypass | sleep | stderrMerge
    allowPatterns: []       # 正则，命中则整体放行
    rules: []               # 追加自定义规则，排在内置规则之前
```

`language: auto` 依次看 `DSH_LOCALE`、宿主 locale、`LANG` / `LC_ALL`。

```yaml
    rules:
      - id: no-force-push
        pattern: 'git\s+push\s+--force'
        title: '禁止强推'
        hint: '改用 --force-with-lease'
```

## 安装

从 npm：

```
plugin_manager action: install_bundle target: dsh-pwsh-guard
```

从 GitHub：

```
plugin_manager action: install_bundle target: https://github.com/Steven-Qiang/dsh-pwsh-guard
```

从本地 clone（`link:` 安装，方便改代码）：

```
git clone https://github.com/Steven-Qiang/dsh-pwsh-guard
plugin_manager action: install_bundle target: /path/to/dsh-pwsh-guard
```

改完代码或配置，重载即可，不用重启：

```
plugin_manager action: set_plugin target: include:pwsh-guard enabled: false
plugin_manager action: set_plugin target: include:pwsh-guard enabled: true
```

卸载：`plugin_manager action: remove_bundle target: dsh-pwsh-guard`。

如果 `install_bundle` 报 `failedAt: registry`，失败来自 profile 里别的依赖；此时包链接、
`package.json` 条目和 `cordis.yml` 里的行通常已经写好了。重试前先确认
`node_modules/dsh-pwsh-guard/index.js` 与 `id: pwsh-guard` 那一行是否存在。

## 已知缺口

- 引号包住的命令名（`& "Select-String"`、`powershell -Command "Get-Content x"`）检测不到。
- `-EncodedCommand` 不解码。
- `ops_bash --script_path` 只看路径，不看脚本体。
- 目录列举（`Get-ChildItem`、`ls`、`dir`）不在管辖范围。
- 不是沙箱。防破坏性命令与密钥访问请另配专门的 guard（例如 `cc-safety-net`）；它的规则模型
  表达不了「任何一次使用都拦」，所以才有这个插件。

## 开发

```
npm test
```

先用 tsdown 构建，再跑 36 条命令用例和 11 条配置断言。

## 发布

版本由 CI 决定，不要手改 `version`。推送到 `main` 会跑 `.github/workflows/release.yml`：

| 提交 | 版本 |
| --- | --- |
| `fix:` | patch |
| `feat:` | minor |
| `feat!:` 或 `BREAKING CHANGE:` | major |
| 其它 | 不发版 |

发布走 npm Trusted Publishing（OIDC），仓库里不存 `NPM_TOKEN`。要求：`permissions.id-token: write`
（已配）、Node ≥ 22.14 且 npm CLI ≥ 11.5.1（工作流用 Node 24 并 `npm install -g npm@latest`）、
`repository.url` 与仓库一致。

Trusted Publisher 在 npmjs.com 上按 `Steven-Qiang` / `dsh-pwsh-guard` / `release.yml` 配置。新包必须
先手动发布一次才能配置；新建的 Trusted Publisher 必须在 2 天内完成一次成功发布，否则过期。
