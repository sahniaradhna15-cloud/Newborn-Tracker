---
description: Implement fix from RCA document
argument-hint: [bug-identifier — github issue id or rca filename]
---

# Implement Fix: $ARGUMENTS

## Prerequisites

- RCA document must exist. Check both:
  - `.agents/rca/issue-$ARGUMENTS.md` (for GitHub issues)
  - `.agents/rca/$ARGUMENTS.md` (for manual bugs)
- Read `CLAUDE.md` for project coding standards

If no RCA document is found, **STOP** and tell the user:
**"RCA document not found. Run `/bug-fix/rca $ARGUMENTS` first to analyze the root cause."**

## Implementation Instructions

### 1. Read and Understand RCA

- Read the ENTIRE RCA document thoroughly
- If the bug originated from a GitHub issue, optionally view it for additional context:
  ```bash
  gh issue view [issue-id]
  ```
- Understand the root cause
- Review the proposed fix strategy
- Note all files to modify
- Review testing requirements

### 2. Verify Current State

Before making changes:
- Confirm the issue still exists in the current code
- Check current state of affected files
- Review any recent changes to those files since the RCA was written

### 3. Implement the Fix

Following the "Proposed Fix" section of the RCA:

**For each file to modify:**

#### a. Read the existing file
- Understand current implementation
- Locate the specific code mentioned in RCA

#### b. Make the fix
- Implement the change as described in RCA
- Follow the fix strategy exactly
- Maintain code style and conventions (per CLAUDE.md)
- Add structured logging with `fix_suggestion` for error paths
- Add comments if the fix is non-obvious

#### c. Handle related changes
- Update any related code affected by the fix
- Ensure consistency across the codebase
- Update imports if needed

### 4. Add/Update Tests

Following the "Testing Requirements" from RCA:

**Create test cases for:**
1. Verify the fix resolves the issue
2. Test edge cases related to the bug
3. Ensure no regression in related functionality
4. Test any new code paths introduced

**Test implementation:**
- Follow project's test structure and conventions
- Mirror the source file location
- Use verbose, descriptive test names

### 5. Run Validation

Execute validation commands from the RCA (or project defaults from CLAUDE.md):

```bash
# Linting
[project lint command]

# Type checking
[project type check command]

# Tests
[project test command]
```

If validation fails:
- Fix the issues
- Re-run validation
- Do not proceed until all pass

### 6. Verify Fix

- Follow reproduction steps from RCA
- Confirm issue no longer occurs
- Test edge cases
- Check for unintended side effects

## Output Report

### Fix Implementation Summary

**Bug:** [title from RCA]
**Source:** [GitHub Issue #X | Manual Report]
**Root Cause** (from RCA): [one-line summary]

### Changes Made

**Files Modified:**
1. **[file-path]**
   - Change: [what was changed]
   - Lines: [line numbers]

### Tests Added

**Test Files Created/Modified:**
1. **[test-file-path]**
   - Test cases: [list test functions added]

### Validation Results

```bash
# Linting output
[results]

# Type check output
[results]

# Test output
[results — all passing]
```

### Verification

- Followed reproduction steps — issue resolved
- Tested edge cases — all pass
- No new issues introduced
- Original functionality preserved

### Ready for Commit

All changes complete and validated. Ready for `/commit`.

**Suggested commit message:**
```
fix([scope]): [brief description of fix]

[Summary of what was fixed and how]

[If GitHub issue: Fixes #[issue-id]]
```

## Optional: Update GitHub Issue

If the bug was from a GitHub issue:

```bash
# Add implementation comment
gh issue comment [issue-id] --body "Fix implemented. Ready for review."
```

## Notes

- If the RCA analysis was incorrect, document findings and update the RCA before implementing
- If additional bugs are found during implementation, note them for separate RCAs
- If a fix introduces uncertainty, ask the user before proceeding
- Follow project coding standards exactly (CLAUDE.md)
- The commit message `Fixes #[id]` will auto-close the GitHub issue when merged
