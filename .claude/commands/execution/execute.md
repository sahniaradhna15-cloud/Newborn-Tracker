---
description: Execute a single task from an implementation plan
argument-hint: [path-to-plan] [task-number (optional)]
---

# Execute: Implement a Single Task from Plan

## Plan to Execute

Read plan file: `$ARGUMENTS`

If `$ARGUMENTS` contains a task number (e.g., `plans/phase-1-auth.md 2`), execute ONLY that specific task. If no task number is provided, execute ALL tasks in order (legacy mode for standalone use).

## Prerequisites

Before starting, read these project files for context:
- `CLAUDE.md` — project-specific coding standards and conventions
- The plan file at `$ARGUMENTS` — the implementation blueprint

If `CLAUDE.md` does not exist, check `CLAUDE_REF.md` for general standards.

## Execution Instructions

### 1. Read and Understand

- Read the ENTIRE plan carefully (for context, even if executing a single task)
- If executing a single task, focus on that task's subtasks, file boundaries, and definition of done
- Check task dependencies — if this task depends on earlier tasks, read the files they created/modified
- Review the validation commands
- Identify any ambiguities — ask the user before proceeding if unclear

### 2. Execute the Task

For the specified task (or each task if running all):

#### a. Navigate to the task
- Identify the files and actions required (CREATE or MODIFY)
- Only touch files listed in the task's "Files touched" section
- Read existing related files if modifying

#### b. Implement the task
- Follow the detailed specifications exactly
- Maintain consistency with existing code patterns
- Include proper type hints and documentation
- Add structured logging where appropriate (per CLAUDE.md standards)
- Use verbose naming conventions (e.g., `entity_id`, not `id`)

#### c. Verify as you go
- After each file change, check syntax
- Ensure imports are correct
- Verify types are properly defined
- Confirm no regressions in related files

### 3. Implement Testing Strategy

After completing implementation subtasks:

- Create test files specified in the plan for this task (if any)
- Implement relevant test cases
- Follow the testing approach outlined
- Ensure tests cover edge cases
- Use verbose test names (e.g., `test_get_entities_returns_expected_list`)

### 4. Run Validation Commands

Execute ALL validation commands from the plan in order:

```bash
# Run each command exactly as specified in plan
```

If any command fails:
- Fix the issue
- Re-run the command
- Continue only when it passes

### 5. Verify Definition of Done

Check each item in the task's "Definition of Done" section:
- Confirm all criteria are met
- If any criteria cannot be met, document why

### 6. Final Verification

Before completing:

- All subtasks for this task completed
- Only files in this task's boundary were touched
- Tests created and passing (if applicable)
- All validation commands pass
- Code follows project conventions (CLAUDE.md)
- Structured logging included where appropriate

## Output Report

Provide summary:

### Task Completed
- Task number and name
- Files created (with paths)
- Files modified (with paths)

### Tests Added
- Test files created
- Test cases implemented
- Test results

### Validation Results
```bash
# Output from each validation command
```

### Divergences from Plan
- List anything done differently from the plan and why
- These will be needed for the execution report later

### Definition of Done Status
- [Checklist of definition of done items with pass/fail]

### Ready for Next Step
- Confirm all changes are complete
- Confirm all validations pass
- If running standalone: Ready for `/commit`
- If running as part of pipeline: Proceed to code review

## Notes

- If you encounter issues not addressed in the plan, document them
- If you need to deviate from the plan, explain why
- If tests fail, fix implementation until they pass
- Do not skip validation steps
- When in doubt, ask the user
- **Stay within task boundaries** — do not touch files outside this task's scope
