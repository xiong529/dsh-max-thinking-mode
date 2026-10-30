/**
 * Contract smoke test for the refactored tool-isolated-review:
 * simulates the real Host surfaces the plugin touches (ctx.tools.register,
 * ctx.subagents.getProvider/startActivation, ctx.on, ctx.logger) with stubs
 * and asserts the rewritten behavior:
 *   1. apply() no longer throws on a spawn-like provider (old bug: mandatory
 *      toolFilter/persona capability assertions).
 *   2. execute() goes through ctx.subagents.startActivation (old bug: it
 *      called the nonexistent ctx.subagents.start).
 *   3. the startActivation request carries agentPreset when configured and
 *      never carries the removed persona/toolFilter fields.
 *   4. a full single-review round trips structured verdicts and renders text.
 */
import { strict as assert } from 'node:assert'
import * as tool from './lib/index.js'

const VERDICT = {
  verdict: 'sound-with-changes',
  objections: ['the screenshot path is heavy'],
  strongest_weakness: 'rendering cost',
  verdict_reason: 'the proposal is sound with changes',
}

function fakeCtx({ agentPreset, providerCapabilities, providerName = 'spawn', arbiterValue } = {}) {
  let definition
  const calls = []
  const ctx = {
    logger: { warn: () => {}, info: () => {}, error: () => {} },
    on: () => {},
    tools: {
      register(def) {
        definition = def
        return () => { definition = undefined }
      },
    },
    subagents: {
      getProvider() {
        return { name: providerName, capabilities: providerCapabilities }
      },
      async startActivation(spec) {
        calls.push(spec)
        const arbiter = spec.label === 'isolated arbitration'
        const structured = arbiter ? (arbiterValue ?? {
          final_verdict: 'sound-with-changes',
          decision: 'refactor the renderer',
          accepted_objections: ['the screenshot path is heavy'],
          rejected_objections: [],
          evolution: 'move rendering to a worker',
        }) : VERDICT
        return {
          childId: `child-${calls.length}`,
          result: Promise.resolve({
            output: [{ type: 'text', text: arbiter ? 'arbiter text' : 'review text' }],
            stopReason: 'completed',
            structured,
          }),
          async dispose() {},
        }
      },
    },
  }
  return { ctx, definition: () => definition, calls }
}

async function main() {
  // Case 1: apply() mounts on a spawn provider (agentPreset capability present).
  {
    const { ctx, definition, calls } = fakeCtx({
      agentPreset: 'minimal',
      providerCapabilities: { agentOptions: true, agentPreset: true, outputSchema: true, depthLimit: true },
    })
    tool.apply(ctx, { provider: 'spawn', agentPreset: 'minimal' })
    assert.ok(definition(), 'tool should be registered after apply()')
    const result = await definition().execute(
      { task_context: 'A CLI tool that converts Markdown to PDF', proposed_solution: 'Render code blocks as screenshots' },
      { agent: { id: 'parent-1' }, signal: new AbortController().signal },
    )
    assert.deepEqual(result, { reviews: [VERDICT] })
    assert.equal(calls.length, 1, 'one reviewer start')
    const spec = calls[0]
    assert.equal(spec.provider, 'spawn')
    assert.equal(spec.delivery, 'caller')
    assert.equal(spec.request.agentPreset, 'minimal')
    assert.ok(spec.request.outputSchema, 'startActivation must carry the reviewer output schema')
    assert.equal(spec.request.outputSchema.properties.verdict.enum.length, 3, 'verdict enum carries the three verdicts')
    assert.equal('persona' in spec.request, false, 'persona must be gone from the start request')
    assert.equal('toolFilter' in spec.request, false, 'toolFilter must be gone from the start request')
    // render path
    const blocks = definition().output.render({}, { reviews: [VERDICT] })
    assert.match(blocks[0].text, /Review 1\/1/)
    assert.match(blocks[0].text, /verdict: sound-with-changes/)
    assert.match(blocks[0].text, /- the screenshot path is heavy/)
  }

  // Case 2: without agentPreset configured, the request omits the field.
  {
    const { ctx, definition, calls } = fakeCtx({
      providerCapabilities: { agentOptions: true, agentPreset: true, outputSchema: true, depthLimit: true },
    })
    tool.apply(ctx, { provider: 'spawn' })
    assert.ok(definition())
    await definition().execute(
      { task_context: 'ctx', proposed_solution: 'sol' },
      { agent: { id: 'parent-2' }, signal: new AbortController().signal },
    )
    assert.equal('agentPreset' in calls[0].request, false, 'agentPreset omitted when not configured')
  }

  // Case 3: arbiter round trips.
  {
    const { ctx, definition, calls } = fakeCtx({
      agentPreset: 'minimal',
      providerCapabilities: { agentOptions: true, agentPreset: true, outputSchema: true, depthLimit: true },
    })
    tool.apply(ctx, { provider: 'spawn', agentPreset: 'minimal' })
    const result = await definition().execute(
      { task_context: 'ctx', proposed_solution: 'sol', reviewers: 2, arbitrate: true },
      { agent: { id: 'parent-3' }, signal: new AbortController().signal },
    )
    assert.equal(calls.length, 3, 'two reviewers + one arbiter')
    assert.equal(calls[2].label, 'isolated arbitration')
    assert.equal(result.reviews.length, 2)
    assert.ok(result.arbiter && result.arbiter.final_verdict === 'sound-with-changes')
  }

  // Case 4: apply() does NOT throw for a provider without the (removed)
  // toolFilter/persona capabilities — it only hard-requires outputSchema.
  {
    const { ctx, definition } = fakeCtx({
      providerCapabilities: { agentOptions: false, agentPreset: false, outputSchema: true, depthLimit: false },
    })
    tool.apply(ctx, { provider: 'spawn' }) // must not throw
    assert.ok(definition())
  }

  // Case 5: missing outputSchema capability still fails loud.
  {
    const { ctx } = fakeCtx({
      providerCapabilities: { agentOptions: false, agentPreset: false, outputSchema: false, depthLimit: false },
    })
    assert.throws(
      () => tool.apply(ctx, { provider: 'spawn' }),
      /cannot return a structured verdict/,
    )
  }

  console.log('verify-contract: all assertions passed (5/5)')
}

main().catch((error) => {
  console.error('verify-contract FAILED:', error)
  process.exit(1)
})