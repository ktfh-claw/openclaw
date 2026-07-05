# Provenance-Aware Tool Enforcement

The first deterministic provenance-aware enforcement seam lives in:

- `src/agents/agent-tools.before-tool-call.ts`

At this seam OpenClaw now evaluates, before tool execution:

- tool classification metadata from issue `#4`
- current-turn enforcement metadata projected from input provenance
- whether the pending tool call is a consequential outbound action
- the resolved current audience for the active turn (`turnSourceChannel`, `turnSourceTo`, optional thread id)
- whether the call carries outbound content and whether its routing stays within that audience

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
