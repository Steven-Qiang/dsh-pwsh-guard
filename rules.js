/**
 * Rule engine. Pure functions only: the guard is synchronous and must not do IO.
 */

const CMD_HEAD = '(?:^|[;&|(){}\\x60]|\\$\\()'

export const DEFAULT_TOOLS = ['pwsh', 'bash', 'ops_bash']

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Short aliases match in command position only, so `-Type` and `git gc` pass.
function atCommandHead(name) {
  return new RegExp(`${CMD_HEAD}[ \\t]*&?[ \\t]*["']?${escapeRegExp(name)}(?=["'\\s;|)&]|$)`, 'i')
}

// Full cmdlet names cannot collide with other words.
function anywhere(name) {
  return new RegExp(`(?<![\\w-])${escapeRegExp(name)}(?![\\w-])`, 'i')
}

function hitBy(regex) {
  return (command) => {
    const match = regex.exec(command)
    return match ? { matched: match[0], index: match.index } : null
  }
}

// Two conditions: an interpreter call that also touches a file-reading API.
function hitWhen(trigger, api, describe) {
  return (command) => {
    if (!trigger.test(command)) return null
    const match = api.exec(command)
    return match ? { matched: describe(match[0]), index: match.index } : null
  }
}

// Blank out quoted spans, keeping the length so indexes stay aligned. A command
// mentioned inside a string is not a command being run.
export function stripQuoted(command) {
  const chars = command.split('')
  let quote = null
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index]
    if (quote) {
      chars[index] = ' '
      if (quote === '"' && char === '`' && index + 1 < chars.length) {
        index += 1
        chars[index] = ' '
        continue
      }
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      chars[index] = ' '
    }
  }
  return chars.join('')
}

const BUILTIN_RULES = [
  // textSearch
  {
    id: 'search.Select-String',
    group: 'textSearch',
    title: '命令里出现 `Select-String`（在 shell 里检索文件内容）',
    hint: '改用 grep 工具搜内容（传 path + include 收窄范围）；找文件路径用 glob。',
    test: hitBy(anywhere('Select-String')),
  },
  {
    id: 'search.sls',
    group: 'textSearch',
    title: '命令里出现 `sls`（Select-String 的别名）',
    hint: '改用 grep 工具搜内容。',
    test: hitBy(atCommandHead('sls')),
  },
  {
    id: 'search.findstr',
    group: 'textSearch',
    title: '命令里出现 `findstr`',
    hint: '改用 grep 工具搜内容。',
    test: hitBy(anywhere('findstr')),
  },
  {
    id: 'search.grep',
    group: 'textSearch',
    title: '命令里出现 `grep`',
    hint: '改用 grep 工具（ripgrep，自带 include 过滤）；`git grep` 不在拦截范围。',
    test: hitBy(atCommandHead('grep')),
  },
  {
    id: 'search.rg',
    group: 'textSearch',
    title: '命令里出现 `rg`',
    hint: '改用 grep 工具，路径与 include 由它收窄。',
    test: hitBy(atCommandHead('rg')),
  },

  // textRead
  {
    id: 'read.Get-Content',
    group: 'textRead',
    title: '命令里出现 `Get-Content`（在 shell 里读文件）',
    hint: '改用 read 工具读文件（支持 offset/limit）；查日志用对应的 MCP 工具（cat/tail/grep）。',
    test: hitBy(anywhere('Get-Content')),
  },
  {
    id: 'read.gc',
    group: 'textRead',
    title: '命令里出现 `gc`（Get-Content 的别名）',
    hint: '改用 read 工具读文件。',
    test: hitBy(atCommandHead('gc')),
  },
  {
    id: 'read.cat',
    group: 'textRead',
    title: '命令里出现 `cat`（Get-Content 的别名）',
    hint: '改用 read 工具读文件。',
    test: hitBy(atCommandHead('cat')),
  },
  {
    id: 'read.type',
    group: 'textRead',
    title: '命令里出现 `type`（Get-Content 的别名）',
    hint: '改用 read 工具读文件。',
    test: hitBy(atCommandHead('type')),
  },
  {
    id: 'read.more',
    group: 'textRead',
    title: '命令里出现 `more`（分页读文件）',
    hint: '改用 read 工具按 offset/limit 分页读。',
    test: hitBy(atCommandHead('more')),
  },
  {
    id: 'read.head',
    group: 'textRead',
    title: '命令里出现 `head`（截取文件头部）',
    hint: '改用 read 工具（offset=1 + limit）。',
    test: hitBy(atCommandHead('head')),
  },
  {
    id: 'read.tail',
    group: 'textRead',
    title: '命令里出现 `tail`（截取文件尾部）',
    hint: '改用 read 工具（先读总行数再按 offset 取尾部），或日志类 MCP 的 tail。',
    test: hitBy(atCommandHead('tail')),
  },

  // runtimeBypass: script bodies live inside quotes, so these read the raw command.
  {
    id: 'bypass.node-eval',
    group: 'runtimeBypass',
    scope: 'raw',
    title: '用 `node -e/--eval` 在脚本里读文件',
    hint: '直接 read 工具读文件、grep 工具搜内容——不要用运行时脚本绕过去。',
    test: hitWhen(
      /\bnode(?:\.exe)?\b[^|;&\r\n]*\s(?:-e|-p|--eval|--print)\b/i,
      /(require\s*\(\s*['"](?:node:)?fs|from\s+['"]node:fs|readFileSync|readFile\b|createReadStream|readdir\b|readdirSync|statSync|existsSync)/,
      (api) => `node -e … ${api} …`,
    ),
  },
  {
    id: 'bypass.python-c',
    group: 'runtimeBypass',
    scope: 'raw',
    title: '用 `python -c` 在脚本里读文件',
    hint: '直接 read 工具读文件、grep 工具搜内容。',
    test: hitWhen(
      /\b(?:python|python3|py)(?:\.exe)?\b[^|;&\r\n]*\s-c\b/i,
      /(open\s*\(|Path\s*\(|\bread_text\b|\bread_bytes\b|glob\.|\bos\.walk\b|\bfileinput\b)/,
      (api) => `python -c … ${api} …`,
    ),
  },
  {
    id: 'bypass.php-r',
    group: 'runtimeBypass',
    scope: 'raw',
    title: '用 `php -r` 在脚本里读文件',
    hint: '直接 read 工具读文件、grep 工具搜内容。',
    test: hitWhen(
      /\bphp(?:\.exe)?\b[^|;&\r\n]*\s-r\b/i,
      /(file_get_contents|fopen\s*\(|fgets\s*\(|fread\s*\(|scandir\s*\(|glob\s*\(|SplFileObject)/,
      (api) => `php -r … ${api} …`,
    ),
  },
  {
    id: 'bypass.dotnet-io',
    group: 'runtimeBypass',
    title: '用 .NET 文件 API 读文件（`[IO.File]::…`）',
    hint: '直接 read 工具读文件；这不是 shell 该干的活。',
    test: hitBy(
      /\[(?:System\.)?IO\.(?:File|Directory)\]::(?:Read\w*|Open\w*|GetFiles|GetDirectories|Enumerate\w*)/i,
    ),
  },

  // sleep
  {
    id: 'wait.Start-Sleep',
    group: 'sleep',
    title: '命令里出现 `Start-Sleep`（在 shell 里空等）',
    hint: '不要空等：要等结果用 job_output 的 wait，要定时用 schedule_create。',
    test: hitBy(anywhere('Start-Sleep')),
  },
  {
    id: 'wait.sleep',
    group: 'sleep',
    title: '命令里出现 `sleep`（Start-Sleep 的别名）',
    hint: '不要空等：要等结果用 job_output 的 wait，要定时用 schedule_create。',
    test: hitBy(atCommandHead('sleep')),
  },

  // stderrMerge
  {
    id: 'pipeline.stderr-merge',
    group: 'stderrMerge',
    title: '命令把 stderr 用 `2>&1` 合并后又接了管道',
    hint: '去掉 2>&1：判断成败看 $LASTEXITCODE，需要留 stderr 就写 `2>err.txt`，别让 PS 把 stderr 变成 NativeCommandError。',
    test: hitBy(/2>&1[^\r\n]{0,400}\|/),
  },
]

// Invalid patterns are dropped rather than failing activation.
function compileCustomRules(entries) {
  if (!Array.isArray(entries)) return []
  const compiled = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || typeof entry.pattern !== 'string') continue
    if (entry.pattern.trim() === '') continue
    let regex
    try {
      regex = new RegExp(entry.pattern, typeof entry.flags === 'string' ? entry.flags : 'i')
    } catch {
      continue
    }
    compiled.push({
      id: typeof entry.id === 'string' && entry.id !== '' ? entry.id : `custom.${compiled.length}`,
      group: typeof entry.group === 'string' && entry.group !== '' ? entry.group : 'custom',
      title:
        typeof entry.title === 'string' && entry.title !== ''
          ? entry.title
          : `命令命中自定义规则 /${entry.pattern}/`,
      hint: typeof entry.hint === 'string' && entry.hint !== '' ? entry.hint : '该写法被禁用，请换一种做法。',
      test: hitBy(regex),
    })
  }
  return compiled
}

export function normalizeSettings(config) {
  const raw = config && typeof config === 'object' && !Array.isArray(config) ? config : {}

  const toolNames = Array.isArray(raw.tools)
    ? raw.tools.filter((entry) => typeof entry === 'string' && entry.trim() !== '')
    : []
  const disabledGroups = new Set(
    Array.isArray(raw.disabledGroups) ? raw.disabledGroups.filter((entry) => typeof entry === 'string') : [],
  )

  const allowPatterns = []
  if (Array.isArray(raw.allowPatterns)) {
    for (const pattern of raw.allowPatterns) {
      if (typeof pattern !== 'string' || pattern.trim() === '') continue
      try {
        allowPatterns.push(new RegExp(pattern, 'i'))
      } catch {
        // ignore
      }
    }
  }

  return {
    enabled: raw.enabled !== false,
    tools: new Set(toolNames.length > 0 ? toolNames : DEFAULT_TOOLS),
    disabledGroups,
    allowPatterns,
    rules: [...compileCustomRules(raw.rules), ...BUILTIN_RULES],
  }
}

export function commandFrom(toolName, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined
  const value = args[toolName === 'terminal_send' ? 'text' : 'command']
  return typeof value === 'string' ? value : undefined
}

const SNIPPET_LIMIT = 80

function formatDenial(rule, hit, command) {
  const raw = typeof hit.index === 'number' ? command.slice(hit.index, hit.index + 120) : String(hit.matched)
  const snippet = raw.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LIMIT) || String(hit.matched)
  return [
    `[pwsh-guard] 已拦截：${rule.title}`,
    `命中片段：${snippet}`,
    rule.hint,
    `（规则 ${rule.id}；确需放行请让用户调整 pwsh-guard 的 config）`,
  ].join('\n')
}

export function inspectCommand(command, settings) {
  if (typeof command !== 'string' || command.trim() === '') return undefined
  if (settings.allowPatterns.some((pattern) => pattern.test(command))) return undefined

  const views = { raw: command, code: stripQuoted(command) }

  for (const rule of settings.rules) {
    if (settings.disabledGroups.has(rule.group)) continue
    let hit
    try {
      hit = rule.test(views[rule.scope === 'raw' ? 'raw' : 'code'])
    } catch {
      hit = null
    }
    if (hit) return formatDenial(rule, hit, command)
  }
  return undefined
}
