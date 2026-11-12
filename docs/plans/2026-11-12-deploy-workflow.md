# Plan: automatic deployment with GitHub Actions and Docker Hub (2026-11-12)

Owner request 2026-11-12: "давай через экшены и докер хаб". Today the test server (`docs/plans/2026-11-10-hetzner-first-deploy.md`)
runs `7349a1b`, built on the host by hand; nothing deploys `main`.

## Goal

A commit on `main` whose CI run passed is built into the three production images on a GitHub runner, pushed to Docker Hub and
started on one host, with a backup before and an automatic return to the previous release when the new one does not become healthy.
The template stays clean: no host, user or domain in the repository; with the repository variable `DEPLOY_HOST` unset the
workflow is skipped (forks and the template itself see a skipped run, not a failure).

## Existing pieces reused

- `Dockerfile` targets `api`, `storefront`, `edge`; `infra/docker-compose.prod.yml` already reads `FLUXKIT_IMAGE_PREFIX` and
  `FLUXKIT_IMAGE_TAG` (images as `<prefix>-api:<tag>`), so Compose needs no change.
- Host scripts of the test server: `fluxkit-backup` (section 8), `fluxkit-prune-images` (section 15), the `fk` wrapper.
- The shape of the owner's other projects (Docker Hub login with `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`, an SSH step).

## Design

| Decision | Choice | Why |
|---|---|---|
| Trigger | `workflow_run` of `CI` on `main`, conclusion `success`, event `push`; plus a manual run with a commit on `main` | Deploys only what passed every CI job; the manual run redeploys or rolls forward/back |
| Build | One job, Buildx, `linux/amd64`, three targets, GitHub Actions cache | The host (1 vCPU, 2 GB) no longer builds; the runner is amd64 like the host |
| Image names | `<DOCKERHUB_USERNAME>/fluxkit-{api,storefront,edge}:<7-char SHA>` | Matches the Compose naming; the tag is the commit, as on the host today |
| Storefront build arguments | `STOREFRONT_IMAGE_HOSTS`, `STOREFRONT_REQUIRE_LEGAL_TEXT` from repository variables | Both are build-time values (Dockerfile) |
| Transport | SSH with a dedicated key whose `authorized_keys` line forces `/usr/local/sbin/fluxkit-deploy` (`restrict`) | The key can only start a deployment of a tag, not run a shell |
| Release files on the host | `git archive HEAD infra` sent on stdin, kept as `/opt/fluxkit/releases/<tag>/infra` | Same layout as today; Compose and proxy files follow the release; private client forks need no token on the host |
| Host key | Pinned in the variable `DEPLOY_KNOWN_HOSTS` (`StrictHostKeyChecking=yes`) | No trust on first use in CI |
| Order on the host | lock, pull every image (nothing changes if one is missing), backup, switch tag and `current`, `up -d --wait --no-build` | A failed pull or backup leaves the running release untouched |
| Failure | Restore the env file and `current`, start the previous release, exit 1 | Works when the new release ran no migration; after a migration the old API refuses a newer database (documented) |
| Cleanup | `fluxkit-prune-images` after success when installed | Keeps the running and the previous tag |
| Check | `GET /store/config` and `GET /` through the public URL | Proves the edge, API and storefront answer |

## Files

- `.github/workflows/deploy.yml` (new), `infra/deploy/fluxkit-deploy` (new, installed on the host by hand).
- Docs: `docs/deployment.md` ("Automatic deployment"), `docs/files/workspace.md`, `docs/dependencies.md` (Docker Hub, the Docker
  actions), `CHANGELOG.md`, `docs/HANDOFF.md`; results on the test server in `docs/plans/2026-11-10-hetzner-first-deploy.md`.

No application code, API, schema, configuration variable of the apps, token or package dependency changes.

## Risks

- Images on Docker Hub are public unless the repository is made private (the GitHub repository is public; a client fork should use
  private repositories or another registry).
- The deploy key is root on the host through one command; whoever controls `main` and the Docker Hub token controls the host.
- A short `502` while the single API restarts (no zero-downtime rollout, `docs/deployment.md`).
- An automatic return to the previous release cannot undo a migration.

## Verification

`actionlint` and `shellcheck`; the script exercised locally against a fake `docker` (argument checks, order, failure path); then
the first real run on the test server after the owner sets the secrets; `docs/plans/2026-11-10-hetzner-first-deploy.md` records it.
