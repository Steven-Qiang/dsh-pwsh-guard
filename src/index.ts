import {
  commandFrom,
  inspectCommand,
  inspectToolCall,
  normalizeSettings,
  type PluginConfig,
} from './rules.js'

export const name = 'pwsh-guard'

export const inject = ['tools']

interface GuardExecution {
  name?: unknown
  arguments?: unknown
}

interface GuardContext {
  tools: {
    guard(guard: (execution: Readonly<GuardExecution>) => string | undefined): unknown
  }
}

export function apply(ctx: GuardContext, config?: PluginConfig): void {
  const settings = normalizeSettings(config)

  ctx.tools.guard((execution) => {
    if (!settings.enabled) return undefined
    try {
      if (!execution || typeof execution.name !== 'string') return undefined

      const toolDenial = inspectToolCall(execution.name, execution.arguments, settings)
      if (toolDenial) return toolDenial

      if (!settings.tools.has(execution.name)) return undefined
      return inspectCommand(commandFrom(execution.name, execution.arguments), settings)
    } catch {
      // Fail open: a broken guard must not block every shell call.
      return undefined
    }
  })
}
