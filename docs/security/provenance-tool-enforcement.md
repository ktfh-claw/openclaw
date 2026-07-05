# Provenance-Aware Tool Enforcement

The first deterministic provenance-aware enforcement seam lives in:

- `src/agents/agent-tools.before-tool-call.ts`

At this seam OpenClaw now evaluates, before tool execution:

- tool classification metadata from issue `#4`
- current-turn enforcement metadata projected from input provenance
- whether the pending tool call is a consequential outbound action
- whether the call carries explicit destination routing and outbound content

## Initial enforced rule

The first narrow built-in rule family is intentionally small:

- block `message` tool calls when the active request is marked `provenance.trust = "untrusted"`
- only block when the `message` call is a mutating outbound action
- only block when the payload includes outbound content and an explicit external routing field such as `target`, `targets`, `channel`, or `channelId`
- allow same-session replies that do not specify an explicit external destination

This keeps the rule focused on direct untrusted-content-to-explicit-egress flows without breaking the existing current-session reply path.

## Enforcement order

Current order inside `runBeforeToolCallHook()`:

1. loop detection
2. built-in provenance-aware core policy
3. trusted plugin tool policies
4. plugin `before_tool_call` hooks
5. approval flows
6. diagnostics / blocked result shaping

This ordering ensures the deterministic built-in security decision happens before plugin-controlled adjustments while still preserving the existing policy and approval layers for allowed calls.
