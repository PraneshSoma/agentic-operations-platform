# Contributing

How to improve the agent bodies, add to the fleet, or adapt the framework for
your team's context.

---

## The single-source rule

Everything lives in `loop/agents/` and `loop/config/loop.config.json`. The
`loop/modes/` directory is generated output — never edit it directly. After any
change to `agents/` or `config/`, run:

```bash
node loop/tools/generate.mjs
```

Both the Copilot and Claude Code modes update automatically.

---

## Improving an agent body

Open the relevant file in `loop/agents/`, make your change, and regenerate. The
most impactful improvements are usually:

**Adding a rule to `codegen.md`**
If a story produced code that violated a convention the agent didn't know about,
add it to Section 3 (Coding Rules) with a CORRECT / WRONG example, and add the
corresponding checkbox to Section 6 (Self-Validation). This prevents the same
failure on every future story.

**Sharpening the critical-invariant test in `testgen.md`**
If self-heal fired on the same failure more than once, it usually means the
critical-invariant test isn't specific enough. Make it more precise and add the
failure mode explicitly.

**Tightening context in `planning.md`**
If planning_context outputs are missing fields that downstream agents need, extend
the output shape in Section 3.

---

## Adding a new story type

1. Add a new subsection to `codegen.md` Section 2 naming the story type, the
   files it produces, and the path + rules for each.
2. Add the corresponding test requirements to `testgen.md` Section 2.
3. Add the extraction rules to `planning.md` Section 2.
4. Regenerate.

---

## Adjusting the agent fleet

The fleet is defined in `loop/tools/generate.mjs` (the `AGENTS`, `DESC`, `TOOLS`,
and `PHASE` objects). To add a new agent:

1. Create `loop/agents/<name>.md` following the existing body structure.
2. Add `"<name>": "<tier>"` to `agent_tiers` in `loop/config/loop.config.json`.
3. Add an entry to `per_agent_tokens` in `budgets`.
4. Add `"<name>": true` to `hil`.
5. Add the agent to `AGENTS`, `DESC`, `TOOLS`, and `PHASE` in `generate.mjs`.
6. Regenerate.

---

## Changing model tiers

Edit `agent_tiers` in config — `"strong"`, `"mid"`, or `"cheap"` — and update
`tier_resolution` if you want to change which concrete model each tier resolves
to. Regenerate. Both modes update.

```jsonc
"tier_resolution": {
  "copilot": {
    "strong": { "model": "claude-opus-4.6", "fallback": "gpt-5.1" },
    "mid":    { "model": "claude-sonnet-4.6", "fallback": "gpt-5.1-mini" },
    "cheap":  { "model": "claude-haiku-4.5", "fallback": "gemini-3-flash" }
  },
  "agnostic": {
    "strong": { "model": "claude-opus-4.6", "fallback": "claude-sonnet-4.6" },
    "mid":    { "model": "claude-sonnet-4.6", "fallback": "claude-haiku-4.5" },
    "cheap":  { "model": "claude-haiku-4.5", "fallback": "claude-sonnet-4.6" }
  }
}
```

The agnostic runtime stays within one provider family (the Claude family when
using Claude Code). The Copilot runtime can route each agent to a different
provider.

---

## Sharing improvements back

If you adapt the agent bodies here and find improvements that would benefit
other consumers of the framework — better agent bodies, new story types,
additional guardrails — consider contributing them back to
[agentic-sdlc-loop](https://github.com/PraneshSoma/agentic-sdlc-loop) upstream.
