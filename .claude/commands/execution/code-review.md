---
description: Technical code review for quality and bugs
argument-hint: (none)
---

# Code Review: Technical Quality Analysis

Perform a technical code review on recently changed files. When running as part of the `run-phase` pipeline, this reviews only the **current task's changes** (uncommitted changes since the last commit). When running standalone, it reviews all recent changes.

## Core Principles

Review Philosophy:

- Simplicity is the ultimate sophistication — every line should justify its existence
- Code is read far more often than it's written — optimize for readability
- The best code is often the code you don't write
- Elegance emerges from clarity of intent and economy of expression

## What to Review

### 1. Gather Context

Start by examining project standards:

- Read `CLAUDE.md` (or `CLAUDE_REF.md` if no project-specific rules exist)
- Read `README.md`
- Scan key directories to understand existing patterns
- **If a plan file is available** (check `plans/` directory or pipeline context), read it to verify the implementation matches what was intended. This helps catch missing features, not just bugs.

### 2. Identify Changes

Determine the scope of changes to review:

**When running as part of `run-phase` (per-task review):**
Review only uncommitted changes (this task's work since the last commit):

```bash
git status
git diff
git diff --cached
git diff --stat
```

**When running standalone:**
Review all changes since the last meaningful commit:

```bash
git status
git diff HEAD
git diff --stat HEAD
```

In both cases, also check for new untracked files:

```bash
git ls-files --others --exclude-standard
```

### 3. Deep Review

Read each changed/new file **in its entirety** (not just the diff) to understand full context.

For each file, analyze for:

**Logic Errors**
- Off-by-one errors
- Incorrect conditionals
- Missing error handling
- Race conditions
- Null/undefined safety

**Security Issues**
- Injection vulnerabilities (SQL, XSS, command injection)
- Insecure data handling
- Exposed secrets or API keys
- Missing input validation at system boundaries

**Performance Problems**
- N+1 queries
- Inefficient algorithms
- Memory leaks
- Unnecessary computations or re-renders

**Code Quality**
- Violations of DRY principle
- Overly complex functions
- Poor or non-verbose naming (per CLAUDE.md standards)
- Missing type hints/annotations
- Missing structured logging with `fix_suggestion` in error paths

**Adherence to Project Standards**
- Naming conventions (verbose, intention-revealing)
- Linting and formatting standards
- Logging standards (structured JSON, snake_case events)
- Testing standards
- Architecture patterns (per CLAUDE.md)

## Verify Issues Are Real

- Run specific tests for issues found
- Confirm type errors are legitimate
- Validate security concerns with context
- Do not flag style preferences — only real bugs and standards violations

## Output Format

Save to: `.agents/code-reviews/[feature-name].md` (standalone) or `.agents/code-reviews/[feature-name]-task-[N].md` (when running per-task in `run-phase`)

**Stats:**

- Files Modified: [count]
- Files Added: [count]
- Files Deleted: [count]
- Lines Added: [count]
- Lines Removed: [count]

**For each issue found:**

```
severity: critical|high|medium|low
file: path/to/file.ts
line: 42
issue: [one-line description]
detail: [explanation of why this is a problem]
suggestion: [how to fix it]
```

If no issues found: "Code review passed. No technical issues detected."

## Important

- Be specific (file paths, line numbers — not vague complaints)
- Focus on real bugs and standards violations, not style preferences
- Suggest fixes, don't just complain
- Flag security issues as CRITICAL
- Flag missing error handling with `fix_suggestion` as HIGH
