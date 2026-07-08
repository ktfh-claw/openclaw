---
summary: Minimal provenance and audience metadata for enforcement-relevant content.
title: Provenance-aware enforcement metadata
read_when:
  - Designing or reviewing provenance-aware policy work
  - Preserving content trust or audience metadata across runtime boundaries
permalink: /security/provenance-enforcement-metadata/
---

This page defines the **minimum shared metadata contract** OpenClaw uses for
enforcement-relevant content under the current personal-assistant trust model.

It is intentionally narrow:

- enough to carry coarse trust state for content
- enough to carry a narrow audience marker when later sink checks need one
- small enough to survive ordinary transcript, replay, and transport handling

It is **not** a general information-flow lattice for all local state.

## Scope and trust model

This contract assumes the trust boundary documented in [Gateway security](/gateway/security):

- one trusted operator boundary per gateway/runtime
- installed plugins and skills are trusted code inside that boundary
- workspace memory and local config are trusted local state
- the current scoped security program focuses on **untrusted external influence**
  and **deterministic checks before consequential actions**

That means this contract is for content that may later drive:

- tool-call argument checks
- tool-result propagation checks
- replay/history preservation for policy inputs
- outbound messaging or other egress checks

It does **not** try to model same-process secret isolation or a hidden-value runtime.

## Contract

```ts
type EnforcementMetadata = {
  version: 1;
  provenance?: {
    trust: "unknown" | "trusted" | "untrusted";
    sourceKind?:
      | "external_user"
      | "external_hook"
      | "inter_session"
      | "tool_result"
      | "internal_system"
      | "unknown";
    sourceLabel?: string;
  };
  audience?: {
    scope: "current_session" | "named";
    label?: string;
  };
};
```

## Field meaning

### `version`

- Current contract version is `1`.
- First-party normalization treats an omitted version as version `1`.
- Unsupported versions should be treated as unavailable metadata until a boundary-specific upgrader exists.

### `provenance.trust`

- `untrusted`: the content is externally derived or otherwise influenced by untrusted content.
- `trusted`: the content is first-party runtime content inside the documented trust boundary.
- `unknown`: the runtime knows the content is enforcement-relevant but does not have enough evidence to claim trusted or untrusted.

`untrusted` is intentionally **sticky** for this first version. If a payload mixes trusted and untrusted inputs, the preserved coarse state should remain `untrusted`.

### `provenance.sourceKind`

This is optional coarse source classification for diagnostics and later policy inputs.

- `external_user`: direct externally supplied user/channel content
- `external_hook`: async hook/webhook content
- `inter_session`: content routed from another OpenClaw session/tool boundary
- `tool_result`: content derived from a tool result
- `internal_system`: first-party runtime/system content
- `unknown`: source family intentionally preserved but not classifiable more narrowly

### `provenance.sourceLabel`

- Optional bounded label for a concrete source such as a channel name, hook family, tool name, or session key.
- It is descriptive metadata, not a policy decision.
- First-party normalization trims whitespace and bounds the value to 256 characters.

### `audience`

This field is intentionally narrow and optional.

- `scope: "current_session"` means the content is only meant for the current session/conversation boundary unless a later policy explicitly allows broader routing.
- `scope: "named"` means the content is bound to a specifically identified resolved audience. `label` carries the stable route identity when known.

This is **not** a broad secrecy lattice. It is just enough structure for later egress checks to compare content audience intent against resolved outbound targets.

## Meaning of missing or partial metadata

- Missing `enforcementMetadata` means **metadata unavailable**, not "safe" and not "public".
- Missing `provenance` means trust is unknown to the current carrier.
- Missing `audience` means no audience restriction was preserved on that carrier. It does **not** prove unrestricted egress is acceptable.
- Partial metadata is valid. For example, a replayed summary may preserve only `provenance.trust: "untrusted"` and drop the original `sourceLabel`.

Downstream enforcement should treat missing information conservatively. Issue `#3` defines the shared shape, not the final allow/deny policy.

## Attachment points

The contract is designed to attach beside content, not inside the visible text body.

Planned attachment points for the scoped enforcement program:

- inbound user or external content records
- replay and transcript message items
- tool-call argument carriers
- tool-result carriers
- intermediate runtime history carriers
- outbound sink payloads when content-level audience matters

For the first implementation slice, OpenClaw wires the contract into persisted user-turn message handling and provides conservative projections from existing session and hook provenance structures.

## Coexistence with existing provenance structures

OpenClaw already has older provenance surfaces such as:

- `InputProvenance` on session/user-turn messages
- `HookExternalContentSource` for async hook jobs

Those structures remain authoritative for their original purposes.

`enforcementMetadata` does **not** replace them wholesale. Instead:

- it provides a shared, content-centric contract that other runtimes can preserve without needing each legacy source type
- existing provenance can be projected into this contract conservatively
- both may coexist on the same carrier during the migration period

That keeps issue `#3` compatible with current transcript and replay handling while giving later issues a stable substrate.

## Serialization and downgrade expectations

- The canonical on-wire form is plain JSON-compatible data.
- First-party normalization trims labels, rejects malformed enum values, and rejects unsupported versions.
- Boundaries that cannot preserve the full object may keep the coarsest still-correct subset, usually `provenance.trust`.
- Boundaries that drop the contract entirely should degrade to "metadata unavailable", not synthesize `trusted`.

## OpenClaw-owned transport carriers

Issue `#9` keeps transport propagation deliberately narrow. OpenClaw currently
preserves this contract across these first-party boundary carriers:

- OpenResponses request items may include `enforcement_metadata` on `message`
  and `function_call_output` items. The Gateway normalizes and merges those
  carriers conservatively into the active ingress turn before local policy runs.
- OpenClaw's MCP loopback server may emit the normalized contract in
  `CallToolResult._meta["openclaw/enforcementMetadata"]` when the underlying
  gateway tool result already carried valid `enforcementMetadata`.

This distinction matters:

- first-party OpenClaw boundaries should preserve metadata faithfully when they
  already own a validated carrier
- cooperative external clients may preserve and replay the same object
- arbitrary third-party components are **not** trusted merely because they send
  a similar-looking field

For that reason, OpenClaw treats missing transport metadata as "unavailable"
rather than inventing a trusted default, and it keeps third-party self-asserted
labels outside the current trust claim unless a specific boundary explicitly
opts into that trust.

## Replay and compaction rules

Issue `#6` adds the first replay/history retention rules for this contract.

- Persisted user-turn transcript rows should keep `enforcementMetadata` beside the original content.
- Replay-time normalization may reshape user content, strip old inbound routing metadata, or collapse text-only arrays, but it should preserve the coarse enforcement meaning of any retained message.
- Historical replay intended for the model may diverge from the durable transcript: OpenClaw can add a compact model-visible provenance prefix for replayed untrusted content without mutating the stored transcript row.
- When compaction summarizes older history away, the resulting `compactionSummary` may carry preserved `enforcementMetadata` in `details` even though the model-visible summary text is a synthesized replacement.
- Context pruning/history limiting may drop old raw messages, but the remaining in-context carriers should still preserve enough coarse truth for later policy to recover whether untrusted influence is still present.

## Minimum retained semantics for policy

The minimum semantics later policy must still be able to recover are:

- whether the active in-context content is still influenced by untrusted input
- the coarsest still-correct trust value, with `untrusted` remaining sticky
- a coarse source family when it survives replay (`external_user`, `tool_result`, etc.)
- an optional descriptive source label when preserved without lying

This means later policy evaluation can treat:

- direct replayed user messages with `enforcementMetadata`
- replay-safe summary carriers such as `compactionSummary.details.enforcementMetadata`

as equivalent coarse policy inputs, even when the raw historical text has been summarized or normalized for prompt assembly.

## What this enables next

This contract is the substrate for:

- issue `#4` tool and argument classification
- issue `#5` deterministic source-to-sink evaluation
- issue `#6` replay/history preservation
- issue `#9` OpenClaw-owned transport propagation
- issue `#10` audience-aware outbound messaging checks
- issue `#11` diagnostics and audit explanation
- issue `#12` regression scenarios that assert preservation and policy outcomes
