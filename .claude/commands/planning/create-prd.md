---
description: Create a Product Requirements Document from CMO thesis and CTO master plan
argument-hint: [output-filename]
---

# Create PRD: Generate Product Requirements Document

## Overview

Generate a comprehensive Product Requirements Document (PRD) based on the CMO thesis, CTO master plan, and any additional conversation context.

## Inputs

**Required:** Read ALL of these before generating the PRD:

1. **CMO Thesis:** Read `documents/cmo-thesis.md`
   - Extract: market research, target users, competitive analysis, MVP feature recommendations, go-to-market wedge

2. **CTO Master Plan:** Read `master-plan.md`
   - Extract: architecture decisions, phasing, tech stack, deliverables, token budget estimates

3. **Conversation context** (if any additional requirements discussed)

**If either input file is missing, STOP and tell the user which step to run first:**
- Missing CMO thesis? → Run `/cmo` first
- Missing master plan? → Run `/cto` first

## Output File

Write the PRD to: `$ARGUMENTS`

If no argument provided, default to: `PRD.md` at project root.

## PRD Structure

Create a well-structured PRD with the following sections. Adapt depth and detail based on available information:

### Required Sections

**1. Executive Summary**
- Concise product overview (2-3 paragraphs)
- Core value proposition (from CMO thesis verdict)
- MVP goal statement

**2. Mission**
- Product mission statement
- Core principles (3-5 key principles)

**3. Target Users**
- Primary user personas (from CMO thesis Target Users section)
- Technical comfort level
- Key user needs and pain points

**4. MVP Scope**
- **In Scope:** Core functionality for MVP (use checkboxes) — derived from CMO thesis MVP Feature Recommendations
- **Out of Scope:** Features deferred to future phases (use checkboxes)
- Group by categories (Core Functionality, Technical, Integration, Deployment)

**5. User Stories**
- Primary user stories (5-8 stories) in format: "As a [user], I want to [action], so that [benefit]"
- Include concrete examples for each story
- Add technical user stories if relevant

**6. Core Architecture & Patterns**
- High-level architecture approach (from CTO master plan Tech Stack section)
- Directory structure (from CTO master plan)
- Key design patterns and principles
- Technology-specific patterns

**7. Tools/Features**
- Detailed feature specifications
- If building an agent: Tool designs with purpose, operations, and key features
- If building an app: Core feature breakdown

**8. Technology Stack**
- Backend/Frontend technologies with versions (from CTO master plan, NOT invented fresh)
- Dependencies and libraries
- Optional dependencies
- Third-party integrations

**9. Security & Configuration**
- Authentication/authorization approach
- Configuration management (environment variables, settings)
- Security scope (in-scope and out-of-scope)
- Deployment considerations

**10. API Specification** (if applicable)
- Endpoint definitions
- Request/response formats
- Authentication requirements
- Example payloads

**11. Success Criteria**
- MVP success definition (tie back to CMO thesis verdict)
- Functional requirements (use checkboxes)
- Quality indicators
- User experience goals

**12. Implementation Phases**
- Cross-reference with CTO master plan phases for consistency
- Each phase includes: Goal, Deliverables (checkboxes), Validation criteria
- Include token budget estimates from CTO master plan
- Realistic timeline estimates

**13. Future Considerations**
- Post-MVP enhancements (from CMO thesis deferred features)
- Integration opportunities
- Advanced features for later phases

**14. Risks & Mitigations**
- 3-5 key risks with specific mitigation strategies (combine CMO market risks + CTO technical risks)

**15. Appendix** (if applicable)
- Related documents: `documents/cmo-thesis.md`, `master-plan.md`
- Key dependencies with links
- Repository/project structure

## Instructions

### 1. Extract Requirements
- Review the CMO thesis and CTO master plan thoroughly
- Identify explicit requirements and implicit needs
- Note technical constraints and preferences
- Capture user goals and success criteria

### 2. Synthesize Information
- Organize requirements into appropriate sections
- Fill in reasonable assumptions where details are missing
- Maintain consistency across sections
- Ensure technical feasibility aligns with CTO master plan

### 3. Write the PRD
- Use clear, professional language
- Include concrete examples and specifics
- Use markdown formatting (headings, lists, code blocks, checkboxes)
- Add code snippets for technical sections where helpful
- Keep Executive Summary concise but comprehensive

### 4. Quality Checks
- All required sections present
- User stories have clear benefits
- MVP scope is realistic and well-defined
- Technology choices match CTO master plan (not invented fresh)
- Implementation phases match CTO master plan phases
- Success criteria are measurable
- Consistent terminology throughout

## Style Guidelines

- **Tone:** Professional, clear, action-oriented
- **Format:** Use markdown extensively (headings, lists, code blocks, tables)
- **Specificity:** Prefer concrete examples over abstract descriptions
- **Length:** Comprehensive but scannable

## Constraints

- **DOCUMENTATION ONLY** — no code generation
- Only create: the PRD file (`$ARGUMENTS` or `PRD.md`)
- Do NOT write any source code files
- Do NOT install packages or modify configurations
- The PRD is a planning artifact, not an implementation

## Output Confirmation

After creating the PRD:
1. Confirm the file path where it was written
2. Provide a brief summary of the PRD contents
3. Highlight any assumptions made due to missing information
4. Suggest next steps

## Next Step

After completing the PRD, tell the user:
**"PRD saved to `PRD.md`. Next step: Run `/create-global-rules` to generate project-specific coding rules (CLAUDE.md)."**
