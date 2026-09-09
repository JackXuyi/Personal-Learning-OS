---
name: install-skills-from-url
description: Install skills from a specified URL (raw file, GitHub raw, or archive) into a skills directory — repo `skills/<name>/` by default, or a personal skills dir (e.g. ~/.cursor/skills, ~/.workbuddy/skills). Use when the user wants to install a skill from a URL, add a skill from a link, or fetch and install a skill from the web.
---

# Install Skills from URL

Install a skill by fetching content from a given URL. Supports single-file (SKILL.md) and directory/archive sources.

## Target Locations

| Scope   | Path                    |
|---------|-------------------------|
| Project (this repo) | `skills/<name>/` |
| Personal | `~/.cursor/skills/<name>/` / `~/.claude/skills/<name>/` / `~/.workbuddy/skills/<name>/`（视当前工具而定） |

Use the project path when the skill should be committed with the repo; use personal when only for the current user. **Do not** create skills under `.cursor/` inside this repo — project skills live at the repo root `skills/`.

## Workflow

1. **Resolve the URL**
   - If user gives a GitHub repo page (e.g. `https://github.com/owner/repo/tree/main/path/to/skill`), convert to raw content:
     - Single file: `https://raw.githubusercontent.com/owner/repo/main/path/to/skill/SKILL.md`
     - Or use the repo’s “raw” link for `SKILL.md`.
   - If user gives a direct URL to a file or archive, use it as-is.

2. **Fetch content**
   - Use `mcp_web_fetch` or equivalent to GET the URL.
   - If the URL returns HTML (e.g. a GitHub tree page), do not treat it as skill content; instead derive the raw URL and fetch again.

3. **Determine skill name**
   - From URL path (e.g. last segment before `.md`) or user input. Name must be lowercase, letters/numbers/hyphens only, max 64 chars.

4. **Write to disk**
   - Create directory: `skills/<skill-name>/`（repo，或对应 personal dir）。
   - If the fetched content is a single SKILL.md: write it as `skills/<skill-name>/SKILL.md`.
   - If the URL points to an archive (e.g. zip): user must download and extract; then move the extracted folder to `skills/<skill-name>/` (or merge contents into that folder so that `SKILL.md` is at `skills/<skill-name>/SKILL.md`).

5. **Confirm**
   - Tell the user where the skill was installed and that they may need to reload or restart the tool to pick it up. If installed into this repo, mention updating the `AGENTS.md` skill index when appropriate.

## URL Types

| URL type | Action |
|----------|--------|
| Raw SKILL.md (e.g. raw.githubusercontent.com/.../SKILL.md) | Fetch text, write to `.../skills/<name>/SKILL.md`. |
| GitHub tree (e.g. github.com/.../tree/.../skill-name) | Convert to raw URLs for SKILL.md and any reference files; fetch each and write under `.../skills/<name>/`. |
| Zip/tar archive | Instruct user to download and extract, or use a script/tool to download and extract, then place contents in `.../skills/<name>/`. |

## Single-file install (common case)

When the URL is a single SKILL.md:

1. Fetch content with `mcp_web_fetch`/`WebFetch` or equivalent.
2. If response is markdown (or plain text), create `skills/<skill-name>/SKILL.md` and write the content.
3. If the response is HTML or an error, explain and do not overwrite.

## Safety

- **Security review first**: before installing a skill fetched from the web, audit its SKILL.md and any bundled scripts (install/import of third-party skills must pass a security check; abort on obvious risky payloads and tell the user).
- Abort if the destination directory already exists, unless the user explicitly asks to overwrite.
- Do not install from URLs that return executable code (e.g. .js, .py) as the main skill content; the skill payload should be markdown/docs (e.g. SKILL.md, reference.md).

## After install

- Remind the user: "Skill installed at `<path>`." Restart/reload the tool if needed.
