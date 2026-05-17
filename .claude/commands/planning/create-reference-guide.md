---
description: Create reference guides from articles, docs, or external sources
argument-hint: [url-or-topic]
---

# Create Reference Guide

## Purpose

Fetch, process, and store reference material (articles, documentation, Substack posts, API docs, design patterns) in a structured format. These guides are used by AI agents during implementation to follow best practices, understand APIs, and apply correct patterns.

## Inputs

- `$ARGUMENTS`: A URL to fetch, a topic to research, or pasted content in conversation
- Optionally: conversation context with additional details or pasted text

## Process

### If argument is a URL:
1. Fetch the URL content
2. Extract the key information, code patterns, and actionable guidance
3. Remove ads, navigation, and irrelevant content
4. Structure into a clean reference document
5. Preserve all code examples and technical details

### If argument is a topic:
1. Use web search to find authoritative sources (official docs, well-known blogs, Substack)
2. Synthesize findings from multiple sources
3. Create a comprehensive reference document
4. Cite all sources with URLs

### If content is pasted in conversation:
1. Parse and structure the pasted content
2. Extract key patterns and guidance
3. Organize into the standard reference format

### For all reference guides:
1. Determine a kebab-case filename from the content topic
2. Categorize into one of: `api-docs`, `patterns`, `guides`, `articles`
3. Extract actionable patterns and code examples
4. Note version/date sensitivity (e.g., "as of Next.js 15")
5. Identify which project phases or features this applies to

## Output

Save to: `reference/[category]/[topic-name].md`

Categories:
- `reference/api-docs/` — API documentation, SDK guides, endpoint references
- `reference/patterns/` — Design patterns, architecture patterns, best practices
- `reference/guides/` — How-to guides, tutorials, setup instructions
- `reference/articles/` — Blog posts, Substack articles, opinion pieces

### Required Output Structure

```markdown
# Reference: [Topic Name]

> **Source:** [URL or "Synthesized from multiple sources"]
> **Date fetched:** [YYYY-MM-DD]
> **Relevance:** [Which project phases/features this applies to]
> **Category:** [api-docs | patterns | guides | articles]

## Summary
[2-3 sentence overview of what this reference covers and why it matters]

## Key Concepts
- [Bulleted list of core ideas and takeaways]

## Patterns & Examples
[Code snippets, architecture patterns, configuration examples.
Preserve all technical detail from the source.]

## Gotchas & Warnings
[Common mistakes, version-specific issues, deprecation notices, known bugs]

## Action Items
[How to apply this to our project — specific, actionable steps]

## Sources
- [URL 1 — description]
- [URL 2 — description]
```

## Constraints

- **DOCUMENTATION ONLY** — no code generation, no package installation
- Only create files in the `reference/` directory
- Preserve original source attribution — always cite URLs
- Note when content may become outdated (include version numbers, dates)
- Do NOT modify any source code or project configuration
- Do NOT execute any code examples — just document them

## Notes

- This command can be run multiple times to build up a reference library
- Reference guides are used by AI agents during `/execute` to follow correct patterns
- Prioritize official documentation over blog posts when both are available
- Include version numbers for all libraries and frameworks mentioned
- If a reference guide for the same topic already exists, update it rather than creating a duplicate

## Next Step

After creating the reference guide, tell the user:
**"Reference guide saved to `reference/[category]/[topic-name].md`."**

If more reference material is needed:
**"Run `/planning/create-reference-guide [url-or-topic]` to add more guides."**

If all reference material is collected:
**"Run `/planning/plan-phase [phase-N]` to create detailed implementation plans for each phase."**
