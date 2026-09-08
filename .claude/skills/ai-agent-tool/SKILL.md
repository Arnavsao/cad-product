---
name: ai-agent-tool
description: Add or change a tool the AI drafting assistant can call (src/app/features/cad-editor/features/ai-agent) — the AiTool validate/compile/describe contract, riskClass and permissions, registration in AiToolRegistryService, and the rule that compile() is pure and returns ICommand[]. Use when asked to let the assistant do something new, to fix an assistant action that mutates state wrongly, or to touch the LLM gateway / action router.
---

# AI assistant tools

The assistant (Ollama locally or OpenRouter, called from the browser by `LlmGatewayService`) never touches the document directly. It emits a `CadAction`, `ActionRouterService` looks up the tool, runs `validate`, then `compile`, wraps the returned commands in a `CompoundCmd` and pushes it on the normal undo stack. That is what makes every assistant edit undoable and previewable.

## The contract — `models/ai-tool.model.ts`

```ts
export function makeMyTool(): AiTool<MyParams> {
  return {
    id: 'entities.myVerb',            // '<category>.<verb>'
    title: 'My Verb',
    description: '…what the LLM reads to decide when to call it…',
    category: 'entity',               // selection | entity | layer | view | layout | library | annotation | navigation
    permissions: ['mutate:entities'],
    validate(action, ctx) { /* → { ok, confidence, affectedIds, riskClass, errors, warnings } */ },
    compile(action, ctx)  { /* → ICommand[]  — PURE */ },
    describe(action, affectedIds) { /* past tense, one sentence */ },
  };
}
```

Rules that the router relies on:

- **`compile` must not mutate anything.** No `ctx.doc.*` writes, no `vm.markDirty()`, no entity field assignment. Build command objects (`ModifyEntitiesCmd`, `DeleteMultipleCmd`, `AddEntityCmd`, …) and return them. The router executes them.
- Resolve targets with `ctx.resolveTarget(action.target)`; skip entities on locked layers (`ctx.doc.activeFile.layers.get(e.layer)?.locked`) and say so in `warnings`.
- `riskClass`: `'safe'` (view/selection), `'review'` (reversible edits the user should glance at), `'destructive'` (delete, replace). Destructive actions always confirm.
- Return `ok: false` with an `errors[]` entry (`code`, `severity: 'error'`, `message`) rather than throwing. `TARGET_EMPTY` is the standard code for "nothing matched".
- `category: 'selection'` bypasses history automatically; set `noHistory: true` only for other read-only tools.

Look at `tools/entities-delete.tool.ts` (destructive) and `tools/entities-change-layer.tool.ts` (review) before writing a new one.

## Register

Import the factory in `services/ai-tool-registry.service.ts` and add it to the `allTools` array in the constructor. Nothing else discovers tools.

## Context available to tools

`AiToolContext`: `doc`, `vm`, `spatial` (spatial index for hit/region queries), `library`, `viewDetection`, `layoutReport`, `hooks` (markDirty), `resolveTarget`. If a tool needs another service, add it to the context in the registry rather than injecting inside the tool; tools are plain functions so they stay testable.

## Audit

`AiAuditService` logs every action to IndexedDB, local only. Do not add network calls there; the log is the user's drafting history, not telemetry.

## Tests

`views-intelligent-layout.spec.ts` shows the shape: construct the tool, call `validate`/`compile` with a hand-built context and assert on the returned commands, not on side effects. Note that `ai-preview.spec.ts` and `cad-context.spec.ts` are known-failing under the zoneless TestBed; do not count them against your change (see the verify skill).
