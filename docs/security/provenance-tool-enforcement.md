# Provenance-Aware Tool Enforcement

The first deterministic provenance-aware enforcement seam lives in:

- `src/agents/agent-tools.before-tool-call.ts`

At this seam OpenClaw now evaluates, before tool execution:

- tool classification metadata from issue `#4`
- active enforcement metadata resolved from the live in-context transcript
- whether the pending tool call is a consequential outbound action
- the resolved current audience for the active turn (`turnSourceChannel`, `turnSourceTo`, optional thread id)
- whether the call carries outbound content and whether its routing stays within that audience

## Replay-derived policy input

Issue `#6` extends the enforcement input from "fresh inbound turn only" to
"whatever provenance-aware content still survives in the active replay context".

Current resolution order is:

1. project current-turn `InputProvenance` into coarse `enforcementMetadata`
2. scan the live replay context for preserved carriers
   - user messages that still carry `enforcementMetadata`
   - compaction summaries whose `details.enforcementMetadata` preserves summarized-away trust state
3. merge those carriers conservatively, with `untrusted` sticky

This means a later tool call can still be blocked after compaction or replay if
the surviving context shows that the model is still operating under untrusted
influence, even when the original raw inbound message is no longer present as a
full transcript row.

## Current enforced rule

The first narrow built-in rule family stays intentionally small and only targets the `message` tool:

- only evaluate mutating outbound `message` actions
- only evaluate calls whose payload contains outbound content
- allow replies that stay within the current resolved audience
  - implicit current-chat replies
  - explicit same-chat replies when the resolved target matches the source conversation
- deny calls that route to a different audience
  - different DM recipient
  - different channel/provider
  - explicit multi-target fanout
  - thread broadening from a source thread to a wider channel/root destination
- fail closed when the current audience cannot be resolved and the runtime therefore cannot prove the send stays in-bounds

This keeps the rule focused on untrusted-content-driven egress while preserving normal “reply back in the same conversation” flows.

## Operator config and audit surface

The narrowed built-in rule is operator-configurable under `security.provenanceEnforcement`:

```json5
{
  security: {
    provenanceEnforcement: {
      enabled: true,
      audit: "blocked", // off | blocked | all
    },
  },
}
```

- `enabled` is the master switch for the built-in provenance-aware before-tool-call policy.
  - default: `true`
  - use `false` only as an explicit rollback/debugging escape hatch
- `audit` controls dedicated operator-facing `security.event` emission for this rule family.
  - `off`: do not emit dedicated provenance-policy decision security events
  - `blocked`: emit only deny decisions
  - `all`: emit both allow and deny decisions for consequential calls

This config only affects the narrowed built-in rule family. It does not disable generic diagnostics, plugin approval events, or non-FIDES tool-loop protections.

## Regression harness

Issue `#12` adds a small permanent regression harness at:

- `src/security/provenance-enforcement-regression.test.ts`

The harness is intentionally narrow enough to run continuously and locks down one representative scenario from each required class:

- untrusted outbound exfiltration is blocked before tool execution
- trusted/operator-intended outbound routing is allowed
- mixed trusted/untrusted context is treated conservatively
- replay/compaction-preserved provenance still affects later routing decisions
- operator-facing diagnostics stay useful without leaking blocked content or secret-like provenance labels

Keep future extensions small and scenario-driven. If a new rule family or transport boundary lands, prefer adding one representative regression here plus any lower-level unit coverage needed for the new seam.

## Decision diagnostics

When diagnostics are enabled and the audit mode allows emission, OpenClaw records a trusted `security.event` for the provenance-aware decision with:

- the concrete policy id that fired
  - `fides-untrusted-content-message-egress`
  - `fides-untrusted-content-message-egress-ambiguous`
- the final decision (`allow` or `deny`)
- correlation fields for where the decision happened
  - `runId`
  - `sessionKey`
  - `sessionId`
  - `agentId`
  - `toolCallId`
- the consequential classification and argument paths that mattered
  - `consequential_classes`
  - `content_paths`
  - `destination_paths`
- the coarse provenance state that was observed
  - `provenance_trust`
  - `provenance_source_kind`
  - redacted `provenance_source_label`
- the resolved audience scope used by the check
  - `audience_resolved`
  - `audience_scope`
  - optional `audience_channel`

This is the operator-facing truth surface for issue `#11`. The user/model-facing blocked tool result stays narrower.

## Audience resolution contract

For the current `message` vertical slice, audience resolution is intentionally deterministic and minimal:

- `turnSourceChannel` identifies the provider/channel family for the active conversation
- `turnSourceTo` identifies the routable current conversation target
- `turnSourceThreadId`, when present, narrows the audience to the current thread/topic rather than the channel root
- explicit tool-call routing is compared against that current audience after provider-aware target normalization
- if the runtime cannot resolve the current audience, untrusted outbound sends are denied rather than guessed

This contract is enough to distinguish:

- same-DM reply vs different-DM send
- same-channel reply vs different-channel send
- same-thread reply vs channel-root/thread-broadened send
- implicit current-chat send vs ambiguous unrouted send

## Enforcement order

Current order inside `runBeforeToolCallHook()`:

1. loop detection
2. built-in provenance-aware core policy
3. trusted plugin tool policies
4. plugin `before_tool_call` hooks
5. approval flows
6. diagnostics / blocked result shaping

This ordering ensures the deterministic built-in security decision happens before plugin-controlled adjustments while still preserving the existing policy and approval layers for allowed calls.

## Redaction and explanation boundaries

The provenance-aware audit trail intentionally does **not** record outbound content or raw audience identifiers.

- Consequential path names and coarse provenance state are recorded.
- Free-text provenance labels are passed through the same tool-payload redaction posture used for other safety-boundary diagnostics before they are emitted.
- User-visible/model-visible blocked tool results keep the simple denial reason and do not expose the richer operator audit attributes.

That split is intentional:

- operator-visible diagnostics answer why a decision happened and where to inspect it
- user/model-visible results explain the block without creating a new metadata leak path
