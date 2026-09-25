import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as mock from './scripted-provider.ts'
import * as tool from '../src/index.ts'

/** Shared non-aborted tool signal for package-local integration tests. */
const testToolSignal = new AbortController().signal

/** A fully valid scripted reviewer verdict. */
const VERDICT = {
  verdict: 'sound-with-changes',
  objections: ['one objection'],
  strongest_weakness: 'the failure modes',
  verdict_reason: 'the proposal is sound with changes',
} as const

/** A fully valid scripted arbiter verdict. */
const ARBITER = {
  final_verdict: 'sound-with-changes',
  decision: 'refactor the renderer',
  accepted_objections: ['the screenshot path is heavy'],
  rejected_objections: ['fonts may break — already handled by the fallback'],
  evolution: 'move rendering to a worker',
} as const

/** Build the minimal parent Agent owned by the package-local scripted provider. */
function fakeAgent(id = 'parent-1'): Agent {
  const sessionId = SessionId(id)
  // The asserted object is a structural subset of Agent (Agent assigns to it),
  // so the plain `as Agent` assertion is legal without an `as unknown` detour.
  return { id: sessionId, options: {}, session: Session.create(sessionId) } as Agent
}

/**
 * Mount the real tool and service stack around one scripted subagent provider
 * and return the context plus the mounted provider fiber.
 */
async function setup(
  toolConfig: tool.Config,
  mockConfig: Partial<mock.Config> = {},
): Promise<{ ctx: Context; provider: Awaited<ReturnType<typeof mock.mountScriptedProvider>> }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SubagentRuntime)
  const provider = await mock.mountScriptedProvider(ctx, { name: 'mock', ...mockConfig })
  await ctx.plugin(tool, toolConfig)
  return { ctx, provider }
}

let callCounter = 0

/** Execute the registered isolated_review tool through the real ToolRuntime pipeline. */
function callReview(
  ctx: Context,
  args: unknown,
  over: { agent?: Agent | undefined; signal?: AbortSignal } = {},
) {
  const agent = 'agent' in over ? over.agent : fakeAgent()
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId(`review-${++callCounter}`),
    name: 'isolated_review',
    arguments: args,
    ...agent ? { agent } : {},
    ...over.signal ? { signal: over.signal } : {},
  })
}

/** Join text blocks from one rendered tool result. */
function text(result: { content: readonly { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

const REVIEW_ARGS = {
  task_context: 'A CLI tool that converts Markdown to PDF must keep code blocks intact.',
  proposed_solution: 'Render every code block as a full-page screenshot before converting.',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('dsh-tool-isolated-review', () => {
  it('registers an isolated_review tool that delegates to the configured provider and returns structured reviews', async () => {
    let seen: SubagentStartRequest | undefined
    const { ctx } = await setup({ provider: 'mock' }, {
      reply: 'the proposal is sound with changes',
      onStart: (request) => { seen = request },
    })
    const result = await callReview(ctx, REVIEW_ARGS)
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected review success')
    expect(result.value).toEqual({ reviews: [VERDICT] })
    expect(text(result)).toContain('Review 1/1')
    expect(text(result)).toContain('verdict: sound-with-changes')
    expect(text(result)).toContain('- one objection')
    expect(text(result)).toContain('the failure modes')
    expect(seen?.persona).toContain('You are an isolated reviewer')
    expect(seen?.toolFilter).toEqual({ allow: [] })
    expect(seen?.label).toBe('isolated review')
    expect(seen?.outputSchema).toBeDefined()
    const prompt = seen!.prompt.map(block => block.type === 'text' ? block.text : '').join('')
    expect(prompt).toContain('A CLI tool that converts Markdown to PDF')
    expect(prompt).toContain('Render every code block as a full-page screenshot')
    expect(prompt).toContain('Challenge the proposal explicitly')
    expect(prompt).toContain('verdict (one of')
  })

  it('uses the configured persona override instead of the default reviewer identity', async () => {
    let seen: SubagentStartRequest | undefined
    const { ctx } = await setup({ provider: 'mock', persona: 'You are a skeptical architect.' }, {
      onStart: (request) => { seen = request },
    })
    await callReview(ctx, REVIEW_ARGS)
    expect(seen?.persona).toBe('You are a skeptical architect.')
  })

  it('omits optional focus, angle, and question text when the model does not supply them', async () => {
    let seen: SubagentStartRequest | undefined
    const { ctx } = await setup({ provider: 'mock' }, { onStart: (request) => { seen = request } })
    await callReview(ctx, REVIEW_ARGS)
    const prompt = seen!.prompt.map(block => block.type === 'text' ? block.text : '').join('')
    expect(prompt).not.toContain('Scrutinize hardest')
    expect(prompt).not.toContain('approach it from this angle')
    expect(prompt).not.toContain('The question you must answer')
    expect(prompt).not.toContain('reviewer 1 of')
  })

  it('includes review_focus, alternative_angle, and review_question when the model supplies them', async () => {
    let seen: SubagentStartRequest | undefined
    const { ctx } = await setup({ provider: 'mock' }, { onStart: (request) => { seen = request } })
    await callReview(ctx, {
      ...REVIEW_ARGS,
      review_focus: 'failure modes',
      alternative_angle: 'from the perspective of minimal resource use',
      review_question: 'what would break this plan in production?',
    })
    const prompt = seen!.prompt.map(block => block.type === 'text' ? block.text : '').join('')
    expect(prompt).toContain('Scrutinize hardest: failure modes')
    expect(prompt).toContain('approach it from this angle: from the perspective of minimal resource use')
    expect(prompt).toContain('The question you must answer: what would break this plan in production?')
  })

  it('runs multiple reviewers in parallel with per-reviewer labels and positions', async () => {
    const seen: SubagentStartRequest[] = []
    const { ctx } = await setup({ provider: 'mock' }, { reply: 'the proposal is sound with changes', onStart: (request) => { seen.push(request) } })
    const result = await callReview(ctx, { ...REVIEW_ARGS, reviewers: 2 })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected review success')
    expect(result.value).toEqual({ reviews: [VERDICT, VERDICT] })
    expect(text(result)).toContain('Review 1/2')
    expect(text(result)).toContain('Review 2/2')
    expect(seen).toHaveLength(2)
    expect(seen.map(request => request.label)).toEqual(['isolated review 1/2', 'isolated review 2/2'])
    const prompts = seen.map(request => request.prompt.map(block => block.type === 'text' ? block.text : '').join(''))
    expect(prompts[0]).toContain('reviewer 1 of 2')
    expect(prompts[1]).toContain('reviewer 2 of 2')
    expect(prompts[1]).toContain('Pick a different angle from the other reviewers')
  })

  it('clamps the reviewer count into 1..3', async () => {
    for (const { reviewers, expected } of [
      { reviewers: undefined, expected: 1 },
      { reviewers: 0, expected: 1 },
      { reviewers: -5, expected: 1 },
      { reviewers: 1.9, expected: 1 },
      { reviewers: 3, expected: 3 },
      { reviewers: 99, expected: 3 },
    ]) {
      const seen: SubagentStartRequest[] = []
      const { ctx } = await setup({ provider: 'mock' }, { onStart: (request) => { seen.push(request) } })
      await callReview(ctx, { ...REVIEW_ARGS, ...reviewers === undefined ? {} : { reviewers } })
      expect(seen).toHaveLength(expected)
    }
  })

  it('starts a second adversarial round when prior_review and submitter_rebuttal are both supplied', async () => {
    let seen: SubagentStartRequest | undefined
    const { ctx } = await setup({ provider: 'mock' }, { onStart: (request) => { seen = request } })
    await callReview(ctx, {
      ...REVIEW_ARGS,
      prior_review: 'verdict: different-approach; objections: the screenshot approach is too heavy',
      submitter_rebuttal: 'the screenshot path reuses existing rendering, so the cost claim is wrong',
    })
    const prompt = seen!.prompt.map(block => block.type === 'text' ? block.text : '').join('')
    expect(prompt).toContain('second round of an adversarial review')
    expect(prompt).toContain('the screenshot approach is too heavy')
    expect(prompt).toContain('the screenshot path reuses existing rendering')
    expect(prompt).toContain('concede the points it answers')
  })

  it('rejects a second round when only one of prior_review and submitter_rebuttal is supplied', async () => {
    const { ctx } = await setup({ provider: 'mock' })
    const missingRebuttal = await callReview(ctx, { ...REVIEW_ARGS, prior_review: 'first verdict' })
    expect(missingRebuttal.isError).toBe(true)
    expect(text(missingRebuttal)).toContain('must be supplied together')
  })

  it('runs a final arbiter when arbitrate is set, returning its structured verdict and evolution', async () => {
    const seen: SubagentStartRequest[] = []
    const { ctx } = await setup({ provider: 'mock' }, {
      reply: 'the proposal is sound with changes',
      structuredByLabel: { 'isolated arbitration': ARBITER },
      onStart: (request) => { seen.push(request) },
    })
    const result = await callReview(ctx, { ...REVIEW_ARGS, reviewers: 2, arbitrate: true })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected review success')
    expect(result.value).toEqual({ reviews: [VERDICT, VERDICT], arbiter: ARBITER })
    expect(text(result)).toContain('Review 1/2')
    expect(text(result)).toContain('Final verdict (arbiter)')
    expect(text(result)).toContain('Final verdict: sound-with-changes')
    expect(text(result)).toContain('Evolution:')
    const arbiterStart = seen.find(request => request.label === 'isolated arbitration')
    expect(arbiterStart).toBeDefined()
    expect(arbiterStart?.outputSchema).toBeDefined()
    const prompt = arbiterStart!.prompt.map(block => block.type === 'text' ? block.text : '').join('')
    expect(prompt).toContain('final arbiter of an adversarial review')
    expect(prompt).toContain('Guard against groupthink')
    expect(prompt).toContain('Review 1/2')
    expect(prompt).toContain('the proposal is sound with changes')
  })

  it('produces no arbiter when arbitrate is omitted', async () => {
    const { ctx } = await setup({ provider: 'mock' }, { reply: 'the proposal is sound with changes' })
    const result = await callReview(ctx, REVIEW_ARGS)
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected review success')
    expect(result.value).toEqual({ reviews: [VERDICT] })
    expect(text(result)).not.toContain('Final verdict (arbiter)')
  })

  it('fails loud when the arbiter returns no valid structured verdict', async () => {
    for (const arbiter of [
      null,
      'not-an-object',
      [],
      { final_verdict: 'nonsense', decision: 'd', accepted_objections: [], rejected_objections: [], evolution: '' },
      { final_verdict: 'sound-as-is', decision: 1, accepted_objections: [], rejected_objections: [], evolution: '' },
      { final_verdict: 'sound-as-is', decision: 'd', accepted_objections: 'no', rejected_objections: [], evolution: '' },
      { final_verdict: 'sound-as-is', decision: 'd', accepted_objections: [], rejected_objections: [1], evolution: '' },
      { final_verdict: 'sound-as-is', decision: 'd', accepted_objections: [], rejected_objections: [], evolution: 1 },
    ]) {
      const { ctx } = await setup({ provider: 'mock' }, { structuredByLabel: { 'isolated arbitration': arbiter } })
      const result = await callReview(ctx, { ...REVIEW_ARGS, arbitrate: true })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('arbiter returned no valid structured verdict')
    }
  })

  it('renders empty arbiter lists and a no-evolution marker', async () => {
    const { ctx } = await setup({ provider: 'mock' }, {
      structuredByLabel: {
        'isolated arbitration': {
          final_verdict: 'sound-as-is',
          decision: 'ship it',
          accepted_objections: [],
          rejected_objections: [],
          evolution: '',
        },
      },
    })
    const result = await callReview(ctx, { ...REVIEW_ARGS, arbitrate: true })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('Accepted objections:\n  (none)')
    expect(text(result)).toContain('Rejected objections:\n  (none)')
    expect(text(result)).toContain('(none needed)')
  })

  it('requires every reviewer to contribute a point the others would miss (anti-groupthink)', async () => {
    const seen: SubagentStartRequest[] = []
    const { ctx } = await setup({ provider: 'mock' }, { onStart: (request) => { seen.push(request) } })
    await callReview(ctx, { ...REVIEW_ARGS, reviewers: 2 })
    const prompts = seen.map(request => request.prompt.map(block => block.type === 'text' ? block.text : '').join(''))
    expect(prompts[0]).toContain('NOT obvious to the other reviewers')
    expect(prompts[1]).toContain('mark your distinct point')
    expect(prompts[1]).toContain('reviewer 2 of 2')
  })

  it('fails loud when the provider returns no valid structured verdict', async () => {
    for (const structured of [
      null,
      'not-an-object',
      [],
      { verdict: 'nonsense' },
      { verdict: 'sound-as-is', objections: 'no', strongest_weakness: 'w', verdict_reason: 'r' },
      { verdict: 'sound-as-is', objections: [1], strongest_weakness: 'w', verdict_reason: 'r' },
      { verdict: 'sound-as-is', objections: [], strongest_weakness: 1, verdict_reason: 'r' },
      { verdict: 'sound-as-is', objections: [], strongest_weakness: 'w', verdict_reason: 1 },
    ]) {
      const { ctx } = await setup({ provider: 'mock' }, { structured })
      const result = await callReview(ctx, REVIEW_ARGS)
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('no valid structured verdict')
    }
  })

  it('maps non-completed stop reasons to an isError result, preserving partial output', async () => {
    for (const { stopReason, fragment } of [
      { stopReason: 'aborted' as const, fragment: 'cancelled' },
      { stopReason: 'error' as const, fragment: 'failed' },
      { stopReason: 'max-tokens' as const, fragment: 'token limit' },
      { stopReason: 'refusal' as const, fragment: 'declined' },
    ]) {
      const { ctx } = await setup({ provider: 'mock' }, { stopReason })
      const result = await callReview(ctx, REVIEW_ARGS)
      expect(result.isError).toBe(true)
      expect(text(result)).toContain(fragment)
      expect(text(result)).toContain('scripted reviewer reply')
    }
  })

  it('treats an unknown (plugin-added) stop reason as an isError result', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    ctx.subagents.registerProvider({
      name: 'weird',
      capabilities: { agentOptions: false, outputSchema: true, depthLimit: false, toolFilter: true, persona: true },
      inheritsParentContext: false,
      start: async () => ({
        id: SessionId('weird-reviewer'),
        localAgent: undefined,
        result: Promise.resolve({
          output: [{ type: 'text', text: 'partial' }],
          stopReason: 'frobnicated' as never,
          structured: VERDICT,
        }),
        dispose: async () => {},
      }),
    })
    await ctx.plugin(tool, { provider: 'weird' })

    const result = await callReview(ctx, REVIEW_ARGS)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('abnormally')
  })

  it('renders provider diagnostics before preserved partial assistant output', async () => {
    const { ctx } = await setup({ provider: 'mock' }, {
      reply: 'partial review text',
      diagnostic: 'the reviewer backend denied a tool request',
      stopReason: 'error',
    })
    const result = await callReview(ctx, REVIEW_ARGS)
    expect(result.isError).toBe(true)
    expect(text(result)).toBe(
      'Error: isolated review run failed\n'
      + 'Diagnostic: the reviewer backend denied a tool request\n'
      + 'Partial output before the run ended:\npartial review text',
    )
  })

  it('rejects provider capability gaps at load (no silent degradation)', async () => {
    await expect(setup(
      { provider: 'mock' },
      { capabilities: { toolFilter: false } },
    )).rejects.toThrow('cannot isolate the reviewer')
    await expect(setup(
      { provider: 'mock' },
      { capabilities: { persona: false } },
    )).rejects.toThrow('cannot set the reviewer persona')
    await expect(setup(
      { provider: 'mock' },
      { capabilities: { outputSchema: false } },
    )).rejects.toThrow('cannot return a structured verdict')
  })

  it('fails loud when invoked without a calling agent', async () => {
    const { ctx } = await setup({ provider: 'mock' })
    const result = await callReview(ctx, REVIEW_ARGS, { agent: undefined })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('requires a calling agent')
  })

  it('registers when the provider appears later and unmounts when it is removed', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(tool, { provider: 'late' })
    expect(ctx.tools.schemas().some(s => s.name === 'isolated_review')).toBe(false)
    const provider = await mock.mountScriptedProvider(ctx, { name: 'late', reply: 'late review' })
    expect(ctx.tools.schemas().some(s => s.name === 'isolated_review')).toBe(true)
    const result = await callReview(ctx, REVIEW_ARGS)
    expect(text(result)).toContain('late review')
    await provider.dispose()
    expect(ctx.tools.schemas().some(s => s.name === 'isolated_review')).toBe(false)
  })

  it('keeps the tool mounted when an unrelated provider registers or leaves', async () => {
    const { ctx } = await setup({ provider: 'mock' })
    const other = await mock.mountScriptedProvider(ctx, { name: 'other' })
    expect(ctx.tools.schemas().filter(s => s.name === 'isolated_review')).toHaveLength(1)
    await other.dispose()
    expect(ctx.tools.schemas().some(s => s.name === 'isolated_review')).toBe(true)
  })

  it('classifies reviews concurrency-safe (sibling reviews overlap)', async () => {
    const { ctx } = await setup({ provider: 'mock' })
    expect(ctx.tools.executionMode({
      signal: testToolSignal,
      callId: ToolCallId('review-parallel'),
      name: 'isolated_review',
      arguments: REVIEW_ARGS,
    })).toEqual({ kind: 'parallel' })
  })

  it('registers under a configurable toolName so multiple instances can coexist', async () => {
    const { ctx } = await setup({ provider: 'mock', toolName: 'isolated_review_custom' })
    expect(ctx.tools.schemas().some(s => s.name === 'isolated_review_custom')).toBe(true)
    expect(ctx.tools.schemas().some(s => s.name === 'isolated_review')).toBe(false)
  })

  it('defaults toolName when apply() is called directly (schema bypass)', async () => {
    // ctx.plugin validates + defaults config first (toolName → 'isolated_review'),
    // so the runtime `?? 'isolated_review'` fallback is only reachable through a
    // direct apply() that bypasses Schemastery.
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    await mock.mountScriptedProvider(ctx, { name: 'mock', reply: 'ok' })
    tool.apply(ctx, { provider: 'mock' })
    expect(ctx.tools.schemas().some(s => s.name === 'isolated_review')).toBe(true)
  })

  it('exposes the full model-facing schema including the review-framing fields', async () => {
    const { ctx } = await setup({ provider: 'mock' })
    const schema = ctx.tools.schemas().find(s => s.name === 'isolated_review')!
    const props = (schema.parameters as { properties: Record<string, unknown> }).properties
    expect(Object.keys(props).sort()).toEqual([
      'alternative_angle',
      'arbitrate',
      'prior_review',
      'proposed_solution',
      'review_focus',
      'review_question',
      'reviewers',
      'submitter_rebuttal',
      'task_context',
    ])
    expect(schema.description).toContain('isolated reviewer')
    expect(schema.description).toContain('adversarial second opinion')
    expect(schema.description).toContain('second adversarial round')
    expect(schema.description).toContain('final arbiter')
  })

  it('passes the tool abort signal as the provider cancellation channel', async () => {
    const cancelled = vi.fn()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    ctx.subagents.registerProvider({
      name: 'spy',
      capabilities: { agentOptions: false, outputSchema: true, depthLimit: false, toolFilter: true, persona: true },
      inheritsParentContext: false,
      start: async (request) => {
        if (request.signal.aborted) throw new Error('start aborted')
        let resolveResult: (r: { output: never[]; stopReason: 'aborted'; structured?: unknown }) => void
        const result = new Promise<{ output: never[]; stopReason: 'aborted'; structured?: unknown }>((res) => { resolveResult = res })
        request.signal.addEventListener('abort', () => {
          cancelled()
          resolveResult({ output: [], stopReason: 'aborted' })
        }, { once: true })
        return {
          id: SessionId('spy-reviewer'),
          localAgent: undefined,
          result,
          dispose: async () => {},
        }
      },
    })
    await ctx.plugin(tool, { provider: 'spy' })

    const controller = new AbortController()
    const pending = callReview(ctx, REVIEW_ARGS, { signal: controller.signal })
    await Promise.resolve()
    await Promise.resolve()
    controller.abort()
    const result = await pending
    expect(cancelled).toHaveBeenCalledTimes(1)
    expect(result.isError).toBe(true)
  })

  it('skips provider startup for an already-aborted signal', async () => {
    const sawAborted = vi.fn()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    ctx.subagents.registerProvider({
      name: 'spy',
      capabilities: { agentOptions: false, outputSchema: true, depthLimit: false, toolFilter: true, persona: true },
      inheritsParentContext: false,
      start: async (request) => {
        if (request.signal.aborted) sawAborted()
        throw new Error('start aborted')
      },
    })
    await ctx.plugin(tool, { provider: 'spy' })

    const controller = new AbortController()
    controller.abort()
    const result = await callReview(ctx, REVIEW_ARGS, { signal: controller.signal })
    expect(sawAborted).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
  })

  it('disposes the run on the success path', async () => {
    const disposed = vi.fn()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    ctx.subagents.registerProvider({
      name: 'spy',
      capabilities: { agentOptions: false, outputSchema: true, depthLimit: false, toolFilter: true, persona: true },
      inheritsParentContext: false,
      start: async () => ({
        id: SessionId('spy-reviewer'),
        localAgent: undefined,
        result: Promise.resolve({ output: [{ type: 'text', text: 'ok' }], stopReason: 'completed' as const, structured: VERDICT }),
        dispose: async () => void disposed(),
      }),
    })
    await ctx.plugin(tool, { provider: 'spy' })

    await callReview(ctx, REVIEW_ARGS)
    expect(disposed).toHaveBeenCalledTimes(1)
  })

  it('disposes the run on the error path too', async () => {
    const disposed = vi.fn()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    ctx.subagents.registerProvider({
      name: 'spy',
      capabilities: { agentOptions: false, outputSchema: true, depthLimit: false, toolFilter: true, persona: true },
      inheritsParentContext: false,
      start: async () => ({
        id: SessionId('spy-reviewer'),
        localAgent: undefined,
        result: Promise.resolve({ output: [], stopReason: 'error' as const }),
        dispose: async () => void disposed(),
      }),
    })
    await ctx.plugin(tool, { provider: 'spy' })

    const result = await callReview(ctx, REVIEW_ARGS)
    expect(result.isError).toBe(true)
    expect(disposed).toHaveBeenCalledTimes(1)
  })

  it('preserves independent foreground result and disposal failures', async () => {
    const disposed = vi.fn()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    ctx.subagents.registerProvider({
      name: 'spy',
      capabilities: { agentOptions: false, outputSchema: true, depthLimit: false, toolFilter: true, persona: true },
      inheritsParentContext: false,
      start: async () => ({
        id: SessionId('spy-reviewer'),
        localAgent: undefined,
        result: Promise.reject(new Error('published run failed')),
        dispose: async () => {
          disposed()
          throw new Error('published handle disposal failed')
        },
      }),
    })
    await ctx.plugin(tool, { provider: 'spy' })

    const result = await callReview(ctx, REVIEW_ARGS)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('published run failed')
    expect(text(result)).toContain('published handle disposal failed')
    expect(disposed).toHaveBeenCalledTimes(1)
  })

  it('reports a foreground disposal failure after a completed result', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    ctx.subagents.registerProvider({
      name: 'spy',
      capabilities: { agentOptions: false, outputSchema: true, depthLimit: false, toolFilter: true, persona: true },
      inheritsParentContext: false,
      start: async () => ({
        id: SessionId('spy-reviewer'),
        localAgent: undefined,
        result: Promise.resolve({
          output: [{ type: 'text', text: 'completed before disposal' }],
          stopReason: 'completed',
          structured: VERDICT,
        }),
        dispose: () => Promise.reject(new Error('published handle disposal failed')),
      }),
    })
    await ctx.plugin(tool, { provider: 'spy' })

    const result = await callReview(ctx, REVIEW_ARGS)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('published handle disposal failed')
  })

  it('waits for a provider absent at load without registering a premature tool', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(tool, { provider: 'later' })
    expect(ctx.tools.schemas().some(s => s.name === 'isolated_review')).toBe(false)
  })

  it('renders an empty objections list without decoration', async () => {
    const { ctx } = await setup({ provider: 'mock' }, {
      structured: { verdict: 'sound-as-is', objections: [], strongest_weakness: 'none serious', verdict_reason: 'holds' },
    })
    const result = await callReview(ctx, REVIEW_ARGS)
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('(none)')
  })

  it('has the namespace-plugin export shape (no stray default) so the Loader keeps name/inject/Config/apply', () => {
    expect('default' in tool).toBe(false)
    expect(tool.name).toBe('tool-isolated-review')
    expect(tool.inject).toEqual(['tools', 'subagents'])
    expect(typeof tool.apply).toBe('function')
    expect(tool.Config).toBeDefined()
  })

  it('composes the reviewer prompt deterministically across framing fields and rounds', () => {
    const plain = tool.buildReviewerPrompt(REVIEW_ARGS)
    expect(plain).toContain('You are an isolated reviewer')
    expect(plain).toContain('Task context:')
    expect(plain).toContain('The submitter\'s proposed solution:')
    expect(plain).not.toContain('second round')
    const focused = tool.buildReviewerPrompt({
      ...REVIEW_ARGS,
      review_focus: 'security',
      alternative_angle: 'from the tester\'s seat',
      review_question: 'does the security model hold when users are untrusted?',
    }, 2, 3)
    expect(focused).toContain('Scrutinize hardest: security')
    expect(focused).toContain('approach it from this angle: from the tester\'s seat')
    expect(focused).toContain('The question you must answer: does the security model hold when users are untrusted?')
    expect(focused).toContain('You are reviewer 2 of 3')
    const round = tool.buildReviewerPrompt({
      ...REVIEW_ARGS,
      prior_review: 'first verdict',
      submitter_rebuttal: 'my response',
    })
    expect(round).toContain('second round of an adversarial review')
    expect(round).toContain('first verdict')
    expect(round).toContain('my response')
  })

  it('composes the arbiter prompt from the framing and every rendered verdict', () => {
    const verdicts = [VERDICT, VERDICT].map(verdict => ({ ...verdict, objections: [...verdict.objections] }))
    const arbiter = tool.buildArbiterPrompt(REVIEW_ARGS, verdicts)
    expect(arbiter).toContain('final arbiter of an adversarial review')
    expect(arbiter).toContain('Task context:')
    expect(arbiter).toContain('Independent reviewer verdicts:')
    expect(arbiter).toContain('Review 1/2')
    expect(arbiter).toContain('Review 2/2')
    expect(arbiter).toContain('verdict: sound-with-changes')
    expect(arbiter).toContain('Guard against groupthink')
    expect(arbiter).toContain('evolution (the strongest next step')
  })
})
