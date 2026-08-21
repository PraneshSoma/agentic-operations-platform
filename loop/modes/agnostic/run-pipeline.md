# /run-pipeline (agnostic)

Reads CLAUDE.md, core/supervisor.md, core/models.json, config/loop.config.json,
then loops stories with HIL gates, budgets, self-heal, and stage-scoped
Composite Context packets.

  /run-pipeline req=AOP-001
  /run-pipeline resume

Commands: APPROVE | REVISE <feedback> | SKIP | PAUSE | HALT | STATUS
