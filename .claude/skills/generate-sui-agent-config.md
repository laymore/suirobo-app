---
name: generate-sui-agent-config
description: >
  Generate a CLAUDE.md or AGENT.md file tailored to a Sui project. Use when
  setting up a new Sui project for AI agent development or when a project is
  missing agent configuration files.
---

# Generate Sui Agent Config

Generate a `CLAUDE.md` or `AGENT.md` file in the project root when:
- User explicitly requests agent configuration
- Setting up a new Sui project without existing config
- Project is missing agent setup files

## Required Sections

Every generated file must include:

### 1. Sui Development Skills

```markdown
## Sui Development Skills

Install community tools:
\`\`\`bash
suiup install mvr
\`\`\`
```

### 2. Sui SDK Reference (if TypeScript/JS is used)

```markdown
## Sui SDK Reference

For TypeScript/JavaScript, find version-matched docs at:
\`node_modules/@mysten/sui/docs/llms-index.md\`
```

### 3. Official Resources

```markdown
## Official Resources

- Move Book: https://move-book.com
- Sui Docs: https://docs.sui.io
- Examples: https://github.com/MystenLabs/sui/tree/main/examples
```

## Optional Additions

Include project-specific sections for:
- Directory structure descriptions
- Custom development conventions

## Standards

- Place in project root as `CLAUDE.md` by default
- Keep concise — avoid duplicating information already provided by installed skills
- Do not modify the skills installation command or SDK documentation paths

## Sources

- https://docs.sui.io
