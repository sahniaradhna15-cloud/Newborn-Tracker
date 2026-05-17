---
description: Prime agent with codebase understanding before execution
argument-hint: (none)
---

# Prime: Load Project Context

## Objective

Build comprehensive understanding of the codebase by analyzing structure, documentation, and key files. This must be done before any execution begins — the agent needs full context to implement correctly.

## Process

### 1. Analyze Project Structure

List all tracked files:

```bash
git ls-files
```

Show directory structure:
On Linux, run: `tree -L 3 -I 'node_modules|__pycache__|.git|dist|build'`

### 2. Read Core Documentation

- Read CLAUDE.md or similar global rules file
- Read README files at project root and major directories
- Read any architecture documentation
- Read `master-plan.md` if it exists — understand overall project direction
- Read relevant phase plans in `plans/` directory

### 3. Identify Key Files

Based on the structure, identify and read:
- Main entry points (main.py, index.ts, app.py, etc.)
- Core configuration files (pyproject.toml, package.json, tsconfig.json)
- Key model/schema definitions
- Important service or controller files

### 4. Read Reference Guides

Check `reference/` directory for any collected guides:
- API docs, patterns, guides, articles
- These contain pre-researched patterns the implementation should follow

### 5. Understand Current State

Check recent activity:

```bash
git log -10 --oneline
```

Check current branch and status:

```bash
git status
```

## Output Report

Provide a concise summary covering:

### Project Overview
- Purpose and type of application
- Primary technologies and frameworks
- Current version/state

### Architecture
- Overall structure and organization
- Key architectural patterns identified
- Important directories and their purposes

### Tech Stack
- Languages and versions
- Frameworks and major libraries
- Build tools and package managers
- Testing frameworks

### Core Principles
- Code style and conventions observed
- Documentation standards
- Testing approach

### Reference Guides Available
- List any guides found in `reference/` and their relevance

### Current State
- Active branch
- Recent changes or development focus
- Any immediate observations or concerns

**Make this summary easy to scan — use bullet points and clear headers.**
