# infra

Docker Compose services for local development and CI: PostgreSQL 17, Redis 8 (AGPLv3, unmodified, see `docs/dependencies.md`),
Meilisearch v1.55.0 (Community Edition).

## Start
```
cp .env.example .env        # then edit values
docker compose --env-file .env -f infra/docker-compose.yml up -d
docker compose --env-file .env -f infra/docker-compose.yml ps    # wait for "healthy"
docker compose --env-file .env -f infra/docker-compose.yml down  # stop (add -v to drop data)
```

Ports are bound to 127.0.0.1 only. Variables are documented in `.env.example`.
Status: syntax validated with `docker compose config`; actually running the stack is verified in CI (no Docker daemon in the agent container).
