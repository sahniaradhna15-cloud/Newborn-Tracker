---
description: Generate implementation report for a task or phase
argument-hint: [feature-name] or [feature-name]-task-[N]
---

# Execution Report

Review and deeply analyze the implementation you just completed.

## Context

You have just finished implementing a task (when running as part of `run-phase`) or a full phase (standalone). Before moving on, reflect on:

- What you implemented
- How it aligns with the plan
- What challenges you encountered
- What diverged and why

## Inputs

Read these before generating the report:

1. **The plan that guided implementation** — check `plans/` directory for the most recently used plan
2. **Current changes** — run `git diff` for uncommitted changes or `git diff HEAD` if already committed
3. **CLAUDE.md** — to verify standards adherence

## Generate Report

**Per-task report (when running in `run-phase` pipeline):**
Save to: `.agents/execution-reports/[feature-name]-task-[N].md`

**Full phase report (standalone use):**
Save to: `.agents/execution-reports/[feature-name].md`

If `$ARGUMENTS` is provided, use it as the report name. Otherwise, derive from the plan filename (e.g., `plans/phase-1-auth.md` → `phase-1-auth`).

### Required Report Structure

#### Meta Information

- **Plan file:** [path to plan that guided this implementation]
- **Task:** [N] of [Total] — [task name] (omit if full-phase report)
- **Date:** [current date]
- **Files added:** [list with paths]
- **Files modified:** [list with paths]
- **Lines changed:** +X -Y

#### Validation Results

- Linting: PASS/FAIL [details if failed]
- Type Checking: PASS/FAIL [details if failed]
- Tests: PASS/FAIL [X passed, Y failed]
- Build: PASS/FAIL [details if failed]

#### What Went Well

List specific things that worked smoothly:

- [concrete examples]

#### Challenges Encountered

List specific difficulties:

- [what was difficult and why]

#### Divergences from Plan

For each divergence, document:

**[Divergence Title]**

- **Planned:** [what the plan specified]
- **Actual:** [what was implemented instead]
- **Reason:** [why this divergence occurred]
- **Type:** [Better approach found | Plan assumption wrong | Security concern | Performance issue | Other]

#### Definition of Done Status (per-task reports only)

For each item in the task's Definition of Done:
- [x] [criterion] — MET
- [ ] [criterion] — NOT MET (reason)

#### Skipped Items

List anything from the plan that was not implemented:

- [what was skipped]
- **Reason:** [why it was skipped]

#### Recommendations

Based on this implementation, what should change for next time?

- **Plan command improvements:** [suggestions]
- **Execute command improvements:** [suggestions]
- **CLAUDE.md additions:** [suggestions]
- **New patterns discovered:** [patterns worth documenting]
