export type Language = 'zh' | 'en'

export interface LocalizedText {
  en: string
  zh: string
}

/** Built-ins ship both languages; custom rules may pass a plain string. */
export type RuleText = string | LocalizedText

export interface RuleHit {
  matched: string
  index: number
}

export interface Rule {
  id: string
  group: string
  title: RuleText
  hint: RuleText
  /** `code` (default) matches with quoted spans blanked out; `raw` matches the original command. */
  scope?: 'raw' | 'code'
  test: (command: string) => RuleHit | null
}

/** A rule over a tool call's arguments, for tools that carry no command line. */
export interface ToolRule {
  id: string
  group: string
  tools: string[]
  title: RuleText
  hint: RuleText
  when: (args: Record<string, unknown>) => boolean
}

export interface Settings {
  enabled: boolean
  language: Language
  tools: Set<string>
  disabledGroups: Set<string>
  allowPatterns: RegExp[]
  rules: Rule[]
}

export interface ExtraRule {
  id?: string
  group?: string
  title?: RuleText
  hint?: RuleText
  pattern: string
  flags?: string
}

export interface PluginConfig {
  enabled?: boolean
  /** `auto` follows DSH_LOCALE, the host locale, then LANG/LC_ALL. */
  language?: Language | 'auto'
  tools?: string[]
  disabledGroups?: string[]
  allowPatterns?: string[]
  rules?: ExtraRule[]
}

const CMD_HEAD = '(?:^|[;&|(){}\\x60]|\\$\\()'

export const DEFAULT_TOOLS = ['pwsh', 'bash', 'ops_bash']

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Short aliases match in command position only, so `-Type` and `git gc` pass.
function atCommandHead(name: string): RegExp {
  return new RegExp(`${CMD_HEAD}[ \\t]*&?[ \\t]*["']?${escapeRegExp(name)}(?=["'\\s;|)&]|$)`, 'i')
}

// Full cmdlet names cannot collide with other words.
function anywhere(name: string): RegExp {
  return new RegExp(`(?<![\\w-])${escapeRegExp(name)}(?![\\w-])`, 'i')
}

function hitBy(regex: RegExp) {
  return (command: string): RuleHit | null => {
    const match = regex.exec(command)
    return match ? { matched: match[0], index: match.index } : null
  }
}

// Two conditions: an interpreter call that also touches a file-reading API.
function hitWhen(trigger: RegExp, api: RegExp, describe: (api: string) => string) {
  return (command: string): RuleHit | null => {
    if (!trigger.test(command)) return null
    const match = api.exec(command)
    return match ? { matched: describe(match[0]), index: match.index } : null
  }
}

// Blank out quoted spans, keeping the length so indexes stay aligned. A command
// mentioned inside a string is not a command being run.
export function stripQuoted(command: string): string {
  const chars = command.split('')
  let quote: string | null = null
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

function envOf(): Record<string, string | undefined> {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return proc?.env ?? {}
}

function languageOf(value: string | undefined): Language | null {
  if (!value) return null
  const normalized = value.toLowerCase()
  if (normalized.startsWith('zh')) return 'zh'
  if (normalized.startsWith('en')) return 'en'
  return null
}

function hostLocale(): string | undefined {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    return undefined
  }
}

export function detectLanguage(explicit: unknown): Language {
  if (explicit === 'zh' || explicit === 'en') return explicit

  const env = envOf()
  const fromDs = languageOf(env.DSH_LOCALE)
  if (fromDs) return fromDs

  const fromHost = languageOf(hostLocale())
  if (fromHost) return fromHost

  for (const key of ['LANGUAGE', 'LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const found = languageOf(env[key])
    if (found) return found
  }

  return 'en'
}

function pick(text: RuleText, language: Language): string {
  return typeof text === 'string' ? text : text[language]
}

const BUILTIN_RULES: Rule[] = [
  // textSearch
  {
    id: 'search.Select-String',
    group: 'textSearch',
    title: {
      en: 'command uses `Select-String` to search file contents',
      zh: '命令里出现 `Select-String`（在 shell 里检索文件内容）',
    },
    hint: {
      en: 'Use the grep tool instead (pass path + include to narrow the scope), and glob to find files.',
      zh: '改用 grep 工具搜内容（传 path + include 收窄范围）；找文件路径用 glob。',
    },
    test: hitBy(anywhere('Select-String')),
  },
  {
    id: 'search.sls',
    group: 'textSearch',
    title: {
      en: 'command uses `sls` (alias of Select-String)',
      zh: '命令里出现 `sls`（Select-String 的别名）',
    },
    hint: { en: 'Use the grep tool instead.', zh: '改用 grep 工具搜内容。' },
    test: hitBy(atCommandHead('sls')),
  },
  {
    id: 'search.findstr',
    group: 'textSearch',
    title: { en: 'command uses `findstr`', zh: '命令里出现 `findstr`' },
    hint: { en: 'Use the grep tool instead.', zh: '改用 grep 工具搜内容。' },
    test: hitBy(anywhere('findstr')),
  },
  {
    id: 'search.grep',
    group: 'textSearch',
    title: { en: 'command uses `grep`', zh: '命令里出现 `grep`' },
    hint: {
      en: 'Use the grep tool instead (ripgrep with include filters); `git grep` is not blocked.',
      zh: '改用 grep 工具（ripgrep，自带 include 过滤）；`git grep` 不在拦截范围。',
    },
    test: hitBy(atCommandHead('grep')),
  },
  {
    id: 'search.rg',
    group: 'textSearch',
    title: { en: 'command uses `rg`', zh: '命令里出现 `rg`' },
    hint: {
      en: 'Use the grep tool and narrow the scope by path and include.',
      zh: '改用 grep 工具，路径与 include 由它收窄。',
    },
    test: hitBy(atCommandHead('rg')),
  },

  // textRead
  {
    id: 'read.Get-Content',
    group: 'textRead',
    title: {
      en: 'command uses `Get-Content` to read a file inside the shell',
      zh: '命令里出现 `Get-Content`（在 shell 里读文件）',
    },
    hint: {
      en: 'Use the read tool instead (it supports offset/limit); for logs use the matching MCP tool (cat/tail/grep).',
      zh: '改用 read 工具读文件（支持 offset/limit）；查日志用对应的 MCP 工具（cat/tail/grep）。',
    },
    test: hitBy(anywhere('Get-Content')),
  },
  {
    id: 'read.gc',
    group: 'textRead',
    title: { en: 'command uses `gc` (alias of Get-Content)', zh: '命令里出现 `gc`（Get-Content 的别名）' },
    hint: { en: 'Use the read tool instead.', zh: '改用 read 工具读文件。' },
    test: hitBy(atCommandHead('gc')),
  },
  {
    id: 'read.cat',
    group: 'textRead',
    title: { en: 'command uses `cat` (alias of Get-Content)', zh: '命令里出现 `cat`（Get-Content 的别名）' },
    hint: { en: 'Use the read tool instead.', zh: '改用 read 工具读文件。' },
    test: hitBy(atCommandHead('cat')),
  },
  {
    id: 'read.type',
    group: 'textRead',
    title: { en: 'command uses `type` (alias of Get-Content)', zh: '命令里出现 `type`（Get-Content 的别名）' },
    hint: { en: 'Use the read tool instead.', zh: '改用 read 工具读文件。' },
    test: hitBy(atCommandHead('type')),
  },
  {
    id: 'read.more',
    group: 'textRead',
    title: { en: 'command uses `more` to page through a file', zh: '命令里出现 `more`（分页读文件）' },
    hint: {
      en: 'Use the read tool with offset/limit instead.',
      zh: '改用 read 工具按 offset/limit 分页读。',
    },
    test: hitBy(atCommandHead('more')),
  },
  {
    id: 'read.head',
    group: 'textRead',
    title: { en: 'command uses `head` to slice the top of a file', zh: '命令里出现 `head`（截取文件头部）' },
    hint: { en: 'Use the read tool with offset=1 and limit instead.', zh: '改用 read 工具（offset=1 + limit）。' },
    test: hitBy(atCommandHead('head')),
  },
  {
    id: 'read.tail',
    group: 'textRead',
    title: { en: 'command uses `tail` to slice the end of a file', zh: '命令里出现 `tail`（截取文件尾部）' },
    hint: {
      en: "Use the read tool: read the line count first, then offset from the end. For logs use the log MCP tool's tail.",
      zh: '改用 read 工具（先读总行数再按 offset 取尾部），或日志类 MCP 的 tail。',
    },
    test: hitBy(atCommandHead('tail')),
  },

  // runtimeBypass: script bodies live inside quotes, so these read the raw command.
  {
    id: 'bypass.node-eval',
    group: 'runtimeBypass',
    scope: 'raw',
    title: {
      en: '`node -e/--eval` reads a file from a script',
      zh: '用 `node -e/--eval` 在脚本里读文件',
    },
    hint: {
      en: 'Use the read tool for files and the grep tool for content - do not shell out to a runtime.',
      zh: '直接 read 工具读文件、grep 工具搜内容——不要用运行时脚本绕过去。',
    },
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
    title: { en: '`python -c` reads a file from a script', zh: '用 `python -c` 在脚本里读文件' },
    hint: {
      en: 'Use the read tool for files and the grep tool for content.',
      zh: '直接 read 工具读文件、grep 工具搜内容。',
    },
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
    title: { en: '`php -r` reads a file from a script', zh: '用 `php -r` 在脚本里读文件' },
    hint: {
      en: 'Use the read tool for files and the grep tool for content.',
      zh: '直接 read 工具读文件、grep 工具搜内容。',
    },
    test: hitWhen(
      /\bphp(?:\.exe)?\b[^|;&\r\n]*\s-r\b/i,
      /(file_get_contents|fopen\s*\(|fgets\s*\(|fread\s*\(|scandir\s*\(|glob\s*\(|SplFileObject)/,
      (api) => `php -r … ${api} …`,
    ),
  },
  {
    id: 'bypass.dotnet-io',
    group: 'runtimeBypass',
    title: {
      en: '.NET file API (`[IO.File]::...`) reads a file',
      zh: '用 .NET 文件 API 读文件（`[IO.File]::…`）',
    },
    hint: {
      en: 'Use the read tool instead - reading files is not a shell job.',
      zh: '直接 read 工具读文件；这不是 shell 该干的活。',
    },
    test: hitBy(
      /\[(?:System\.)?IO\.(?:File|Directory)\]::(?:Read\w*|Open\w*|GetFiles|GetDirectories|Enumerate\w*)/i,
    ),
  },

  // sleep
  {
    id: 'wait.Start-Sleep',
    group: 'sleep',
    title: { en: '`Start-Sleep` waits inside the shell', zh: '命令里出现 `Start-Sleep`（在 shell 里空等）' },
    hint: {
      en: 'Do not sleep. For a service, probe its port or endpoint until it answers; for a background job, read its output again later. Use schedule_create for timers.',
      zh: '不要空等。起服务就探测端口或接口直到就绪；后台任务过一会儿再读一次 job_output。要定时用 schedule_create。',
    },
    test: hitBy(anywhere('Start-Sleep')),
  },
  {
    id: 'wait.sleep',
    group: 'sleep',
    title: { en: '`sleep` (alias of Start-Sleep)', zh: '命令里出现 `sleep`（Start-Sleep 的别名）' },
    hint: {
      en: 'Do not sleep. For a service, probe its port or endpoint until it answers; for a background job, read its output again later. Use schedule_create for timers.',
      zh: '不要空等。起服务就探测端口或接口直到就绪；后台任务过一会儿再读一次 job_output。要定时用 schedule_create。',
    },
    test: hitBy(atCommandHead('sleep')),
  },

  // stderrMerge
  {
    id: 'pipeline.stderr-merge',
    group: 'stderrMerge',
    title: {
      en: 'stderr is merged with `2>&1` and then piped',
      zh: '命令把 stderr 用 `2>&1` 合并后又接了管道',
    },
    hint: {
      en: 'Drop 2>&1: check $LASTEXITCODE for success, or send stderr to a file with `2>err.txt`.',
      zh: '去掉 2>&1：判断成败看 $LASTEXITCODE，需要留 stderr 就写 `2>err.txt`，别让 PS 把 stderr 变成 NativeCommandError。',
    },
    test: hitBy(/2>&1[^\r\n]{0,400}\|/),
  },
]

// Invalid patterns are dropped rather than failing activation.
function compileCustomRules(entries: unknown): Rule[] {
  if (!Array.isArray(entries)) return []
  const compiled: Rule[] = []
  for (const entry of entries as ExtraRule[]) {
    if (!entry || typeof entry !== 'object' || typeof entry.pattern !== 'string') continue
    if (entry.pattern.trim() === '') continue
    let regex: RegExp
    try {
      regex = new RegExp(entry.pattern, typeof entry.flags === 'string' ? entry.flags : 'i')
    } catch {
      continue
    }
    const title = entry.title
    const hint = entry.hint
    compiled.push({
      id: typeof entry.id === 'string' && entry.id !== '' ? entry.id : `custom.${compiled.length}`,
      group: typeof entry.group === 'string' && entry.group !== '' ? entry.group : 'custom',
      title: title ?? {
        en: `command matches /${entry.pattern}/`,
        zh: `命令命中自定义规则 /${entry.pattern}/`,
      },
      hint: hint ?? {
        en: 'This form is blocked; use another approach.',
        zh: '该写法被禁用，请换一种做法。',
      },
      test: hitBy(regex),
    })
  }
  return compiled
}

export function normalizeSettings(config: unknown): Settings {
  const raw = (
    config && typeof config === 'object' && !Array.isArray(config) ? config : {}
  ) as PluginConfig

  const toolNames = Array.isArray(raw.tools)
    ? raw.tools.filter((entry) => typeof entry === 'string' && entry.trim() !== '')
    : []
  const disabledGroups = new Set(
    Array.isArray(raw.disabledGroups)
      ? raw.disabledGroups.filter((entry) => typeof entry === 'string')
      : [],
  )

  const allowPatterns: RegExp[] = []
  if (Array.isArray(raw.allowPatterns)) {
    for (const pattern of raw.allowPatterns) {
      if (typeof pattern !== 'string' || pattern.trim() === '') continue
      try {
        allowPatterns.push(new RegExp(pattern, 'i'))
      } catch {
        // ignore invalid patterns
      }
    }
  }

  return {
    enabled: raw.enabled !== false,
    language: detectLanguage(raw.language),
    tools: new Set(toolNames.length > 0 ? toolNames : DEFAULT_TOOLS),
    disabledGroups,
    allowPatterns,
    rules: [...compileCustomRules(raw.rules), ...BUILTIN_RULES],
  }
}

export function commandFrom(toolName: string, args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined
  const value = (args as Record<string, unknown>)[toolName === 'terminal_send' ? 'text' : 'command']
  return typeof value === 'string' ? value : undefined
}

const SNIPPET_LIMIT = 80

// Blocking on a job hides a long-running server behind a call that never returns.
const BUILTIN_TOOL_RULES: ToolRule[] = [
  {
    id: 'job.wait',
    group: 'jobWait',
    tools: ['job_output'],
    title: {
      en: '`job_output` is called with `wait: true`',
      zh: '`job_output` 传了 `wait: true`（阻塞等待后台任务）',
    },
    hint: {
      en: 'Do not block on a job. For a dev server, probe its port instead (`Test-NetConnection -Port`, `curl`); for any other job, read `job_output` again later without wait.',
      zh: '不要阻塞等任务。起 vite dev 这类常驻服务时，改为探测端口是否就绪（`Test-NetConnection -Port` 或 `curl`）；其它后台任务过一会儿再读一次 `job_output`，不要传 wait。',
    },
    when: (args) => args.wait === true,
  },
]

const MESSAGE = {
  zh: {
    headline: (title: string) => `[pwsh-guard] 已拦截：${title}`,
    matched: (snippet: string) => `命中片段：${snippet}`,
    tool: '工具',
    note: (id: string) => `（规则 ${id}；确需放行请让用户调整 pwsh-guard 的 config）`,
  },
  en: {
    headline: (title: string) => `[pwsh-guard] Blocked: ${title}`,
    matched: (snippet: string) => `Matched: ${snippet}`,
    tool: 'Tool',
    note: (id: string) =>
      `(rule ${id}; ask the user to change the pwsh-guard config if this must be allowed)`,
  },
}

function formatDenial(rule: Rule, hit: RuleHit, command: string, language: Language): string {
  const raw =
    typeof hit.index === 'number' ? command.slice(hit.index, hit.index + 120) : String(hit.matched)
  const snippet = raw.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LIMIT) || String(hit.matched)
  const text = MESSAGE[language]
  return [
    text.headline(pick(rule.title, language)),
    text.matched(snippet),
    pick(rule.hint, language),
    text.note(rule.id),
  ].join('\n')
}

export function inspectCommand(command: unknown, settings: Settings): string | undefined {
  if (typeof command !== 'string' || command.trim() === '') return undefined
  if (settings.allowPatterns.some((pattern) => pattern.test(command))) return undefined

  const views: Record<'raw' | 'code', string> = { raw: command, code: stripQuoted(command) }

  for (const rule of settings.rules) {
    if (settings.disabledGroups.has(rule.group)) continue
    let hit: RuleHit | null
    try {
      hit = rule.test(views[rule.scope === 'raw' ? 'raw' : 'code'])
    } catch {
      hit = null
    }
    if (hit) return formatDenial(rule, hit, command, settings.language)
  }
  return undefined
}

function formatToolDenial(rule: ToolRule, toolName: string, language: Language): string {
  const text = MESSAGE[language]
  return [
    text.headline(pick(rule.title, language)),
    `${text.tool}: ${toolName}`,
    pick(rule.hint, language),
    text.note(rule.id),
  ].join('\n')
}

/** Rules that judge a tool call by its arguments, independent of any shell command. */
export function inspectToolCall(
  toolName: unknown,
  args: unknown,
  settings: Settings,
): string | undefined {
  if (typeof toolName !== 'string' || toolName === '') return undefined
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined
  const record = args as Record<string, unknown>

  for (const rule of BUILTIN_TOOL_RULES) {
    if (settings.disabledGroups.has(rule.group)) continue
    if (!rule.tools.includes(toolName)) continue
    let matched: boolean
    try {
      matched = rule.when(record)
    } catch {
      matched = false
    }
    if (matched) return formatToolDenial(rule, toolName, settings.language)
  }
  return undefined
}
