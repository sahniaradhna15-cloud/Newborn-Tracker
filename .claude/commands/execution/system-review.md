---
description: Analyze implementation against plan for process improvements
argument-hint: [plan-file] [execution-report-file]
---

# System Review

Perform a meta-level analysis of how well the implementation followed the plan and identify process improvements.

## Purpose

**System review is NOT code review.** You're not looking for bugs in the code — you're looking for bugs in the process.

**Your job:**

- Analyze plan adherence and divergence patterns
- Identify which divergences were justified vs problematic
- Surface process improvements that prevent future issues
- Suggest updates to CLAUDE.md, plan templates, and commands

**Philosophy:**

- Good divergence reveals plan limitations — improve planning
- Bad divergence reveals unclear requirements — improve communication
- Repeated issues reveal missing automation — create commands

## Inputs

Read these artifacts:

1. **Plan Command:** Read `.claude/commands/planning/plan-phase.md` to understand planning instructions
2. **Generated Plan:** Read `$ARGUMENTS` (first argument) — what the agent was SUPPOSED to do
3. **Execute Command:** Read `.claude/commands/execution/execute.md` to understand execution instructions
4. **ALL Per-Task Execution Reports:** Read every task report for this phase in `.agents/execution-reports/`:
   - Look for files matching `[feature-name]-task-*.md` (e.g., `phase-1-auth-task-1.md`, `phase-1-auth-task-2.md`, etc.)
   - If no per-task reports exist, fall back to a single report (second argument or find latest in `.agents/execution-reports/`)
   - Read ALL matching reports — the system review must analyze the ENTIRE phase across all tasks

If arguments are not provided, search for the most recent plan in `plans/` and most recent reports in `.agents/execution-reports/`.

## Analysis Workflow

### Step 1: Understand the Planned Approach

Read the generated plan and extract:

- What features were planned?
- What architecture was specified?
- What validation steps were defined?
- What patterns were referenced?

### Step 2: Understand the Actual Implementation

Read ALL per-task execution reports and extract:

- What was implemented in each task?
- What diverged from the plan in each task?
- What challenges were encountered?
- What was skipped and why?
- Were there patterns across tasks? (e.g., same type of divergence recurring)

### Step 3: Classify Each Divergence

For each divergence identified in the execution report, classify as:

**Good Divergence** (Justified):

- Plan assumed something that didn't exist in the codebase
- Better pattern discovered during implementation
- Performance optimization needed
- Security issue discovered that required different approach

**Bad Divergence** (Problematic):

- Ignored explicit constraints in plan
- Created new architecture instead of following existing patterns
- Took shortcuts that introduce tech debt
- Misunderstood requirements

### Step 4: Trace Root Causes

For each problematic divergence, identify the root cause:

- Was the plan unclear? Where, why?
- Was context missing? Where, why?
- Was validation missing? Where, why?
- Was a manual step repeated? Where, why?

### Step 5: Generate Process Improvements

Based on patterns across divergences, suggest:

- **CLAUDE.md updates:** Universal patterns or anti-patterns to document
- **Plan command updates:** Instructions that need clarification or missing steps
- **New commands:** Manual processes that should be automated
- **Validation additions:** Checks that would catch issues earlier

## Output Format

Save to: `.agents/system-reviews/[feature-name].md`

### Report Structure

#### Meta Information

- **Plan reviewed:** [path]
- **Task execution reports reviewed:** [list all per-task report paths]
- **Total tasks in phase:** [N]
- **Date:** [current date]

#### Overall Alignment Score: __/10

Scoring guide:

- 10: Perfect adherence, all divergences justified
- 7-9: Minor justified divergences
- 4-6: Mix of justified and problematic divergences
- 1-3: Major problematic divergences

#### Divergence Analysis

For each divergence from the execution report:

```yaml
divergence: [what changed]
planned: [what plan specified]
actual: [what was implemented]
reason: [agent's stated reason from report]
classification: good | bad
justified: yes/no
root_cause: [unclear plan | missing context | etc]
```

#### Cross-Task Patterns

Analyze patterns that emerged across all tasks in the phase:

- **Recurring divergences:** Did the same type of divergence happen in multiple tasks? Why?
- **Escalating issues:** Did problems in earlier tasks compound in later tasks?
- **Consistency:** Were coding patterns and standards applied consistently across all tasks?
- **Task boundary effectiveness:** Were the task boundaries (file scopes) well-defined? Did sub-agents stay within boundaries?
- **Definition of Done accuracy:** Were the definitions of done in the plan realistic and verifiable?

#### Pattern Compliance

Assess adherence to documented patterns:

- [ ] Followed codebase architecture
- [ ] Used documented patterns (from CLAUDE.md)
- [ ] Applied testing patterns correctly
- [ ] Met validation requirements

#### System Improvement Actions

Based on analysis, recommend specific actions:

**Update CLAUDE.md:**

- [ ] Document [pattern X] discovered during implementation
- [ ] Add anti-pattern warning for [Y]
- [ ] Clarify [technology constraint Z]

**Update Plan Command:**

- [ ] Add instruction for [missing step]
- [ ] Clarify [ambiguous instruction]
- [ ] Add validation requirement for [X]

**Create New Command:**

- [ ] `/[command-name]` for [manual process repeated 3+ times]

**Update Execute Command:**

- [ ] Add [validation step] to execution checklist

#### Key Learnings

**What worked well:**
- [specific things that went smoothly]

**What needs improvement:**
- [specific process gaps identified]

**For next implementation:**
- [concrete improvements to try]

## Important

- **Be specific:** Don't say "plan was unclear" — say "plan didn't specify which auth pattern to use"
- **Focus on patterns:** One-off issues aren't actionable. Look for repeated problems.
- **Action-oriented:** Every finding should have a concrete asset update suggestion
- **Suggest improvements:** Don't just analyze — actually suggest the text to add to CLAUDE.md or commands
