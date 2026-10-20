# dsh-pwsh-guard

[![npm](https://img.shields.io/npm/v/dsh-pwsh-guard.svg)](https://www.npmjs.com/package/dsh-pwsh-guard)
[![release](https://github.com/Steven-Qiang/dsh-pwsh-guard/actions/workflows/release.yml/badge.svg)](https://github.com/Steven-Qiang/dsh-pwsh-guard/actions/workflows/release.yml)
[![license](https://img.shields.io/npm/l/dsh-pwsh-guard.svg)](LICENSE)

A DeepSeek Harness plugin that enforces one rule: **read files with `read`, search with `grep`,
locate files with `glob`** — not with shell text commands.

It registers a `ctx.tools.guard` over `pwsh`, `bash` and `ops_bash`. A call whose command line does
file text I/O is rejected before execution, and the rejection reason names the tool to use instead.

## Rules

| id | group | blocks | use instead |
| --- | --- | --- | --- |
| `search.Select-String`, `search.sls` | textSearch | `Select-String`, `sls` | `grep` |
| `search.findstr`, `search.grep`, `search.rg` | textSearch | `findstr`, `grep`, `rg` | `grep` |
| `read.Get-Content`, `read.gc`, `read.cat`, `read.type` | textRead | `Get-Content` and its aliases | `read` |
| `read.more`, `read.head`, `read.tail` | textRead | `more`, `head`, `tail` | `read` |
| `bypass.node-eval`, `bypass.python-c`, `bypass.php-r`, `bypass.dotnet-io` | runtimeBypass | `node -e`, `python -c`, `php -r`, `[IO.File]::ReadAllText` that read files | `read`, `grep` |
| `wait.Start-Sleep`, `wait.sleep` | sleep | `Start-Sleep`, `sleep` | `job_output` wait, `schedule_create` |
| `pipeline.stderr-merge` | stderrMerge | `2>&1` followed by a pipe | `$LASTEXITCODE`, `2>err.txt` |

Two matching rules keep false positives down:

- Short aliases match in command position only (`^`, `;`, `|`, `&`, `(`, `{`, `$(`), so
  `Get-ChildItem -Type f`, `git gc` and `git log --grep=x` pass.
- Quoted spans are ignored, so `git commit -m "stop using Select-String"` passes. Rules that inspect
  a script body (`node -e ...`) read the raw string.

## Configuration

All fields are optional.

```yaml
- id: pwsh-guard
  name: 'dsh-pwsh-guard'
  config:
    enabled: true
    language: auto          # zh | en | auto
    tools: [pwsh, bash, ops_bash]
    disabledGroups: []      # textSearch | textRead | runtimeBypass | sleep | stderrMerge
    allowPatterns: []       # regexes matched against the raw command; a match allows the call
    rules: []               # extra rules, evaluated before the built-ins
```

```yaml
    rules:
      - id: no-force-push
        pattern: 'git\s+push\s+--force'
        title: '拒绝强推'
        hint: '改用 --force-with-lease'
```

## Installation

From npm:

```
plugin_manager action: install_bundle target: dsh-pwsh-guard
```

From GitHub:

```
plugin_manager action: install_bundle target: https://github.com/Steven-Qiang/dsh-pwsh-guard
```

From a local checkout (`link:`, for development):

```
git clone https://github.com/Steven-Qiang/dsh-pwsh-guard
plugin_manager action: install_bundle target: /path/to/dsh-pwsh-guard
```

After editing code or config, reload without restarting:

```
plugin_manager action: set_plugin target: include:pwsh-guard enabled: false
plugin_manager action: set_plugin target: include:pwsh-guard enabled: true
```

Uninstall: `plugin_manager action: remove_bundle target: dsh-pwsh-guard`.

If `install_bundle` reports `failedAt: registry`, the failure came from another dependency of the
profile; the package link, `package.json` entry and `cordis.yml` row are usually already written.
Check for `node_modules/dsh-pwsh-guard/index.js` and the `id: pwsh-guard` row before retrying.

## Limitations

- Command names inside quotes (`& "Select-String"`, `powershell -Command "Get-Content x"`) are not detected.
- `-EncodedCommand` is not decoded.
- `ops_bash --script_path` is checked by path only, not by script content.
- Directory listing (`Get-ChildItem`, `ls`, `dir`) is out of scope.
- Not a sandbox. For destructive commands and secret access use a dedicated guard such as
  `cc-safety-net`; its rule schema cannot express "deny every use of this command", which is why
  this plugin exists.

## Development

```
npm test
```

36 command fixtures and 8 configuration assertions.

## Release

Versions are owned by CI — do not edit `version`. Pushing to `main` runs
`.github/workflows/release.yml`:

| commits | bump |
| --- | --- |
| `fix:` | patch |
| `feat:` | minor |
| `feat!:` or `BREAKING CHANGE:` | major |
| anything else | no release |

Publishing uses npm Trusted Publishing over OIDC, so no `NPM_TOKEN` is stored. It requires
`permissions.id-token: write` (configured), Node ≥ 22.14 with npm CLI ≥ 11.5.1 (the workflow uses
Node 24 plus `npm install -g npm@latest`), and a `repository.url` that matches this repository.

The Trusted Publisher is configured on npmjs.com for `Steven-Qiang` / `dsh-pwsh-guard` /
`release.yml`. A new package has to be published manually once before that configuration exists,
and a new Trusted Publisher must complete a successful publish within 2 days or it expires.
