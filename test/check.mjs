import { inspectCommand, normalizeSettings, stripQuoted } from '../rules.js'

/**
 * 引擎自测：直接跑规则，不依赖 DSH 运行时。
 * 用法：node test/check.mjs
 */

const defaults = normalizeSettings({})

/** @type {{ command: string, expect: 'blocked' | 'allowed', note?: string }[]} */
const cases = [
  // ── 必须拦下的写法 ────────────────────────────────────────────────
  { command: 'Select-String -Path .\\a.txt -Pattern foo', expect: 'blocked' },
  { command: 'Select-String foo', expect: 'blocked' },
  { command: 'Get-ChildItem -Recurse | Select-String foo', expect: 'blocked' },
  { command: 'sls foo', expect: 'blocked' },
  { command: 'Get-Content .\\AGENTS.md -TotalCount 5', expect: 'blocked' },
  { command: 'Get-Content a.txt -Tail 5', expect: 'blocked' },
  { command: 'gc .\\a.txt', expect: 'blocked' },
  { command: 'cat .\\a.txt', expect: 'blocked' },
  { command: 'type .\\a.txt', expect: 'blocked' },
  { command: 'findstr /s /n foo *.*', expect: 'blocked' },
  { command: 'rg -n "foo" D:\\project\\kjz-vip', expect: 'blocked' },
  { command: 'grep -rn foo src/', expect: 'blocked' },
  { command: 'Get-ChildItem | head -5', expect: 'blocked' },
  { command: 'Get-ChildItem | tail -5', expect: 'blocked' },
  {
    command: 'node -e "const fs=require(\'fs\');console.log(fs.readFileSync(\'a.txt\',\'utf8\'))"',
    expect: 'blocked',
  },
  { command: 'python -c "print(open(\'a.txt\').read())"', expect: 'blocked' },
  { command: 'php -r "echo file_get_contents(\'a.txt\');"', expect: 'blocked' },
  { command: "[IO.File]::ReadAllText('D:\\x.txt')", expect: 'blocked' },
  { command: 'git status 2>&1 | Out-String', expect: 'blocked' },
  { command: 'Start-Sleep -Seconds 5', expect: 'blocked' },
  { command: 'sleep 3', expect: 'blocked' },

  // ── 必须放行的写法（防误伤）──────────────────────────────────────
  { command: 'git status', expect: 'allowed' },
  { command: 'git log --oneline -5', expect: 'allowed' },
  { command: 'Write-Output ok', expect: 'allowed' },
  { command: 'npm run build', expect: 'allowed' },
  { command: 'Get-ChildItem D:\\project -Force', expect: 'allowed' },
  { command: 'Get-ChildItem -Path . -Type f', expect: 'allowed', note: '-Type 是参数，不是 type 命令' },
  { command: 'Get-ChildItem D:\\project -Force | Select-Object -First 3', expect: 'allowed' },
  { command: 'git gc --prune=now', expect: 'allowed', note: 'git gc 不是 Get-Content 别名 gc' },
  { command: 'git grep -n foo', expect: 'allowed', note: 'git 自己的子命令' },
  { command: 'git log --grep=会员中心 -5', expect: 'allowed' },
  { command: 'node -e "console.log(1+1)"', expect: 'allowed', note: '不读文件就不拦' },
  { command: 'git commit -m "禁止 Select-String 这类写法"', expect: 'allowed', note: '引号里只是提到' },
  { command: 'git log --oneline sleep', expect: 'allowed', note: 'sleep 不是命令位置' },

  // ── 已知缺口（引号包住命令名后拦不到）────────────────────────────
  { command: 'powershell -Command "Get-Content D:\\a.txt"', expect: 'allowed', note: '已知缺口：脚本内容在引号里' },
  { command: '& "Select-String" -Path a.txt', expect: 'allowed', note: '已知缺口：命令名在引号里' },
]

let failed = 0

for (const item of cases) {
  const verdict = inspectCommand(item.command, defaults) ? 'blocked' : 'allowed'
  if (verdict !== item.expect) {
    failed += 1
    console.log(`✗ 期望 ${item.expect} 实际 ${verdict} :: ${item.command}`)
  }
}

// ── 配置项自测 ────────────────────────────────────────────────────────
const assertions = [
  ['关掉整组后放行', () => {
    const settings = normalizeSettings({ disabledGroups: ['textRead'] })
    return inspectCommand('Get-Content a.txt', settings) === undefined
  }],
  ['关掉整组不影响别的组', () => {
    const settings = normalizeSettings({ disabledGroups: ['textRead'] })
    return inspectCommand('Select-String foo', settings) !== undefined
  }],
  ['allowPatterns 放行指定命令', () => {
    const settings = normalizeSettings({ allowPatterns: ['^git commit'] })
    return inspectCommand('git commit 2>&1 | Out-String', settings) === undefined
  }],
  ['自定义规则生效', () => {
    const settings = normalizeSettings({
      rules: [{ id: 'no-force-push', pattern: 'git\\s+push\\s+--force', title: '禁止强推', hint: '用 --force-with-lease' }],
    })
    return inspectCommand('git push --force origin master', settings) !== undefined
  }],
  ['非法自定义正则被忽略', () => {
    const settings = normalizeSettings({ rules: [{ pattern: '(' }] })
    return inspectCommand('git status', settings) === undefined
  }],
  ['tools 白名单外的工具不参与', () => {
    const settings = normalizeSettings({ tools: ['bash'] })
    return settings.tools.has('pwsh') === false && settings.tools.has('bash') === true
  }],
  ['默认名单覆盖 ops_bash', () => normalizeSettings({}).tools.has('ops_bash') === true],
  ['引号抹除不改变长度', () => {
    const raw = 'a "b c" d'
    return stripQuoted(raw).length === raw.length
  }],
]

for (const [label, check] of assertions) {
  let ok = false
  try {
    ok = check() === true
  } catch {
    ok = false
  }
  if (!ok) {
    failed += 1
    console.log(`✗ 断言失败 :: ${label}`)
  }
}

if (failed === 0) {
  console.log(`✓ 全部通过：${cases.length} 条命令用例 + ${assertions.length} 条配置断言`)
  process.exit(0)
}
console.log(`✗ ${failed} 项失败`)
process.exit(1)
