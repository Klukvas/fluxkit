@AGENTS.md

## Claude Code specifics

- Treat `AGENTS.md` as the source of truth; edit rules there, not here.
- For tasks touching the data model, feature modules, or theming, briefly outline the plan before implementing.
- Prefer dedicated tools (Read/Grep/Edit) over shell for file work.
- When a task would violate the architecture rules in `AGENTS.md`, say so and propose the compliant alternative instead of silently complying or silently deviating.
