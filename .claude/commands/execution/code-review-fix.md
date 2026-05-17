---
description: Fix issues found in code review
argument-hint: [path-to-code-review-file]
---

# Code Review Fix

## Inputs

Code review file (or description of issues): `$ARGUMENTS`

If `$ARGUMENTS` is a file path, read the entire file first to understand all issues.

## Process

### 1. Understand All Issues

- Read the code review file completely
- Sort issues by severity: critical → high → medium → low
- Identify any dependencies between fixes (e.g., fixing one issue may resolve another)

### 2. Fix Issues One by One

For each issue, starting with the highest severity:

1. **Explain** what was wrong and why it matters
2. **Show** the fix — make the code change
3. **Verify** the fix doesn't break anything (check related code, run relevant tests)

### 3. Handle Edge Cases

- If a suggested fix conflicts with project standards (CLAUDE.md), follow the project standards
- If a fix introduces a new design decision, ask the user before proceeding
- If a fix is unclear or the issue seems like a false positive, ask the user

### 4. Validate After All Fixes

After all issues are fixed, run project validation:

```bash
# Linting
[project lint command from CLAUDE.md]

# Type checking
[project type check command from CLAUDE.md]

# Tests
[project test command from CLAUDE.md]
```

If validation fails, fix the failures before completing.

## Output

Provide a summary:

### Fixes Applied
For each fix:
- **Issue:** [from code review]
- **Severity:** [critical|high|medium|low]
- **File:** [path]
- **Fix:** [what was changed]
- **Verified:** [yes/no]

### Skipped Issues
- [Any issues not fixed and why]

### Validation Results
```bash
# Output from validation commands
```

### Ready for Next Step
- If running standalone: Ready for `/validate` or `/commit`
- If running as part of pipeline: Proceed to validation
