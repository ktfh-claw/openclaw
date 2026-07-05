---
title: Tool Classification Metadata
description: Minimal tool source, consequence, and egress metadata used by provenance-aware enforcement work.
permalink: /security/tool-classification-metadata/
---

# Tool Classification Metadata

Issue `#4` adds a minimal classification substrate for provenance-aware enforcement planning.

The current contract annotates selected tools with three kinds of facts:

- `consequential`: the tool can perform a meaningful action such as host execution, remote control, remote file access, or network egress
- `untrustedContentSource`: the tool can return content that should be treated as untrusted-derived input for later enforcement
- `egressArguments`: argument paths that can carry destination, content, command, or locator data into an outbound or consequential action

First milestone coverage:

- `message`
- `web_fetch`
- `web_search`
- `browser`
- `exec`
- `file_fetch`
- `gateway`

This contract is intentionally narrow. It does not enforce policy by itself. It only provides validated runtime metadata that later issues can consume at tool boundaries.
