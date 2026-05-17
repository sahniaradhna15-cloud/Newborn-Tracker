---
description: Run comprehensive project validation (tests, types, lint, build)
argument-hint: (none)
---

# Validate: Comprehensive Project Validation

Run comprehensive validation of the project to ensure all tests, type checks, linting, and builds are working correctly.

## Prerequisites

Read `CLAUDE.md` (or `CLAUDE_REF.md`) to identify the project's exact validation commands. The commands below are templates — use the actual commands defined in the project.

**Important:** Skip any validation step that isn't configured for this project. If no test suite, linter, type checker, or build command exists, note it as SKIPPED and move on. Do not attempt to run non-existent commands.

## Validation Steps

Execute the following in sequence and report results:

### 1. Linting & Formatting

```bash
# Run the project's lint command (e.g., Biome, ESLint, Ruff)
# Example: npx biome check . --apply
[Use exact command from CLAUDE.md or package.json]
```

**Expected:** All checks pass, no violations

### 2. Type Checking

```bash
# Run the project's type checker (e.g., tsc, mypy, pyright)
# Example: npx tsc --noEmit
[Use exact command from CLAUDE.md or tsconfig.json]
```

**Expected:** No type errors

### 3. Test Suite

```bash
# Run the project's test suite (e.g., Vitest, Jest, pytest)
# Example: npm test
[Use exact command from CLAUDE.md or package.json]
```

**Expected:** All tests pass

### 4. Build Verification

```bash
# Run the project's build command (e.g., next build, tsc)
# Example: npm run build
[Use exact command from CLAUDE.md or package.json]
```

**Expected:** Build completes without errors

### 5. Local Server Validation (if applicable)

Only if the project has a runnable server:

```bash
# Start the server in background
[project dev/start command] &

# Wait for startup
sleep 3

# Test key endpoints
curl -s http://localhost:[port]/ | head -20

# Stop the server
kill %1 2>/dev/null || true
```

**Expected:** Server starts and responds correctly

## Summary Report

After all validations complete, provide:

```
## Validation Summary

| Check | Status | Details |
|-------|--------|---------|
| Linting | PASS/FAIL | [details if failed] |
| Type Checking | PASS/FAIL | [details if failed] |
| Tests | PASS/FAIL | [X passed, Y failed] |
| Build | PASS/FAIL | [details if failed] |
| Server | PASS/FAIL/SKIPPED | [details if applicable] |

**Overall: PASS / FAIL**
```

## Failure Handling

If any check fails:
- Document the exact error
- Attempt to fix the issue
- Re-run the failed check
- If it still fails after 2 attempts, report the failure with details and ask the user

## Notes

- Adapt all commands to the project's actual stack (check `package.json`, `pyproject.toml`, `CLAUDE.md`)
- If no test suite exists yet, note it and skip that step
- If no build command exists, skip that step
- Always run checks in the order listed (lint → types → tests → build) since earlier checks catch simpler issues faster
