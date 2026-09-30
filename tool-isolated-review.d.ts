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
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
/** Cordis plugin name. */
export declare const name = "tool-isolated-review";
/** Services required by the tool registrations. */
export declare const inject: string[];
/** Plugin config: which subagent provider spawns the isolated reviewer. */
export interface Config {
    /** The `ctx.subagents` provider name that spawns the reviewer (fresh context). */
    provider: string;
    /** Model-facing tool name (default `isolated_review`). */
    toolName?: string;
    /** Per-reviewer persona; defaults to the fixed isolated-reviewer identity. */
    persona?: string;
}
/** Runtime schema for the isolated review row. */
export declare const Config: z<Config>;
/** Model-facing argument vocabulary for one isolated review call. */
interface IsolatedReviewArgs {
    readonly task_context: string;
    readonly proposed_solution: string;
    readonly alternative_angle?: string;
    readonly review_focus?: string;
    readonly review_question?: string;
    readonly reviewers?: number;
    readonly prior_review?: string;
    readonly submitter_rebuttal?: string;
    readonly arbitrate?: boolean;
}
/** One reviewer's structured verdict, produced under {@link REVIEW_SCHEMA}. */
interface ReviewVerdict {
    readonly verdict: 'sound-as-is' | 'sound-with-changes' | 'different-approach';
    objections: string[];
    readonly strongest_weakness: string;
    readonly verdict_reason: string;
}
/**
 * Compose the reviewer's standalone task from the model's arguments and the
 * reviewer's position among parallel reviewers.
 * @param args - context, solution, and the model-authored framing.
 * @param index - one-based reviewer position.
 * @param count - total parallel reviewers.
 * @returns the full reviewer prompt.
 */
export declare function buildReviewerPrompt(args: IsolatedReviewArgs, index?: number, count?: number): string;
/**
 * Compose the final arbiter's task from the framing and every reviewer verdict.
 * @param args - context and solution the reviewers judged.
 * @param reviews - the reviewers' structured verdicts, rendered for the arbiter.
 * @returns the full arbiter prompt.
 */
export declare function buildArbiterPrompt(args: IsolatedReviewArgs, reviews: readonly ReviewVerdict[]): string;
/**
 * Install the isolated review tool for one subagent provider.
 * @param ctx - Context that owns the registrations.
 * @param config - provider selection, optional tool name, and optional persona.
 */
export declare function apply(ctx: Context, config: Config): void;
export {};
