---
description: Create detailed implementation plan for a specific phase from the master plan
argument-hint: [phase-number-or-name]
---

# Planning: Phase Implementation Plan

## Phase to Plan

$ARGUMENTS

## Inputs

**Required:** Read these documents before starting:

1. **Master Plan:** Read `master-plan.md`
   - Identify the phase specified by `$ARGUMENTS`
   - Extract: objective, deliverables, dependencies, risks, estimated scope, token budget for that phase

2. **PRD:** Read `PRD.md`
   - Cross-reference features and requirements relevant to this phase

3. **Project CLAUDE.md:** Read `CLAUDE.md` (if it exists)
   - Follow all coding standards, naming conventions, stack choices

**If any required file is missing, STOP and tell the user:**
- Missing `master-plan.md`? → Run `/planning/cto` first
- Missing `PRD.md`? → Run `/planning/create-prd` first
- Missing `CLAUDE.md`? → Run `/planning/create-global-rules` first (recommended but optional)

**If `$ARGUMENTS` does not match a valid phase from `master-plan.md`:**
- List all available phases from the master plan
- Ask the user which one to plan

## Task-Level Token Budget Check

Each **individual task** in the phase must be completable within **150K tokens** by a sub-agent (execute → code-review → fix → validate → report → commit cycle).

Before creating the plan:
- The phase must have **no more than 4 tasks**
- For each task, estimate scope: files to create/modify, endpoints, components, tables
- A single task should handle approximately:
  - ~3-5 files created/modified
  - ~1-3 API endpoints
  - ~2-4 UI components
  - ~1-2 database tables/schemas
  - ~0-1 third-party integrations
- If a task exceeds this, **break it into smaller tasks** (and add more phases if needed to stay within the 4-task limit)
- Each task must have **clear file boundaries** — which files it creates or modifies — so that code review can scope to only that task's changes
- Tasks must be **independently executable** by a sub-agent with a fresh context window

## Determine Phase Name

Based on the phase from the master plan, create a concise kebab-case phase name (e.g., "phase-1-user-authentication", "phase-2-payment-processing").

This will be used for the plan filename: `plans/[phase-name].md`

## Research Process

### 1. Analyze Existing Codebase Patterns

> **Greenfield projects:** If no application code exists yet (only planning documents), skip this step and proceed to Step 2 (Research External Documentation).

Search for similar implementations:
- Look for comparable features or components
- Identify relevant files and their structure
- Note patterns, conventions, and standards used
- Document reusable code or utilities

### 2. Research External Documentation

If needed, search for:
- Framework best practices
- Library documentation
- Design patterns
- Similar implementations

### 3. Design Implementation Approach

Determine:
- Which files need to be created or modified
- What models/schemas are required
- Which services or utilities are needed
- How this integrates with existing code
- What testing strategy to use

### 4. Break Down Into Tasks

Create detailed, actionable tasks with:
- Specific file paths
- Exact function/class names
- Clear acceptance criteria
- Validation commands

### 5. Identify Critical Decisions

Document 2-4 key architectural or design choices made during research:
- What alternatives were considered
- Why the chosen approach wins
- Any trade-offs accepted

## Output: Create Plan Document

Save plan as: `plans/[phase-name].md`

**CRITICAL**: Format this plan for ANOTHER AGENT to execute without seeing this conversation.
No extra scope. Only what is needed to implement this specific phase.

### Required Plan Structure

#### Header Block

```markdown
# Plan: [Phase Name]

> **Phase:** [N] of [Total] from master-plan.md
> **Tasks:** [N] (max 4)
> **Overall Progress: 0%**
> **Status:** Not Started
> **Task Token Budget:** Each task ≤ 150K tokens

## TLDR

[2-3 sentences max. What is being built in this phase, what is the core approach,
what is the expected end state. An agent reading only this section
should understand the purpose.]
```

#### 1. Critical Decisions

```markdown
## Critical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | [e.g., State management approach] | [e.g., Zustand over Context] | [1-line why] |
| 2 | [e.g., API pattern] | [e.g., Server Actions] | [1-line why] |
```

#### 2. Relevant Files

```markdown
## Relevant Files

| File | Action | Purpose |
|------|--------|---------|
| `src/components/Feature.tsx` | CREATE | Main component |
| `src/lib/featureService.ts` | CREATE | Business logic |
| `src/types/feature.ts` | CREATE | Type definitions |
| `src/app/api/feature/route.ts` | MODIFY | Add new endpoint |
```

#### 3. Dependencies

```markdown
## Dependencies

**New packages:**
- `package-name` - [why needed]

**Existing utilities to reuse:**
- `src/lib/logger.ts` - Structured logging
- [other existing code to leverage]

**Configuration changes:**
- [env vars, config files, etc.]
```

#### 4. Tasks

**CRITICAL: Maximum 4 tasks per phase.** Each task is executed by a separate sub-agent with a fresh context window (~150K tokens). Tasks run sequentially — later tasks can depend on earlier ones.

```markdown
## Tasks

### Task 1: [Task Name]

**Estimated scope:** ~N files, ~N endpoints/components
**Files touched:**
- `exact/path/to/file.ts` (CREATE)
- `exact/path/to/other.ts` (CREATE)
- `exact/path/to/existing.ts` (MODIFY)

**Subtasks:**
- [ ] Subtask with specific implementation detail
- [ ] Subtask with specific implementation detail
- [ ] Subtask with specific implementation detail

**Details:**
[Specific implementation guidance — types to define, functions to create,
patterns to follow. Include code snippets only when the approach is non-obvious.]

**Depends on:** None | Task N

**Definition of Done:**
- [What should be true when this task is complete]
- [e.g., "API endpoint returns correct response for all test cases"]
- [e.g., "Component renders with proper styling and handles edge cases"]

---

### Task 2: [Task Name]

**Estimated scope:** ~N files, ~N endpoints/components
**Files touched:**
- `exact/path/to/file.ts` (CREATE)

**Subtasks:**
- [ ] Subtask
- [ ] Subtask

**Details:**
[Implementation guidance]

**Depends on:** Task 1

**Definition of Done:**
- [Completion criteria]
```

#### 5. Testing Strategy

```markdown
## Testing Strategy

### Test 1: [Test Name]

**File**: `exact/path/to/test-file.test.ts` (create)

- [ ] Test case: what it verifies
- [ ] Test case: what it verifies
- [ ] Edge case test

**Approach**: [unit | integration | e2e]
```

#### 6. Validation Commands

```markdown
## Validation Commands

Run these in order after all tasks complete:

```bash
# Linting
[exact lint command]

# Type checking
[exact type check command]

# Tests
[exact test command]

# Build verification
[exact build command]
```
```

#### 7. Integration Notes

```markdown
## Integration Notes

- [How this connects to existing code]
- [How this connects to other phases]
- [Potential breaking changes: NONE or list them]
- [Migration steps if needed]
- [Documentation updates required]
```

## Confirmation

After creating the plan, confirm:
- Phase name created: [phase-name]
- Plan saved to `plans/[phase-name].md`
- TLDR is clear enough for a cold-start agent
- Critical decisions are documented with rationale
- **Maximum 4 tasks** in the phase
- All tasks have exact file paths, checkbox subtasks, and **Definition of Done**
- Each task has **clear file boundaries** (Files touched section)
- Each task fits within **150K token budget** for a sub-agent execution cycle
- Validation commands are exact and runnable
- No extra scope — only what this phase requires
- A sub-agent could execute any individual task without seeing the full conversation

## Constraints

**CRITICAL: THIS IS A PLANNING COMMAND — NO CODE IMPLEMENTATION**

- Do NOT write any application code
- Do NOT create source files (`.ts`, `.tsx`, `.js`, `.py`, etc.)
- Do NOT install packages or modify configurations
- ONLY create: `plans/[phase-name].md`
- Code snippets in the plan are for GUIDANCE only (show patterns, not implementations)
- Implementation happens ONLY during the execution phase

**ALL phases should be planned before ANY execution begins.**
Run this command for each phase in the master plan before starting implementation.

## Next Step

After completing the plan for this phase, tell the user:
**"Phase plan saved to `plans/[phase-name].md`."**

If more phases remain in the master plan:
**"Run `/planning/plan-phase [next-phase]` to plan the next phase."**

If all phases are planned:
**"All phases planned. Planning is complete. You may now begin implementation."**
