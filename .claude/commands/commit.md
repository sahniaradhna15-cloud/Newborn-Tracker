---
description: Create an atomic git commit with appropriate conventional tag
argument-hint: (none)
---

# Commit: Atomic Git Commit

## Prerequisites

Before committing, read `CLAUDE.md` (or `CLAUDE_REF.md`) for any project-specific commit conventions.

## Process

### 1. Review Changes

Run these commands to understand what will be committed:

```bash
git status
git diff HEAD
git status --porcelain
```

Review:
- What files are modified?
- What files are untracked (new)?
- Are there any files that should NOT be committed? (e.g., `.env`, credentials, large binaries)

### 2. Stage Files

Add relevant files to staging:

```bash
git add [specific-files]
```

**Do NOT blindly run `git add -A` or `git add .`** — review each file first. Exclude:
- Environment files (`.env`, `.env.local`)
- Credentials or secrets
- Build artifacts (`dist/`, `build/`, `.next/`)
- Large binary files
- Temporary or log files

### 3. Determine Commit Tag

Use conventional commit format. Choose the tag that best describes the change:

| Tag | When to Use |
|-----|-------------|
| `feat` | New feature or functionality |
| `fix` | Bug fix |
| `docs` | Documentation only changes |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding or updating tests |
| `chore` | Build process, dependencies, or tooling changes |
| `style` | Formatting, whitespace, linting fixes (no logic change) |
| `perf` | Performance improvement |

### 4. Write Commit Message

Format:
```
tag(scope): concise description of what changed

[Optional body — explain WHY, not WHAT. The diff shows what changed.]

[Optional footer — references to issues, breaking changes]
```

Rules:
- First line under 72 characters
- Use imperative mood: "add feature" not "added feature"
- Scope is optional but helpful (e.g., `feat(auth):`, `fix(api):`)
- Body explains motivation, not implementation details
- Reference issues with `Fixes #123` or `Relates to #456`

### 5. Create the Commit

```bash
git commit -m "tag(scope): description"
```

### 6. Verify

```bash
git log --oneline -1
git status
```

Confirm:
- Commit message is correct
- No unintended files were committed
- Working directory is clean (or only expected files remain)

## Examples

```bash
# New feature
git commit -m "feat(auth): add JWT token refresh endpoint"

# Bug fix referencing an issue
git commit -m "fix(api): handle null response from payment gateway

Fixes #42"

# Documentation
git commit -m "docs: update README with execution pipeline workflow"

# Refactor
git commit -m "refactor(services): extract validation logic into shared utility"

# Phase completion
git commit -m "feat(phase-1): complete user authentication phase

Implements login, registration, and token management.
See plans/phase-1-auth.md for full scope."
```

## Notes

- Create ONE commit per logical change — don't bundle unrelated changes
- If implementing a full phase via `/execution/run-phase`, commit after the pipeline completes successfully
- If fixing a bug via `/bug-fix/implement-fix`, use `fix` tag and reference the issue
- Do NOT commit if validation is failing — fix issues first
- Do NOT amend published commits without explicit user approval
