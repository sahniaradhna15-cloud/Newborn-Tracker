---
description: Run full execution pipeline for a phase — orchestrates sub-agents for each task sequentially
argument-hint: [path-to-plan]
---

# Run Phase: Sub-Agent Orchestrator

## Plan to Execute

`$ARGUMENTS`

## Overview

This command is a **lightweight orchestrator**. It does NOT execute tasks itself. Instead, it:

1. Reads the plan and primes context (once)
2. For each task in the plan — spawns a **sub-agent** that handles the full execution cycle
3. Tracks progress per-task for resilience
4. After all tasks — spawns a sub-agent for system review

Each sub-agent gets a **fresh context window** (~150K tokens), keeping the orchestrator's context minimal. Tasks run **sequentially** to prevent conflicts.

## Step 0: Prime — Load Project Context

Before spawning any sub-agents, build understanding of the codebase yourself.

Follow the full process in `execution/prime.md`:
- Analyze project structure (files, directories)
- Read CLAUDE.md, README, architecture docs, master plan
- Identify and read key files (entry points, configs, models, services)
- Read reference guides in `reference/` directory
- Check recent git activity and current state

**After priming:**
- Confirm you have a clear understanding of the project
- If anything is unclear, ask the user before proceeding

---

## Step 1: Read Plan and Identify Tasks

1. Read the plan file at `$ARGUMENTS`
2. Extract the list of tasks (there should be 1-4 tasks)
3. Note each task's name, file boundaries, dependencies, and definition of done
4. Derive `[feature-name]` from the plan filename (e.g., `plans/phase-1-auth.md` → `phase-1-auth`)

---

## Step 2: Check Progress File

Look for an existing progress file at `plans/[feature-name]-progress.md`.

- If it exists, read it and **skip completed tasks** — resume from the first incomplete task
- If it does not exist, create it:

```markdown
# Phase Progress: [feature-name]

**Plan:** $ARGUMENTS
**Started:** [current date]

## Task Progress

- [ ] Task 1: [task name] — PENDING
- [ ] Task 2: [task name] — PENDING
- [ ] Task 3: [task name] — PENDING
- [ ] Task 4: [task name] — PENDING
```

---

## Step 3: Execute Tasks Sequentially via Sub-Agents

For each task (in order, skipping completed ones):

### 3a. Update Progress File

Mark the current task as `IN PROGRESS` in the progress file.

### 3b. Spawn Sub-Agent for Task

Use the **Task tool** to spawn a `general-purpose` sub-agent with the following prompt structure:

```
You are executing Task [N] of phase [feature-name].

## Your Mission

Execute this single task, then run the full quality cycle: implement → code-review → fix → validate → report → commit.

## Context

- **Plan file:** [path to plan — $ARGUMENTS]
- **Task number:** [N]
- **Task name:** [name from plan]
- **Project standards:** Read `CLAUDE.md` (or `CLAUDE_REF.md` if no project-specific rules exist)

## Step 1: Read and Understand

1. Read the plan file at [plan path]
2. Read `CLAUDE.md` for project standards
3. Focus on Task [N] — understand its subtasks, file boundaries, dependencies, and definition of done
4. If this task depends on earlier tasks, read the relevant files they created/modified to understand current state

## Step 2: Execute the Task

Follow the process in `.claude/commands/execution/execute.md` but ONLY for Task [N]:
- Implement all subtasks for this task
- Only touch files listed in this task's "Files touched" section
- Follow project conventions (CLAUDE.md)
- Verify as you go (syntax, imports, types)

## Step 3: Code Review

Follow the process in `.claude/commands/execution/code-review.md`:
- Review ONLY the changes you just made (use `git diff` to see uncommitted changes)
- Analyze for: logic errors, security issues, performance, code quality, standards adherence
- If issues are found, note their severity

## Step 4: Code Review Fix

If the code review found critical or high severity issues:
- Follow the process in `.claude/commands/execution/code-review-fix.md`
- Fix issues starting with highest severity
- Verify each fix

If no issues were found, skip this step.

## Step 5: Validate

Follow the process in `.claude/commands/execution/validate.md`:
- Run linting, type checking, tests, and build
- If validation fails, attempt to fix and re-run
- If still failing after 2 attempts, report the failures

## Step 6: Execution Report

Follow the process in `.claude/commands/execution/execution-report.md`:
- Generate a report for this task specifically
- Save to: `.agents/execution-reports/[feature-name]-task-[N].md`
- Include: what was implemented, divergences, challenges, validation results

## Step 7: Commit

Create an atomic git commit for this task's changes:
- Stage only the files changed by this task
- Use conventional commit format: `feat([scope]): [description of task]`
- Include task number in commit body

## Final Output

Report back with:
1. **Status:** SUCCESS or FAILURE
2. **Task:** [N] - [name]
3. **Files created:** [list]
4. **Files modified:** [list]
5. **Code review:** [passed clean / N issues found and fixed]
6. **Validation:** [PASS / FAIL with details]
7. **Commit:** [commit hash]
8. **Issues/Concerns:** [any problems encountered]
```

### 3c. Process Sub-Agent Result

After the sub-agent completes:

1. Read the sub-agent's result
2. Update the progress file:
   - If SUCCESS: Mark task as `COMPLETED` with commit hash
   - If FAILURE: Mark task as `FAILED` with details
3. If the task FAILED:
   - Report the failure to the user
   - Ask: "Task [N] failed. [details]. Would you like to retry, skip, or stop the pipeline?"
   - Do NOT proceed to the next task until the user decides

### 3d. Move to Next Task

Repeat 3a-3c for the next task.

---

## Step 4: System Review via Sub-Agent

After ALL tasks are completed successfully, spawn a final sub-agent for system review:

```
You are performing a system review for phase [feature-name].

## Your Mission

Analyze how well the implementation followed the plan across ALL tasks. This is a process review, not a code review.

## Inputs

1. Read the plan file: [plan path — $ARGUMENTS]
2. Read the plan command: `.claude/commands/planning/plan-phase.md`
3. Read the execute command: `.claude/commands/execution/execute.md`
4. Read ALL per-task execution reports:
   - `.agents/execution-reports/[feature-name]-task-1.md`
   - `.agents/execution-reports/[feature-name]-task-2.md`
   - [... for all tasks in the phase]

## Process

Follow `.claude/commands/execution/system-review.md`:
- Analyze plan adherence across all tasks
- Classify divergences as good or bad
- Look for patterns across tasks (did the same issue recur?)
- Trace root causes of problematic divergences
- Generate process improvement suggestions

## Output

Save to: `.agents/system-reviews/[feature-name].md`
```

---

## Step 5: Update Progress and Report

After the system review completes:

1. Update progress file — mark phase as `COMPLETE`:

```markdown
## Phase Status: COMPLETE

**Completed:** [current date]

## Task Progress

- [x] Task 1: [task name] — COMPLETED (commit: [hash])
- [x] Task 2: [task name] — COMPLETED (commit: [hash])
- [x] Task 3: [task name] — COMPLETED (commit: [hash])
- [x] Task 4: [task name] — COMPLETED (commit: [hash])
```

2. Provide final summary to the user:

```
## Phase Complete: [feature-name]

**Plan:** $ARGUMENTS

### Task Results
| Task | Status | Commit |
|------|--------|--------|
| Task 1: [name] | COMPLETED | [hash] |
| Task 2: [name] | COMPLETED | [hash] |
| Task 3: [name] | COMPLETED | [hash] |
| Task 4: [name] | COMPLETED | [hash] |

### Artifacts Created
- Progress: `plans/[feature-name]-progress.md`
- Task reports: `.agents/execution-reports/[feature-name]-task-*.md`
- System review: `.agents/system-reviews/[feature-name].md`

### Next Steps
- Review the system review for process improvements
- If more phases remain, run `/execution/run-phase plans/[next-phase].md`
```

---

## Error Handling

- **Sub-agent failure:** If a sub-agent fails or returns an error, report to user and ask how to proceed
- **Task failure:** Do NOT skip failed tasks automatically — always ask the user
- **Progress file corruption:** If the progress file is inconsistent, re-read the plan and git log to determine actual state
- **Repeated failures:** If the same task fails 2+ times, stop and escalate to the user
- **Partial completion:** The progress file ensures re-running `run-phase` picks up where it left off

## Important Notes

- **You are an orchestrator** — your job is to spawn sub-agents and track progress, not to write code yourself
- **Keep your context small** — don't read file contents unnecessarily; let sub-agents handle the details
- **Sequential only** — never spawn multiple task sub-agents in parallel; they must run one at a time
- **Trust the progress file** — if it says a task is complete, skip it unless the user says otherwise
