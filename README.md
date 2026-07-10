# pg-axi

Agent-facing PostgreSQL operations AXI for discovering, creating, inspecting,
querying, backing up, restoring, and maintaining PostgreSQL databases through
safe token-efficient CLI workflows.

The project follows the AXI creation guidelines installed with
`npx skills add kunchenguid/axi`.

## Goals

- Show useful live PostgreSQL context with `pg-axi`, not help text.
- Use compact TOON-style stdout for agent parsing.
- Keep every command non-interactive.
- Fail loudly on unknown flags before side effects.
- Default to read-only discovery, inspection, query, planning, or dry-run behavior.
- Require `--execute` for mutations.
- Require `--confirm <name>` for destructive operations.
- Truncate long SQL, query results, and inspect output by default.
- Redact passwords, URLs, tokens, secret-like env vars, and secret-like result columns.

## Usage

```sh
npm test
./bin/pg-axi.js
./bin/pg-axi.js doctor
./bin/pg-axi.js services
./bin/pg-axi.js discover
./bin/pg-axi.js recommend --goal inspect
./bin/pg-axi.js list --kind tables --schema public
./bin/pg-axi.js inspect --kind table --schema public --name users
./bin/pg-axi.js query --sql "select now()"
./bin/pg-axi.js create --kind schema --name app
./bin/pg-axi.js backup --database app --file app.dump
```

Mutating operations are dry-run by default. Add `--execute` only after reviewing
the generated SQL or command. Destructive operations also require
`--confirm <exact-name>`.

## PostgreSQL Domains

- Connection: URLs, host/port/user/database flags, service files, readiness
- Databases: create, list, inspect, backup, restore, drop
- Schemas and objects: schemas, tables, indexes, views, materialized views
- Programmability: functions, procedures, extensions
- Access control: roles and privileges
- Querying: capped reads, write guards, result truncation
- Operations: activity, stats, analyze, vacuum, reindex
- Replication: publications and subscriptions
- Managed Postgres: Supabase, Neon, RDS, and generic hosted Postgres detection
- Local dev: Docker Compose Postgres services and migration directories

## Custom Targets

`pg-axi.config.json` can define project-specific workflows:

```json
{
  "targets": [
    {
      "id": "prod-snapshot",
      "type": "custom",
      "detail": "provider-managed backup workflow",
      "commands": {
        "plan": ["echo", "review provider snapshot plan for ${environment}"],
        "apply": ["echo", "run provider snapshot for ${environment}"]
      }
    }
  ]
}
```

Provider lifecycle operations are opt-in through custom targets. Core `pg-axi`
commands operate through standard PostgreSQL tools such as `psql`, `createdb`,
`dropdb`, `pg_dump`, and `pg_restore`.

## Hooks and Skill

Install ambient session context hooks after explicit opt-in:

```sh
pg-axi hooks install --agent all --scope project --execute
```

Generate or verify installable skill guidance:

```sh
pg-axi skill generate
pg-axi skill generate --check
```

## AXI Catalog Entry

The upstream `kunchenguid/axi` community catalog entry should be:

- AXI: `pg-axi`
- Author: `thatdudealso`
- Domain: `PostgreSQL`
- Description: `Discover, create, inspect, query, back up, restore, and maintain PostgreSQL databases through safe token-efficient CLI workflows.`
- Link: `https://github.com/thatdudealso/pg-axi`
