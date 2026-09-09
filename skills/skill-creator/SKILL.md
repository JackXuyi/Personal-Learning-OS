---
name: skill-creator
description: Guide for creating effective skills. This skill should be used when users want to create a new skill (or update an existing skill) that extends Claude's capabilities with specialized knowledge, workflows, or tool integrations.
license: Complete terms in LICENSE.txt
---

# Skill Creator

Guidance for creating effective skills.

## About Skills

Skills are modular, self-contained packages that extend Claude's capabilities: specialized workflows, tool integrations, domain expertise, bundled resources (scripts, references, assets).

**Anatomy:** skill-name/ with required SKILL.md (YAML frontmatter: name, description; markdown instructions) and optional scripts/, references/, assets/.

**Progressive disclosure:** Metadata always in context; SKILL.md when skill triggers; bundled resources loaded as needed.

## Skill Creation Process

### Step 1: Understanding with Concrete Examples

Understand how the skill will be used. Ask what functionality, examples, and trigger phrases. Conclude when the functionality is clear.

### Step 2: Planning Reusable Contents

For each example: (1) how to execute from scratch, (2) what scripts, references, assets would help when repeated. Produce a list of reusable resources to include.

### Step 3: Initializing the Skill

When creating from scratch, run: `scripts/init_skill.py --path <path>`. This creates the directory, SKILL.md template, scripts/, references/, assets/ with examples. Customize or remove generated files.

### Step 4: Edit the Skill

Start with reusable contents (scripts, references, assets); may require user input. Delete unneeded example files. Update SKILL.md: write in imperative/infinitive form. Answer: purpose, when to use, how Claude should use it (reference all reusable contents).

### Step 5: Packaging

Run `scripts/package_skill.py <path>` (optional `./dist`). Script validates (frontmatter, naming, description, file organization) then packages to zip. Fix validation errors and re-run if needed.

### Step 6: Iterate

Use skill on real tasks; notice struggles; update SKILL.md or resources; test again.

## Metadata Quality

name and description determine when Claude uses the skill. Be specific; use third-person (e.g. "This skill should be used when...").

## Bundled Resources

- **scripts/**: Executable code for deterministic or repeated tasks (e.g. rotate_pdf.py). Token efficient; may run without loading into context.
- **references/**: Docs to load as needed (schemas, API docs, policies). Keeps SKILL.md lean; for large files include grep patterns; avoid duplicating with SKILL.md.
- **assets/**: Files for output (logos, templates, fonts). Used in output, not loaded into context.
