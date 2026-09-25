/**
 * Model-facing isolated review tool for the deep-think preset: the main model
 * authors the entire framing — necessary context, its proposed solution, an
 * angle, a focus, and the precise question to answer — and one or more fresh
 * subagents, spawned with no tools, no files, and no conversation history,
 * re-think the problem from different angles and try to refute the proposal.
 * Each reviewer returns a structured verdict; the replies return to the main
 * model, which retains authority over the final decision.
 *
 * Isolation is enforced twice: the subagent provider's fresh-context semantics
 * hide the parent conversation, and a `toolFilter` that keeps no inherited
 * tool plus a fixed reviewer persona leave the reviewer with nothing but the
 * passed context to reason from.
 *
 * Three review shapes are supported in one tool:
 * - single review (default), with optional parallel reviewers (`reviewers`);
 * - a second adversarial round (`prior_review` + `submitter_rebuttal`), where
 *   the reviewer honestly re-evaluates the submitter's response to its first
 *   verdict before stating a final one.
 * @module @dsh-max-thinking/tool-isolated-review
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool, type ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type {
  SubagentProvider,
  SubagentResult,
  SubagentRun,
} from '@deepseek-ai/dsh-subagent'

/** Cordis plugin name. */
export const name = 'tool-isolated-review'

/** Services required by the tool registrations. */
export const inject = ['tools', 'subagents']

/** Plugin config: which subagent provider spawns the isolated reviewer. */
export interface Config {
  /** The `ctx.subagents` provider name that spawns the reviewer (fresh context). */
  provider: string
  /** Model-facing tool name (default `isolated_review`). */
  toolName?: string
  /** Per-reviewer persona; defaults to the fixed isolated-reviewer identity. */
  persona?: string
}

/** Runtime schema for the isolated review row. */
export const Config: z<Config> = z.object({
  provider: z.string().required(),
  toolName: z.string().default('isolated_review'),
  persona: z.string(),
})

/** Model-facing argument vocabulary for one isolated review call. */
interface IsolatedReviewArgs {
  readonly task_context: string
  readonly proposed_solution: string
  readonly alternative_angle?: string
  readonly review_focus?: string
  readonly review_question?: string
  readonly reviewers?: number
  readonly prior_review?: string
  readonly submitter_rebuttal?: string
  readonly arbitrate?: boolean
}

/** One reviewer's structured verdict, produced under {@link REVIEW_SCHEMA}. */
interface ReviewVerdict {
  readonly verdict: 'sound-as-is' | 'sound-with-changes' | 'different-approach'
  objections: string[]
  readonly strongest_weakness: string
  readonly verdict_reason: string
}

/** The arbiter's structured final verdict, produced under {@link ARBITER_SCHEMA}. */
interface ArbiterVerdict {
  readonly final_verdict: 'sound-as-is' | 'sound-with-changes' | 'different-approach'
  readonly decision: string
  readonly accepted_objections: string[]
  readonly rejected_objections: string[]
  readonly evolution: string
}

/** Parallel reviewers are capped at three: more yields diminishing returns. */
const MAX_REVIEWERS = 3

/** The fixed reviewer identity: no tools, no files, no network, no history. */
const DEFAULT_REVIEWER_PERSONA =
  'You are an isolated reviewer. You have no tools and no access to files, the network, or the submitter\'s conversation. Reason only from the context you are given.'

/** JSON Schema the tool sends to every reviewer, and re-uses as its own output. */
const REVIEW_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: {
      type: 'string',
      enum: ['sound-as-is', 'sound-with-changes', 'different-approach'],
    },
    objections: {
      type: 'array',
      items: { type: 'string' },
    },
    strongest_weakness: { type: 'string' },
    verdict_reason: { type: 'string' },
  },
  required: ['verdict', 'objections', 'strongest_weakness', 'verdict_reason'],
}

/** JSON Schema for the final arbiter verdict, produced when `arbitrate` is set. */
const ARBITER_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    final_verdict: {
      type: 'string',
      enum: ['sound-as-is', 'sound-with-changes', 'different-approach'],
    },
    decision: { type: 'string' },
    accepted_objections: {
      type: 'array',
      items: { type: 'string' },
    },
    rejected_objections: {
      type: 'array',
      items: { type: 'string' },
    },
    evolution: { type: 'string' },
  },
  required: ['final_verdict', 'decision', 'accepted_objections', 'rejected_objections', 'evolution'],
}

/** Model-facing tool description, stated without transport or implementation vocabulary. */
const TOOL_DESCRIPTION =
  'Send your proposed solution to one or more isolated reviewers for an independent, adversarial second opinion. '
  + 'Each reviewer is spawned without tools, files, network access, or your reasoning and conversation history — '
  + 'it sees only what you author (task_context, proposed_solution, review_question) and must answer in a structured '
  + 'verdict: sound-as-is, sound-with-changes, or different-approach, with objections and the strongest weakness. '
  + 'You write the framing and the precise question to fit the scenario; set reviewers to 2-3 for parallel '
  + 'cross-checks from different angles (each must contribute a point the others would miss), pass prior_review plus '
  + 'submitter_rebuttal for a second adversarial round, or set arbitrate to have a final arbiter adopt or reject each '
  + 'objection and return the strongest next evolution of the chosen direction. Use this before committing to a '
  + 'significant decision. The verdicts return to you; you keep authority over the final choice, so weigh them against '
  + 'your own analysis and decide the best solution.'

/**
 * Clamp the model's reviewer count into the supported range. Tool arguments
 * arrive losslessly JSON-serialized, so the count is always a finite number.
 * @param value - the model-supplied count, or undefined.
 * @returns a count in 1..{@link MAX_REVIEWERS}.
 */
function reviewerCount(value: number | undefined): number {
  return Math.min(MAX_REVIEWERS, Math.max(1, Math.trunc(value ?? 1)))
}

/** The reviewer must always know what the submitter's proposal and question are. */
const REVIEW_INSTRUCTIONS =
  '- Do not continue the submitter\'s line of thinking. Re-think the problem from first principles and reach '
  + 'your own conclusion — the goal is a genuinely different viewpoint, not a restatement of the proposal.\n'
  + '- Challenge the proposal explicitly: say which parts are unsupported, risky, over- or under-engineered, '
  + 'or wrong, and why.\n'
  + '- Contribute at least one objection or assumption that is NOT obvious to the other reviewers — your unique '
  + 'perspective, not the likely consensus. Name it explicitly as your distinct point.\n'
  + '- If a challenge does not survive your own scrutiny, say why the alternative you considered is worse; '
  + 'do not manufacture objections.\n'
  + '- Answer in these structured fields only: verdict (one of "sound-as-is", "sound-with-changes", '
  + '"different-approach"), objections (each item one unsupported or risky point and why), '
  + 'strongest_weakness (the single most damaging flaw), and verdict_reason (the reasoning behind the verdict).\n'
  + '- Base every claim only on the given context; you have no other evidence.'

/**
 * Compose the reviewer's standalone task from the model's arguments and the
 * reviewer's position among parallel reviewers.
 * @param args - context, solution, and the model-authored framing.
 * @param index - one-based reviewer position.
 * @param count - total parallel reviewers.
 * @returns the full reviewer prompt.
 */
export function buildReviewerPrompt(args: IsolatedReviewArgs, index = 1, count = 1): string {
  const focus = args.review_focus === undefined ? '' : `\n\nScrutinize hardest: ${args.review_focus}`
  const angle = args.alternative_angle === undefined
    ? ''
    : `\n\nThe submitter asked you to approach it from this angle: ${args.alternative_angle}`
  const question = args.review_question === undefined
    ? ''
    : `\n\nThe question you must answer: ${args.review_question}`
  const position = count > 1
    ? `\n\nYou are reviewer ${index} of ${count}. Pick a different angle from the other reviewers — do not duplicate their conclusions, and mark your distinct point so the arbiter can tell your view apart from theirs.`
    : ''
  const round = args.prior_review !== undefined && args.submitter_rebuttal !== undefined
    ? [
      'This is the second round of an adversarial review. The submitter read the first round and is responding.',
      `The first-round review:\n${args.prior_review}`,
      `The submitter's rebuttal:\n${args.submitter_rebuttal}`,
      'Evaluate the rebuttal honestly: concede the points it answers, press the points it evades, and state your '
      + 'final verdict in the same structured fields.',
    ].join('\n\n')
    : undefined
  if (round !== undefined) {
    return [
      'You are an isolated reviewer. You were invoked without tools, files, network access, or the submitter\'s '
      + 'reasoning process and conversation history. You see only the context below, and you must reason from it alone.',
      `Task context:\n${args.task_context}`,
      `The submitter's proposed solution:\n${args.proposed_solution}${focus}${angle}${question}${position}`,
      round,
    ].join('\n\n')
  }
  return [
    'You are an isolated reviewer. You were invoked without tools, files, network access, or the submitter\'s '
    + 'reasoning process and conversation history. You see only the context below, and you must reason from it alone.',
    `Task context:\n${args.task_context}`,
    `The submitter's proposed solution:\n${args.proposed_solution}${focus}${angle}${question}${position}`,
    'Instructions:',
    REVIEW_INSTRUCTIONS,
    'Your reply goes directly back to the submitter\'s model, which retains authority over the final decision. '
    + 'Be concrete.',
  ].join('\n\n')
}

/**
 * Compose the final arbiter's task from the framing and every reviewer verdict.
 * @param args - context and solution the reviewers judged.
 * @param reviews - the reviewers' structured verdicts, rendered for the arbiter.
 * @returns the full arbiter prompt.
 */
export function buildArbiterPrompt(args: IsolatedReviewArgs, reviews: readonly ReviewVerdict[]): string {
  const rendered = reviews.map((verdict, index) => `Review ${index + 1}/${reviews.length}\n${renderVerdict(verdict)}`).join('\n\n')
  return [
    'You are the final arbiter of an adversarial review. You were invoked without tools, files, network access, or '
    + 'the submitter\'s reasoning process and conversation history. You see the task, the proposal, and every '
    + 'independent reviewer verdict below, and you must reason from them alone.',
    `Task context:\n${args.task_context}`,
    `The submitter's proposed solution:\n${args.proposed_solution}`,
    `Independent reviewer verdicts:\n${rendered}`,
    'Instructions:',
    '- Weigh every reviewer verdict honestly. Adopt the objections that survive scrutiny and reject those that do not, '
    + 'stating your reason for each rejection.',
    '- Guard against groupthink: when reviewers converge on the same point, check it hardest instead of trusting the '
    + 'consensus, and prefer the verdict with the strongest distinct evidence over the loudest one.',
    '- Answer in these structured fields only: final_verdict (one of "sound-as-is", "sound-with-changes", '
    + '"different-approach"), decision (the direction the submitter should take), accepted_objections (each item one '
    + 'objection the submitter must address), rejected_objections (each item one objection you reject, with the '
    + 'reason it fails), and evolution (the strongest next step or mutation that would improve the chosen direction, '
    + 'or an empty string when it is already sound).',
    '- Base every claim only on the given context and verdicts; you have no other evidence.',
    'Your reply goes back to the submitter\'s model, which keeps the final choice.',
  ].join('\n\n')
}

/** A non-`completed` stop reason means the reviewer did not finish cleanly. */
function stopReasonError(result: SubagentResult): string | undefined {
  switch (result.stopReason) {
    case 'completed':
      return undefined
    case 'aborted':
      return 'isolated review run was cancelled'
    case 'error':
      return 'isolated review run failed'
    case 'max-tokens':
      return 'isolated review run hit its token limit before finishing'
    case 'refusal':
      return 'the reviewer declined the task'
    // Merge-extensible union: a backend may add stop reasons. Treat an unknown
    // terminal reason as a failure rather than reporting partial output as success.
    default:
      return `isolated review run ended abnormally (${String(result.stopReason)})`
  }
}

/**
 * Append provider-authored failure detail and the reviewer's preserved partial
 * answer to a stop-reason error, keeping diagnostic text separate from output.
 * @param error - the stop-reason headline.
 * @param result - the reviewer's terminal result.
 * @returns the headline, diagnostic, and partial text that are present.
 */
function withDiagnosticAndPartialText(error: string, result: SubagentResult): string {
  const diagnostic = result.diagnostic === undefined
    ? ''
    : `\nDiagnostic: ${result.diagnostic}`
  const text = result.output
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
  const partial = text.length === 0
    ? ''
    : `\nPartial output before the run ended:\n${text}`
  return `${error}${diagnostic}${partial}`
}

/** Type guard for one reviewer's structured verdict value. */
function isReviewVerdict(value: unknown): value is ReviewVerdict {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (record.verdict === 'sound-as-is' || record.verdict === 'sound-with-changes' || record.verdict === 'different-approach')
    && Array.isArray(record.objections)
    && record.objections.every(item => typeof item === 'string')
    && typeof record.strongest_weakness === 'string'
    && typeof record.verdict_reason === 'string'
}

/**
 * Read the reviewer's structured verdict, failing loud when the provider
 * returned no usable structured value.
 * @param result - the reviewer's terminal result.
 * @returns the validated verdict.
 */
function reviewVerdictOf(result: SubagentResult): ReviewVerdict {
  const structured = result.structured
  if (!isReviewVerdict(structured)) {
    throw new Error('the reviewer returned no valid structured verdict (verdict, objections, strongest_weakness, verdict_reason)')
  }
  return structured
}

/** Type guard for one final arbiter verdict value. */
function isArbiterVerdict(value: unknown): value is ArbiterVerdict {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (record.final_verdict === 'sound-as-is' || record.final_verdict === 'sound-with-changes' || record.final_verdict === 'different-approach')
    && typeof record.decision === 'string'
    && Array.isArray(record.accepted_objections)
    && record.accepted_objections.every(item => typeof item === 'string')
    && Array.isArray(record.rejected_objections)
    && record.rejected_objections.every(item => typeof item === 'string')
    && typeof record.evolution === 'string'
}

/**
 * Read the final arbiter's structured verdict, failing loud when malformed.
 * @param result - the arbiter's terminal result.
 * @returns the validated verdict.
 */
function arbiterVerdictOf(result: SubagentResult): ArbiterVerdict {
  const structured = result.structured
  if (!isArbiterVerdict(structured)) {
    throw new Error('the arbiter returned no valid structured verdict (final_verdict, decision, accepted_objections, rejected_objections, evolution)')
  }
  return structured
}

/** Render one verdict as the model-visible review text. */
function renderVerdict(verdict: ReviewVerdict): string {
  const objections = verdict.objections.length === 0
    ? '  (none)'
    : verdict.objections.map(objection => `  - ${objection}`).join('\n')
  return [
    `verdict: ${verdict.verdict}`,
    `strongest weakness: ${verdict.strongest_weakness}`,
    `objections:\n${objections}`,
    `reason: ${verdict.verdict_reason}`,
  ].join('\n')
}

/** Render the final arbiter verdict as the model-visible text. */
function renderArbiter(arbiter: ArbiterVerdict): string {
  const accepted = arbiter.accepted_objections.length === 0
    ? '  (none)'
    : arbiter.accepted_objections.map(objection => `  - ${objection}`).join('\n')
  const rejected = arbiter.rejected_objections.length === 0
    ? '  (none)'
    : arbiter.rejected_objections.map(objection => `  - ${objection}`).join('\n')
  const evolution = arbiter.evolution.length === 0 ? '  (none needed)' : `  - ${arbiter.evolution}`
  return [
    `Final verdict: ${arbiter.final_verdict}`,
    `Decision: ${arbiter.decision}`,
    `Accepted objections:\n${accepted}`,
    `Rejected objections:\n${rejected}`,
    `Evolution:\n${evolution}`,
  ].join('\n')
}

/**
 * Collect and release one foreground run without letting disposal replace an
 * independent result failure.
 * @param run - the published reviewer or arbiter run.
 * @param read - structured-result reader for that run's role.
 * @returns the validated structured value.
 */
async function settleStructuredRun<T>(run: SubagentRun, read: (result: SubagentResult) => T): Promise<T> {
  const [execution] = await Promise.allSettled([
    run.result.then((result): T => {
      const error = stopReasonError(result)
      if (error !== undefined) {
        throw new Error(withDiagnosticAndPartialText(error, result))
      }
      return read(result)
    }),
  ])
  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())])
  if (execution.status === 'rejected') {
    if (disposal.status === 'rejected') {
      throw new AggregateError(
        [execution.reason, disposal.reason],
        `isolated review run failed: ${String(execution.reason)}; dispose failed: ${String(disposal.reason)}`,
      )
    }
    throw execution.reason
  }
  if (disposal.status === 'rejected') throw disposal.reason
  return execution.value
}

/**
 * Install the isolated review tool for one subagent provider.
 * @param ctx - Context that owns the registrations.
 * @param config - provider selection, optional tool name, and optional persona.
 */
export function apply(ctx: Context, config: Config): void {
  const toolName = config.toolName ?? 'isolated_review'

  const assertProviderCapabilities = (provider: SubagentProvider): void => {
    if (!provider.capabilities.toolFilter) {
      throw new Error(
        `tool-isolated-review: provider "${provider.name}" cannot isolate the reviewer (no toolFilter capability)`,
      )
    }
    if (!provider.capabilities.persona) {
      throw new Error(
        `tool-isolated-review: provider "${provider.name}" cannot set the reviewer persona (no persona capability)`,
      )
    }
    if (!provider.capabilities.outputSchema) {
      throw new Error(
        `tool-isolated-review: provider "${provider.name}" cannot return a structured verdict (no outputSchema capability)`,
      )
    }
  }

  let mounted: { disposeTool: () => void } | undefined
  const mount = (provider: SubagentProvider): void => {
    assertProviderCapabilities(provider)
    const disposeTool = ctx.tools.register(defineTool({
      name: toolName,
      description: TOOL_DESCRIPTION,
      parameters: {
        task_context: {
          type: 'string',
          required: true,
          description: 'The necessary context the reviewer must reason from: the problem, constraints, requirements, and any evidence. The reviewer has no tools, so include everything it needs and nothing it does not.',
        },
        proposed_solution: {
          type: 'string',
          required: true,
          description: 'The final solution or plan you reached. The reviewer will re-think the problem independently and try to refute this proposal.',
        },
        alternative_angle: {
          type: 'string',
          description: 'Optional: the different approach or viewpoint the reviewer should take, for example "from the perspective of minimal resource use" or "from the perspective of long-term maintenance". Omit to let the reviewer choose.',
        },
        review_focus: {
          type: 'string',
          description: 'Optional: the aspects to scrutinize hardest, for example correctness, failure modes, maintainability, or security. Omit to review the proposal as a whole.',
        },
        review_question: {
          type: 'string',
          description: 'Optional but recommended: the precise question you want the reviewer to answer, written by you for this scenario. Different situations call for different questions — for a design trade-off ask whether the proposal is the right fit and risk; for an unfamiliar implementation ask what could make it fail in production; for a choice between approaches ask which one survives the strongest objections. Omit to let the reviewer decide what to scrutinize.',
        },
        reviewers: {
          type: 'number',
          description: 'Optional: how many isolated reviewers to run in parallel (1-3, default 1). Each reviewer re-thinks independently and is asked to take a different angle, so multiple reviewers cross-check one another.',
        },
        prior_review: {
          type: 'string',
          description: 'Optional: the first-round review (paste its structured verdict) to start a second adversarial round. Requires submitter_rebuttal.',
        },
        submitter_rebuttal: {
          type: 'string',
          description: 'Optional: your response to the first-round review — the objections you concede and those you reject, with reasons. Requires prior_review.',
        },
        arbitrate: {
          type: 'boolean',
          description: 'Optional: when true, after the reviewers return, a final arbiter — equally isolated — weighs every verdict, adopts or rejects each objection with a reason, guards against groupthink, and returns the strongest next evolution of the chosen direction. You keep the final choice.',
        },
      },
      output: {
        // The tool's own output schema uses the registry's value-schema DSL
        // (per-property `required: true`), unlike the reviewer request schema.
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            reviews: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  verdict: {
                    type: 'string',
                    required: true,
                    enum: ['sound-as-is', 'sound-with-changes', 'different-approach'],
                  },
                  objections: {
                    type: 'array',
                    required: true,
                    items: { type: 'string' },
                  },
                  strongest_weakness: { type: 'string', required: true },
                  verdict_reason: { type: 'string', required: true },
                },
              },
            },
            arbiter: {
              type: 'object',
              additionalProperties: false,
              properties: {
                final_verdict: {
                  type: 'string',
                  required: true,
                  enum: ['sound-as-is', 'sound-with-changes', 'different-approach'],
                },
                decision: { type: 'string', required: true },
                accepted_objections: {
                  type: 'array',
                  required: true,
                  items: { type: 'string' },
                },
                rejected_objections: {
                  type: 'array',
                  required: true,
                  items: { type: 'string' },
                },
                evolution: { type: 'string', required: true },
              },
            },
          },
        },
        render: (_args, value) => {
          const reviews = value.reviews as ReviewVerdict[]
          const reviewText = reviews.map((verdict, index) =>
            `Review ${index + 1}/${reviews.length}\n${renderVerdict(verdict)}`).join('\n\n')
          const arbiter = value.arbiter
          const text = arbiter === undefined
            ? reviewText
            : `${reviewText}\n\nFinal verdict (arbiter)\n${renderArbiter(arbiter)}`
          return [{ type: 'text', text }]
        },
      },
      // Each review owns an independent fresh child; sibling reviews overlap.
      isConcurrencySafe: () => true,
      async execute(args: IsolatedReviewArgs, exec): Promise<{ reviews: ReviewVerdict[]; arbiter?: ArbiterVerdict }> {
        const parent: Agent | undefined = exec.agent
        if (!parent) {
          throw new Error('isolated_review requires a calling agent (exec.agent was undefined)')
        }
        const reviewerArgs = args
        if ((reviewerArgs.prior_review === undefined) !== (reviewerArgs.submitter_rebuttal === undefined)) {
          throw new Error('isolated_review: prior_review and submitter_rebuttal must be supplied together for a second round')
        }
        const count = reviewerCount(reviewerArgs.reviewers)
        const runs = await Promise.all(Array.from({ length: count }, (_, position) =>
          ctx.subagents.start(config.provider, {
            label: count > 1 ? `isolated review ${position + 1}/${count}` : 'isolated review',
            prompt: [{
              type: 'text',
              text: buildReviewerPrompt(reviewerArgs, position + 1, count),
            }] as ContentBlock[],
            parent,
            signal: exec.signal,
            persona: config.persona ?? DEFAULT_REVIEWER_PERSONA,
            toolFilter: { allow: [] },
            outputSchema: REVIEW_SCHEMA,
          })))
        const reviews = await Promise.all(runs.map(run => settleStructuredRun(run, reviewVerdictOf)))
        if (reviewerArgs.arbitrate !== true) return { reviews }
        const arbiterRun = await ctx.subagents.start(config.provider, {
          label: 'isolated arbitration',
          prompt: [{ type: 'text', text: buildArbiterPrompt(reviewerArgs, reviews) }] as ContentBlock[],
          parent,
          signal: exec.signal,
          persona: config.persona ?? DEFAULT_REVIEWER_PERSONA,
          toolFilter: { allow: [] },
          outputSchema: ARBITER_SCHEMA,
        })
        const arbiter = await settleStructuredRun(arbiterRun, arbiterVerdictOf)
        return { reviews, arbiter }
      },
    }))
    mounted = { disposeTool }
  }

  ctx.on('subagent/provider-added', (provider) => {
    if (provider.name === config.provider && mounted === undefined) mount(provider)
  })
  ctx.on('subagent/provider-removed', (providerName) => {
    if (providerName !== config.provider || mounted === undefined) return
    mounted.disposeTool()
    mounted = undefined
  })
  const present = ctx.subagents.getProvider(config.provider)
  if (present !== undefined) {
    mount(present)
  } else {
    // A backend fiber may activate later; a misspelled provider remains visible in this log.
    ctx.logger.info(`subagent provider "${config.provider}" not registered yet; the "${toolName}" tool will register when it appears`)
  }
}
