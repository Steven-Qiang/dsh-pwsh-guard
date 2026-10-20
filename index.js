import { commandFrom, inspectCommand, normalizeSettings } from './rules.js'

export const name = 'pwsh-guard'

export const inject = ['tools']

export function apply(ctx, config) {
  const settings = normalizeSettings(config)

  ctx.tools.guard((execution) => {
    if (!settings.enabled) return undefined
    try {
      if (!execution || typeof execution.name !== 'string') return undefined
      if (!settings.tools.has(execution.name)) return undefined
      return inspectCommand(commandFrom(execution.name, execution.arguments), settings)
    } catch {
      // Fail open: a broken guard must not block every shell call.
      return undefined
    }
  })
}
