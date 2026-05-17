---
description: Generate project-specific CLAUDE.md from planning artifacts
argument-hint: [optional-output-path]
---

# Create Global Rules: Generate Project-Specific CLAUDE.md

## Overview

Generate a project-specific `CLAUDE.md` file by combining the reference template (`CLAUDE_REF.md`) with insights from all planning artifacts (CMO thesis, CTO master plan, PRD). This tailors the global development rules to the specific project's needs.

## Inputs

**Required:** Read ALL of these before generating:

1. **Reference Template:** Read `CLAUDE_REF.md`
   - This is the base template with all global development rules

2. **CMO Thesis:** Read `documents/cmo-thesis.md`
   - Extract: target market, user type, product category

3. **CTO Master Plan:** Read `master-plan.md`
   - Extract: chosen backend (Convex vs Supabase), architecture decisions, specific tech stack choices

4. **PRD:** Read `PRD.md`
   - Extract: feature scope, API contracts, security requirements, data models

**If any input file is missing, STOP and tell the user which step to run first:**
- Missing `CLAUDE_REF.md`? → This should exist in the template repo
- Missing CMO thesis? → Run `/cmo` first
- Missing master plan? → Run `/cto` first
- Missing PRD? → Run `/create-prd` first

## Process

### 1. Analyze Project Needs

From CMO thesis:
- What type of product is this? (SaaS, marketplace, tool, etc.)
- Who are the users? (developers, consumers, enterprise, etc.)
- What is the core domain? (e-commerce, social, analytics, etc.)

From CTO master plan:
- Which backend was chosen? (Convex or Supabase)
- What specific architecture decisions were made?
- What integrations are needed?

From PRD:
- What are the key data models/entities?
- What API patterns are needed?
- What are the security requirements?

### 2. Customize Reference Rules

Starting from `CLAUDE_REF.md`, adapt each section:

**Tech Stack section:**
- Resolve Convex vs Supabase — remove the decision framework and state the chosen backend definitively
- Add any project-specific libraries identified in the CTO master plan
- Remove options that don't apply to this project

**Architecture section:**
- Adapt directory structure to match the CTO master plan's architecture
- Specify the concrete backend structure (Convex functions vs Supabase API routes)
- Add project-specific patterns

**API Contracts section:**
- Replace generic `Entity` examples with project-specific models from the PRD
- Include actual interfaces and types from the domain model

**Development Commands section:**
- Add project-specific commands (e.g., `convex dev` if using Convex, `supabase start` if using Supabase)
- Include any project-specific build or deploy commands

**Common Patterns section:**
- Replace generic examples with project-specific patterns
- Add patterns specific to the chosen backend
- Include domain-specific code examples

### 3. Add Project-Specific Sections

Add these new sections that don't exist in the reference template:

- **Project Overview** — From PRD executive summary (2-3 sentences)
- **Domain Model** — Key entities and their relationships from PRD
- **Project-Specific Naming Conventions** — Based on the domain (e.g., `order_id`, `product_name`)
- **Environment Variables** — Required env vars for the chosen stack
- **Project-Specific Testing Strategy** — Adapted from PRD and CTO plan

### 4. Maintain Core Principles (DO NOT CHANGE)

These MUST remain unchanged from `CLAUDE_REF.md`:
- Verbose naming convention
- Structured JSON logging with `fix_suggestion`
- TypeScript strict mode, no `any`
- JSDoc requirements for complex functions
- Biome linting/formatting (120 char, double quotes)
- Easy debugging principles (flat structures, async/await, match patterns)

## Output

Save to: `$ARGUMENTS`

If no argument provided, default to: `CLAUDE.md` at project root.

### Required Frontmatter

The generated CLAUDE.md must start with:
```yaml
---
description: Project-specific development rules for [Project Name]
alwaysApply: true
---
```

## Quality Checks

After generating, verify:
- All core principles from CLAUDE_REF.md are preserved
- Backend choice is resolved (no "Convex vs Supabase" — one is chosen)
- Architecture matches CTO master plan
- Domain models match PRD
- Code examples use project-specific entities, not generic `Entity`
- Environment variables are listed
- Development commands are project-specific

## Constraints

- **DOCUMENTATION ONLY** — no code generation
- Only create: the CLAUDE.md file
- Do NOT modify `CLAUDE_REF.md` (it is a template for reuse)
- Do NOT write any source code files
- Do NOT install packages or modify configurations

## Next Step

After completing the global rules, tell the user:
**"Project CLAUDE.md saved to `CLAUDE.md`. Next steps:**
- **Run `/create-reference-guide [url]` to store any reference articles or documentation**
- **Run `/plan-phase [phase-N]` to create detailed implementation plans for each phase"**
