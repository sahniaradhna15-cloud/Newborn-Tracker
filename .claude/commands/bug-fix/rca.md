---
description: Root cause analysis for a bug (GitHub issue, manual report, or observed behavior)
argument-hint: [github-issue-id OR bug-description]
---

# Root Cause Analysis: $ARGUMENTS

## Objective

Investigate the bug described by `$ARGUMENTS`, identify the root cause, and document findings for implementation.

## Determine Bug Source

**If `$ARGUMENTS` is a GitHub issue ID (numeric):**

```bash
gh issue view $ARGUMENTS
```

Extract: title, description, labels, comments, reporter.

**If `$ARGUMENTS` is a description or reference:**

- Use the description directly as the bug report
- Ask the user for reproduction steps if not provided
- Search conversation context for additional details

## Investigation Process

### 1. Understand the Bug

Gather all available information:

- What is the expected behavior?
- What is the actual behavior?
- What are the symptoms?
- When did it start? (check recent commits)
- Is it reproducible? How?

If any of this is unclear, **ask the user** before proceeding.

### 2. Search Codebase

Identify relevant code:

- Search for components mentioned in the bug report
- Find related functions, classes, or modules
- Check similar implementations
- Look for patterns or recent changes

Search for:
- Error messages from the bug report
- Related function names
- Component identifiers
- Recent changes to affected areas

### 3. Review Recent History

Check recent changes to affected areas:

```bash
git log --oneline -20 -- [relevant-paths]
```

Look for:
- Recent modifications to affected code
- Related bug fixes
- Refactorings that might have introduced the issue

### 4. Investigate Root Cause

Analyze the code to determine:

- What is the actual bug?
- Why is it happening?
- What was the original intent?
- Is this a logic error, edge case, or missing validation?
- Are there related issues or symptoms?

Consider:
- Input validation failures
- Edge cases not handled
- Race conditions or timing issues
- Incorrect assumptions
- Missing error handling
- Integration issues between components

### 5. Assess Impact

Determine:
- How widespread is this issue?
- What features are affected?
- Are there workarounds?
- What is the severity? (Critical / High / Medium / Low)
- Could this cause data corruption or security issues?

### 6. Propose Fix Approach

Design the solution:
- What needs to be changed?
- Which files will be modified?
- What is the fix strategy?
- Are there alternative approaches?
- What testing is needed?
- Are there any risks or side effects?

## Output: Create RCA Document

Save analysis as: `.agents/rca/[bug-identifier].md`

- For GitHub issues: `.agents/rca/issue-[id].md`
- For manual bugs: `.agents/rca/[descriptive-kebab-case-name].md`

### Required RCA Document Structure

```markdown
# Root Cause Analysis: [Bug Title]

## Bug Summary

- **Source**: [GitHub Issue #X | Manual Report | Observed Behavior]
- **Title**: [Bug title]
- **Severity**: [Critical/High/Medium/Low]
- **Reporter**: [who reported it]
- **Date**: [date of RCA]

## Problem Description

[Clear description of the issue]

**Expected Behavior:**
[What should happen]

**Actual Behavior:**
[What actually happens]

**Symptoms:**
- [List observable symptoms]

## Reproduction

**Steps to Reproduce:**
1. [Step 1]
2. [Step 2]
3. [Observe issue]

**Reproduction Verified:** [Yes/No]

## Root Cause

### Affected Components

- **Files**: [List of affected files with paths]
- **Functions/Classes**: [Specific code locations]
- **Dependencies**: [Any external deps involved]

### Analysis

[Detailed explanation of the root cause]

**Why This Occurs:**
[Explanation of the underlying issue]

**Code Location:**
[File path:line number with relevant code snippet showing the issue]

### Related Issues

- [Any related issues or patterns]

## Impact Assessment

**Scope:** [How widespread]
**Affected Features:** [List]
**Severity Justification:** [Why this severity level]
**Data/Security Concerns:** [Any implications]

## Proposed Fix

### Fix Strategy

[High-level approach to fixing]

### Files to Modify

1. **[file-path]**
   - Changes: [What needs to change]
   - Reason: [Why this change fixes it]

### Alternative Approaches

[Other possible solutions and why the proposed approach is better]

### Risks and Considerations

- [Any risks with this fix]
- [Side effects to watch for]
- [Breaking changes if any]

### Testing Requirements

**Test Cases Needed:**
1. [Test case 1 — verify fix works]
2. [Test case 2 — verify no regression]
3. [Test case 3 — edge cases]

**Validation Commands:**
[Exact commands to verify fix — use project-specific commands from CLAUDE.md]
```

## Constraints

- **ANALYSIS ONLY** — do not implement any code changes
- Only create: `.agents/rca/[bug-identifier].md`
- Do NOT modify any source code
- Do NOT install packages or change configuration
- Implementation happens via `/bug-fix/implement-fix`

## Next Steps

After completing the RCA, tell the user:
**"RCA saved to `.agents/rca/[bug-identifier].md`. Next step: Run `/bug-fix/implement-fix [bug-identifier]` to implement the fix."**
