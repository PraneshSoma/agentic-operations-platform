---
mode: agent
description: Run the AOP-001 agentic pipeline via the supervisor agent.
model: claude-opus-4.6
tools: ['edit','search','runCommands','runTasks']
---

# /run-pipeline

Activate the **supervisor** agent and run its loop. Reads
`config/loop.config.json`, builds the story queue, and runs
planning -> codegen -> testgen -> rfc per story with HIL gates, budget
enforcement, and self-heal.

Usage:
  /run-pipeline req=AOP-001
  /run-pipeline req=AOP-001 story=A-01
  /run-pipeline resume
  /run-pipeline req=AOP-001 --max-story-tokens=150000 --spend-cap=8

Commands during the loop: APPROVE | REVISE <feedback> | SKIP | PAUSE | HALT | STATUS
