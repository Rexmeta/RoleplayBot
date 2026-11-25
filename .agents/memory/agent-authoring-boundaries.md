---
name: Agent authoring boundaries
description: Rules for AI agents creating scenarios/personas/rubrics through the Agent API
---
Agent keys with write scopes (`scenarios:write`, `personas:write`, `rubrics:write`) only create private, unapproved drafts and never publish, approve or set defaults.
**Why:** the operator asked for agents to act on their behalf while humans keep publish/approve control.
**How to apply:** new authoring endpoints must use `requireAuthoring(scope)` and the draft/audit/idempotency helpers in the authoring service; out-of-scope existing content returns 404, out-of-scope creation returns 403; never add direct paid media calls.
