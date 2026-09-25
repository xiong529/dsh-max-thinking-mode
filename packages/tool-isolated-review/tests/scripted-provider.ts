/** Package-local scripted child boundary for deterministic isolated-review tests. */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {
  SubagentCapabilities,
  SubagentProvider,
  SubagentResult,
  SubagentRun,
  SubagentStartRequest,
  SubagentStopReason,
} from '@deepseek-ai/dsh-subagent'

const DEFAULT_CAPABILITIES: SubagentCapabilities = {
  agentOptions: true,
  outputSchema: true,
  depthLimit: true,
  toolFilter: true,
  persona: true,
}

/** Options for one scripted provider fixture. */
export interface Config {
  /** Registry name to register under. */
  name: string
  /** Final text returned by the scripted reviewer. */
  reply?: string
  /** Terminal result reason. */
  stopReason?: SubagentStopReason
  /** Safe non-assistant detail for a non-completed result. */
  diagnostic?: string
  /** Start-time features advertised by the provider. */
  capabilities?: Partial<SubagentCapabilities>
  /** Whether tool descriptions say the child inherits completed turns. */
  inheritsParentContext?: boolean
  /** Structured verdict returned when the request carries an outputSchema. */
  structured?: unknown
  /** Structured values keyed by the run label, overriding `structured` per role. */
  structuredByLabel?: Record<string, unknown>
  /** Observes each start; the child's result additionally waits for the returned promise. */
  onStart?: (request: SubagentStartRequest) => Promise<void> | void
}

/** Scripted provider whose result aborts if its signal or disposer wins first. */
class ScriptedSubagentProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities
  readonly inheritsParentContext: boolean

  constructor(
    readonly name: string,
    private readonly config: Config,
  ) {
    this.capabilities = { ...DEFAULT_CAPABILITIES, ...config.capabilities }
    this.inheritsParentContext = config.inheritsParentContext ?? false
  }

  async start(request: SubagentStartRequest): Promise<SubagentRun> {
    if (request.signal.aborted) throw new Error('scripted reviewer start aborted before publication')
    const reply = this.config.reply ?? 'scripted reviewer reply'
    const output: ContentBlock[] = [{ type: 'text', text: reply }]
    const stopReason = this.config.stopReason ?? 'completed'
    const state = { cancelled: false }
    const onAbort = (): void => { state.cancelled = true }
    request.signal.addEventListener('abort', onAbort, { once: true })
    await Promise.resolve()
    if (state.cancelled) {
      request.signal.removeEventListener('abort', onAbort)
      throw new Error('scripted reviewer start aborted before publication')
    }

    const wantsStructured = request.outputSchema !== undefined && this.capabilities.outputSchema
    const resultFor = (): SubagentResult => {
      const terminal = state.cancelled ? 'aborted' : stopReason
      return {
        output,
        ...wantsStructured ? {
          // Preserve an explicit null/array/string as the malformed-verdict
          // probe; only an omitted config value falls back to the default.
          structured: this.config.structuredByLabel?.[request.label ?? ''] ?? (this.config.structured !== undefined
            ? this.config.structured
            : {
              verdict: 'sound-with-changes',
              objections: ['one objection'],
              strongest_weakness: 'the failure modes',
              verdict_reason: reply,
            }),
        } : {},
        ...this.config.diagnostic !== undefined && terminal !== 'completed'
          ? { diagnostic: this.config.diagnostic }
          : {},
        stopReason: terminal,
      }
    }
    const gate = Promise.resolve(this.config.onStart?.(request))
    const result = gate.then(() => new Promise<SubagentResult>((resolve) => {
      setTimeout(() => { resolve(resultFor()) }, 0)
    })).finally(() => {
      request.signal.removeEventListener('abort', onAbort)
    })

    return {
      id: SessionId(`scripted-reviewer:${this.name}:${request.parent.id}`),
      localAgent: undefined,
      result,
      dispose(): Promise<void> {
        state.cancelled = true
        request.signal.removeEventListener('abort', onAbort)
        return Promise.resolve()
      },
    }
  }
}

/**
 * Mount one scripted provider through an effect-scoped local plugin.
 * @param ctx - context carrying the real subagent registry.
 * @param config - scripted provider identity and outcome.
 * @returns the fixture plugin's disposable fiber.
 */
export function mountScriptedProvider(ctx: Context, config: Config) {
  return ctx.plugin({
    name: 'scripted-reviewer-provider',
    inject: ['subagents'],
    apply(pluginCtx: Context): void {
      pluginCtx.subagents.registerProvider(new ScriptedSubagentProvider(config.name, config))
    },
  })
}
