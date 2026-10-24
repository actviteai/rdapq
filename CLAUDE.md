# RDAP-Q 2.1.0

When the user types `/rdapq` or `/rdap-q`, read the RDAP-Q skill before doing anything else, then follow it for that task only. Do not use RDAP-Q for other requests.

Skill: `.agents/skills/rdap-q/SKILL.md` in this repository.
Fallback: `rdap-q-skill/SKILL.md`

The skill's tool is `tool/rdapq.js` in the same folder as `SKILL.md`.

## GitHub account

This repository belongs to the `actviteai` GitHub account. Every push, pull request, and merge must come from `actviteai`.

- Git is already set up for this. `origin` is `https://actviteai@github.com/...`, and a repo-local credential helper supplies actviteai's token. Do not change the remote or the credential config, and do not run `gh auth switch`.
- Prefix `gh` commands (`gh pr create`, `gh pr merge`, `gh api`) with `GH_TOKEN=$(gh auth token --user actviteai)`. The `.envrc` sets this for interactive shells, but agent shells do not load direnv.
- If a push or `gh` command fails on authentication, stop and tell the user. Do not work around it with another account.
