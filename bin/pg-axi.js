#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const DESCRIPTION = "Operate PostgreSQL databases through safe create, inspect, query, backup, restore, and maintenance AXI workflows";
const VERSION = "0.1.0";
const PREVIEW_LIMIT = 1200;
const RESULT_LIMIT = 1600;
const GLOBAL_VALUE_FLAGS = new Set(["--cwd", "--url", "--host", "--port", "--user", "--database", "--service"]);
const GLOBAL_BOOLEAN_FLAGS = new Set(["--help"]);

const COMMANDS = {
  home: { value: new Set(), boolean: new Set(["--help"]), help: helpHome },
  doctor: { value: new Set(), boolean: new Set(["--help"]), help: helpDoctor },
  services: { value: new Set(["--capability", "--fields"]), boolean: new Set(["--help"]), help: helpServices },
  discover: { value: new Set(["--fields"]), boolean: new Set(["--full", "--help"]), help: helpDiscover },
  recommend: { value: new Set(["--goal"]), boolean: new Set(["--help"]), help: helpRecommend },
  list: { value: new Set(["--kind", "--schema", "--fields", "--limit"]), boolean: new Set(["--help"]), help: helpList },
  inspect: { value: new Set(["--kind", "--name", "--schema"]), boolean: new Set(["--full", "--help"]), help: helpInspect },
  query: { value: new Set(["--sql", "--file", "--limit"]), boolean: new Set(["--execute", "--full", "--help"]), help: helpQuery },
  create: { value: new Set(["--kind", "--name", "--schema", "--sql", "--file"]), boolean: new Set(["--execute", "--help"]), help: helpCreate },
  drop: { value: new Set(["--kind", "--name", "--schema", "--confirm"]), boolean: new Set(["--execute", "--help"]), help: helpDrop },
  backup: { value: new Set(["--database", "--file", "--format"]), boolean: new Set(["--execute", "--help"]), help: helpBackup },
  restore: { value: new Set(["--database", "--file", "--confirm", "--confirm-clean"]), boolean: new Set(["--clean", "--execute", "--help"]), help: helpRestore },
  maintenance: { value: new Set(["--action", "--target", "--confirm"]), boolean: new Set(["--execute", "--help"]), help: helpMaintenance },
  activity: { value: new Set(["--limit"]), boolean: new Set(["--help"]), help: helpActivity },
  stats: { value: new Set(["--kind", "--schema", "--limit"]), boolean: new Set(["--help"]), help: helpStats },
  kill: { value: new Set(["--pid", "--confirm"]), boolean: new Set(["--execute", "--help"]), help: helpKill },
  "hooks install": { value: new Set(["--agent", "--scope"]), boolean: new Set(["--execute", "--help"]), help: helpHooksInstall },
  "skill generate": { value: new Set(["--output"]), boolean: new Set(["--check", "--help"]), help: helpSkillGenerate }
};

const SERVICE_DOMAINS = [
  { capability: "connection", domain: "urls|host|port|user|database|service", use: "connect without exposing passwords" },
  { capability: "databases", domain: "create|list|inspect|backup|restore|drop", use: "operate database lifecycle with guards" },
  { capability: "schemas-objects", domain: "schemas|tables|indexes|views|materialized-views", use: "inspect and manage relational objects" },
  { capability: "programmability", domain: "functions|procedures|extensions", use: "inspect database code and extension state" },
  { capability: "access-control", domain: "roles|privileges", use: "review role and privilege posture" },
  { capability: "query", domain: "select|explain|guarded writes", use: "run capped queries with redaction and truncation" },
  { capability: "operations", domain: "activity|stats|analyze|vacuum|reindex", use: "debug performance and maintenance needs" },
  { capability: "replication", domain: "publications|subscriptions", use: "inspect logical replication configuration" },
  { capability: "managed-postgres", domain: "supabase|neon|rds|hosted-postgres", use: "detect provider context and recommend safe workflows" },
  { capability: "local-dev", domain: "compose|migrations|orm-configs", use: "orient local database development" }
];

const RECOMMENDATIONS = {
  inspect: [
    ["server", "readiness + version", "best first step before database work", "pg-axi doctor"],
    ["objects", "schemas|tables|indexes", "best for understanding a database", "pg-axi list --kind tables --schema public"],
    ["detail", "object-specific inspect", "best before a mutation", "pg-axi inspect --kind table --schema public --name <name>"]
  ],
  create: [
    ["database", "createdb guarded execution", "best for new isolated databases", "pg-axi create --kind database --name <name>"],
    ["schema", "CREATE SCHEMA plan", "best for namespaced app objects", "pg-axi create --kind schema --name <name>"],
    ["extension", "CREATE EXTENSION plan", "best for pgcrypto uuid and similar", "pg-axi create --kind extension --name <name>"]
  ],
  schema: [
    ["migrations", "migration directory detection", "best for app-managed schema", "pg-axi discover"],
    ["table", "table inspect", "best before column/index changes", "pg-axi inspect --kind table --schema public --name <name>"],
    ["indexes", "index stats", "best for performance review", "pg-axi stats --kind indexes"]
  ],
  query: [
    ["safe-select", "read-only SQL", "best for lightweight inspection", "pg-axi query --sql \"select now()\""],
    ["file", "SQL file execution plan", "best for repeatable scripts", "pg-axi query --file <path>"],
    ["activity", "active sessions", "best for debugging locks", "pg-axi activity"]
  ],
  backup: [
    ["plain", "pg_dump plain SQL", "best for reviewable backups", "pg-axi backup --database <name> --file backup.sql --format plain"],
    ["custom", "pg_dump custom format", "best for pg_restore", "pg-axi backup --database <name> --file backup.dump --format custom"],
    ["managed", "provider snapshot guidance", "best for hosted databases", "pg-axi recommend --goal managed"]
  ],
  restore: [
    ["plain", "psql restore plan", "best for SQL dumps", "pg-axi restore --database <name> --file backup.sql"],
    ["custom", "pg_restore plan", "best for custom dumps", "pg-axi restore --database <name> --file backup.dump"],
    ["preflight", "database inspect", "best before overwrite risk", "pg-axi inspect --kind database --name <name>"]
  ],
  roles: [
    ["list", "roles table", "best for access review", "pg-axi list --kind roles"],
    ["inspect", "role attributes", "best before grants", "pg-axi inspect --kind role --name <role>"],
    ["create", "guarded CREATE ROLE", "best for new app principals", "pg-axi create --kind role --name <role>"]
  ],
  extensions: [
    ["list", "installed extensions", "best for environment review", "pg-axi list --kind extensions"],
    ["create", "guarded CREATE EXTENSION", "best for enabling contrib features", "pg-axi create --kind extension --name <extension>"],
    ["inspect", "extension detail", "best before relying on extension version", "pg-axi inspect --kind extension --name <extension>"]
  ],
  performance: [
    ["activity", "pg_stat_activity", "best for current waits", "pg-axi activity"],
    ["table-stats", "table stats", "best for bloat or vacuum hints", "pg-axi stats --kind tables"],
    ["index-stats", "index stats", "best for unused indexes", "pg-axi stats --kind indexes"]
  ],
  replication: [
    ["publications", "publication list", "best for logical replication publishers", "pg-axi list --kind publications"],
    ["subscriptions", "subscription list", "best for logical replication subscribers", "pg-axi list --kind subscriptions"],
    ["services", "replication domain", "best for capability overview", "pg-axi services --capability replication"]
  ],
  managed: [
    ["detect", "provider config scan", "best first step for hosted Postgres", "pg-axi discover --full"],
    ["connect", "normal Postgres URL", "best for provider-neutral operations", "pg-axi doctor --url <postgres-url>"],
    ["custom", "pg-axi.config.json target", "best for explicit provider lifecycle commands", "pg-axi discover"]
  ],
  "local-dev": [
    ["compose", "Docker Compose Postgres", "best for local stacks", "pg-axi discover"],
    ["migrations", "migration folders", "best before schema work", "pg-axi discover --full"],
    ["readiness", "pg_isready", "best before tests", "pg-axi doctor"]
  ]
};

main();

function main() {
  const commandInfo = resolveCommand(process.argv.slice(2));
  const config = COMMANDS[commandInfo.command];
  if (!config) usageError(`unknown command ${toonScalar(commandInfo.command)}`, ["Run `pg-axi --help` for available commands"]);
  const parsed = parseArgs(commandInfo.command, commandInfo.args, config);
  if (parsed.flags.help) {
    print(config.help());
    return;
  }
  const context = buildContext(parsed.flags);
  const handlers = {
    home,
    doctor,
    services,
    discover,
    recommend,
    list,
    inspect,
    query,
    create,
    drop: dropObject,
    backup,
    restore,
    maintenance,
    activity,
    stats,
    kill: killBackend,
    "hooks install": hooksInstall,
    "skill generate": skillGenerate
  };
  handlers[commandInfo.command](parsed, context);
}

function resolveCommand(args) {
  if (args.length === 0 || args[0].startsWith("--")) return { command: "home", args };
  if (["hooks", "skill"].includes(args[0]) && args[1] && !args[1].startsWith("--")) {
    return { command: `${args[0]} ${args[1]}`, args: args.slice(2) };
  }
  return { command: args[0], args: args.slice(1) };
}

function parseArgs(command, args, config) {
  const valueFlags = new Set([...GLOBAL_VALUE_FLAGS, ...config.value]);
  const booleanFlags = new Set([...GLOBAL_BOOLEAN_FLAGS, ...config.boolean]);
  const flags = {};
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const [rawName, inlineValue] = arg.split("=", 2);
    if (!valueFlags.has(rawName) && !booleanFlags.has(rawName)) {
      usageError(`unknown flag ${rawName} for \`${command}\``, [`valid flags for \`${command}\`: ${validFlags(valueFlags, booleanFlags)}`]);
    }
    if (booleanFlags.has(rawName)) {
      if (inlineValue !== undefined) usageError(`${rawName} does not take a value`, [`Run \`pg-axi ${command} --help\` for examples`]);
      flags[flagName(rawName)] = true;
      continue;
    }
    const value = inlineValue ?? args[index + 1];
    if (value === undefined || value.startsWith("--")) usageError(`${rawName} requires a value`, [`Run \`pg-axi ${command} --help\` for examples`]);
    flags[flagName(rawName)] = value;
    if (inlineValue === undefined) index += 1;
  }
  if (positional.length > 0) usageError(`unexpected argument ${toonScalar(positional[0])} for \`${command}\``, [`Run \`pg-axi ${command} --help\` for examples`]);
  return { flags, positional };
}

function validFlags(valueFlags, booleanFlags) {
  return [...new Set([...valueFlags, ...booleanFlags])].sort().join(", ");
}

function flagName(rawName) {
  return rawName.slice(2).replaceAll("-", "_");
}

function buildContext(flags) {
  const url = flags.url ?? process.env.DATABASE_URL ?? "";
  if (url) assertConnectionUrl(url);
  return {
    cwd: path.resolve(flags.cwd ?? process.cwd()),
    url,
    host: flags.host ?? process.env.PGHOST ?? "",
    port: flags.port ?? process.env.PGPORT ?? "",
    user: flags.user ?? process.env.PGUSER ?? "",
    database: flags.database ?? process.env.PGDATABASE ?? "",
    service: flags.service ?? process.env.PGSERVICE ?? ""
  };
}

function assertConnectionUrl(url) {
  const help = ["Run `pg-axi doctor --url postgres://user@host:5432/database`"];
  if (!/^postgres(?:ql)?:\/\//i.test(url)) usageError("--url must be a postgres:// or postgresql:// connection URL", help);
  try {
    new URL(url);
  } catch {
    usageError("--url is not a valid connection URL", help);
  }
}

function home(_parsed, context) {
  const state = pgState(context);
  const targets = discoverTargets(context);
  const rows = targets.slice(0, 8).map((target) => ({
    id: target.id,
    type: target.type,
    source: displayPath(target.path, context.cwd),
    detail: target.detail
  }));
  const lines = [
    `bin: ${toonScalar(collapseHome(process.argv[1]))}`,
    `description: ${toonScalar(DESCRIPTION)}`,
    `version: ${VERSION}`,
    "postgres:",
    `  psql: ${state.psql}`,
    `  ready: ${state.ready}`,
    `  target: ${toonScalar(connectionLabel(context))}`,
    `  database: ${toonScalar(state.database)}`,
    `  user: ${toonScalar(state.user)}`,
    `  version: ${toonScalar(state.version)}`,
    "counts:",
    `  schemas: ${state.schemas}`,
    `  tables: ${state.tables}`,
    `  indexes: ${state.indexes}`,
    `  roles: ${state.roles}`,
    `targets_count: ${targets.length}`
  ];
  if (rows.length === 0) lines.push("targets: 0 PostgreSQL targets detected in this workspace");
  else lines.push(formatTable("targets", rows, ["id", "type", "source", "detail"]));
  const help = ["Run `pg-axi doctor` to check PostgreSQL readiness", "Run `pg-axi discover --full` to inspect project database targets"];
  if (targets.length > 0) help.push("Run `pg-axi inspect --kind server --name current` before mutating");
  else help.push("Run `pg-axi recommend --goal local-dev` to choose a PostgreSQL path");
  lines.push(formatHelp(help));
  print(lines.join("\n"));
}

function doctor(_parsed, context) {
  const psqlPath = findExecutable("psql");
  const ready = readiness(context);
  const identity = psqlPath ? queryKeyValues("select current_database() as database, current_user as user, version() as version", context) : {};
  const rows = [
    { check: "psql", status: psqlPath ? "ok" : "missing", detail: psqlPath ? collapseHome(psqlPath) : "install PostgreSQL client tools" },
    { check: "pg_isready", status: findExecutable("pg_isready") ? "ok" : "missing", detail: findExecutable("pg_isready") ? "available" : "install pg_isready" },
    { check: "createdb", status: findExecutable("createdb") ? "ok" : "missing", detail: "needed for database create" },
    { check: "dropdb", status: findExecutable("dropdb") ? "ok" : "missing", detail: "needed for database drop" },
    { check: "pg_dump", status: findExecutable("pg_dump") ? "ok" : "missing", detail: "needed for backup" },
    { check: "pg_restore", status: findExecutable("pg_restore") ? "ok" : "missing", detail: "needed for custom restores" },
    { check: "readiness", status: ready.status, detail: ready.detail },
    { check: "connection", status: psqlPath && identity.database ? "ok" : "unknown", detail: identity.database ? `${identity.database}|${identity.user}` : connectionLabel(context) },
    { check: "managed", status: managedHints(context).length ? "detected" : "none", detail: managedHints(context).map((item) => item.provider).join("|") || "no provider config hints" }
  ];
  print([
    `summary: ${psqlPath && ready.status === "ok" ? "ready" : "attention-required"}`,
    formatTable("checks", rows, ["check", "status", "detail"]),
    formatHelp(["Run `pg-axi discover` to list database targets", "Run `pg-axi services` to inspect supported PostgreSQL domains"])
  ].join("\n"));
}

function services(parsed) {
  const fields = parseFields(parsed.flags.fields, ["capability", "domain", "use"], ["capability", "domain", "use"]);
  const rows = SERVICE_DOMAINS.filter((row) => !parsed.flags.capability || row.capability === parsed.flags.capability).map((row) => pick(row, fields));
  const lines = [`count: ${rows.length} of ${SERVICE_DOMAINS.length} PostgreSQL domains`];
  if (rows.length === 0) lines.push(`services: 0 PostgreSQL domains found for ${toonScalar(parsed.flags.capability)}`);
  else lines.push(formatTable("services", rows, fields));
  lines.push(formatHelp(["Run `pg-axi recommend --goal <inspect|create|schema|query|backup|restore|roles|extensions|performance|replication|managed|local-dev>` for workflow paths"]));
  print(lines.join("\n"));
}

function discover(parsed, context) {
  const fields = parseFields(parsed.flags.fields, ["id", "type", "source", "detail"], ["id", "type", "source", "detail", "provider", "reason"]);
  const targets = discoverTargets(context);
  const rows = targets.map((target) => {
    const row = { ...target, source: displayPath(target.path, context.cwd) };
    if (!parsed.flags.full) {
      row.detail = truncate(row.detail ?? "", 120).text;
      row.reason = truncate(row.reason ?? "", 120).text;
    }
    return pick(row, fields);
  });
  const lines = [`count: ${rows.length} PostgreSQL targets detected`];
  if (rows.length === 0) lines.push("targets: 0 PostgreSQL targets detected in this workspace");
  else lines.push(formatTable("targets", rows, fields));
  lines.push(formatHelp(["Run `pg-axi doctor` to check connection readiness", "Run `pg-axi recommend --goal inspect` for next steps"]));
  print(lines.join("\n"));
}

function recommend(parsed) {
  const goal = parsed.flags.goal;
  if (!goal) usageError("--goal is required", ["Run `pg-axi recommend --goal <inspect|create|schema|query|backup|restore|roles|extensions|performance|replication|managed|local-dev>`"]);
  const rows = RECOMMENDATIONS[goal];
  if (!rows) usageError(`unknown goal ${toonScalar(goal)}`, ["valid goals: inspect, create, schema, query, backup, restore, roles, extensions, performance, replication, managed, local-dev"]);
  print([
    `goal: ${goal}`,
    formatTable("paths", rows.map(([id, pattern, fit, command]) => ({ id, pattern, fit, command })), ["id", "pattern", "fit", "command"]),
    formatHelp(["Run the suggested command for the path that best matches the database task"])
  ].join("\n"));
}

function list(parsed, context) {
  const kind = parsed.flags.kind;
  if (!kind) usageError("--kind is required", ["Run `pg-axi list --kind <databases|schemas|tables|views|indexes|roles|extensions|functions|publications|subscriptions>`"]);
  const spec = listSpec(kind, parsed.flags);
  if (!spec) usageError(`unknown list kind ${toonScalar(kind)}`, ["valid kinds: databases, schemas, tables, views, indexes, roles, extensions, functions, publications, subscriptions"]);
  ensureTool("psql", "list");
  const result = runPsql(spec.sql, context, { tuplesOnly: true, noAlign: true });
  if (result.status !== 0) runtimeError("postgres list query failed", [sanitize(result.stderr || result.stdout)]);
  const rows = parseRows(result.stdout, spec.fields).slice(0, parsePositiveInteger(parsed.flags.limit ?? "100", "--limit")).map((row) => pick(row, parseFields(parsed.flags.fields, spec.defaultFields, spec.fields)));
  if (rows.length === 0) print(`${kind}: 0 rows found`);
  else print([`count: ${rows.length} ${kind}`, formatTable(kind, rows, parseFields(parsed.flags.fields, spec.defaultFields, spec.fields))].join("\n"));
}

function inspect(parsed, context) {
  const kind = parsed.flags.kind;
  const name = parsed.flags.name;
  if (!kind) usageError("--kind is required", ["Run `pg-axi inspect --kind <server|database|schema|table|view|materialized-view|index|role|extension|function|publication|subscription> --name <name>`"]);
  if (!name) usageError("--name is required", ["Run `pg-axi inspect --kind table --schema public --name <name>`"]);
  const spec = inspectSpec(kind, name, parsed.flags.schema);
  if (!spec) usageError(`unknown inspect kind ${toonScalar(kind)}`, ["valid kinds: server, database, schema, table, view, materialized-view, index, role, extension, function, publication, subscription"]);
  ensureTool("psql", "inspect");
  const result = runPsql(spec.sql, context, { tuplesOnly: true, noAlign: true });
  if (result.status !== 0) runtimeError("postgres inspect query failed", [sanitize(result.stderr || result.stdout)]);
  const output = sanitize(result.stdout);
  const preview = parsed.flags.full ? output : truncate(output, PREVIEW_LIMIT).text;
  const lines = ["inspect:", `  kind: ${toonScalar(kind)}`, `  name: ${toonScalar(name)}`, `  output: ${toonScalar(preview)}`];
  if (!parsed.flags.full && truncate(output, PREVIEW_LIMIT).truncated) lines.push(formatHelp([`Run \`pg-axi inspect --kind ${kind} --name ${name} --full\` for complete sanitized output`]));
  print(lines.join("\n"));
}

function query(parsed, context) {
  const sql = readSql(parsed.flags, context);
  if (!sql) usageError("--sql or --file is required", ["Run `pg-axi query --sql \"select now()\"`"]);
  const readOnly = isReadOnlySql(sql);
  if (!readOnly && !parsed.flags.execute) {
    print(["query:", "  dry_run: true", `  read_only: false`, `  sql: ${toonScalar(truncate(sanitize(sql), PREVIEW_LIMIT).text)}`, formatHelp(["Add `--execute` to run this non-read-only SQL after review"])].join("\n"));
    return;
  }
  ensureTool("psql", "query");
  const finalSql = applyLimit(sql, parsed.flags.limit);
  const result = runPsql(finalSql, context, { tuplesOnly: false, noAlign: false, readOnly: !parsed.flags.execute });
  if (result.status !== 0) runtimeError("postgres query failed", [sanitize(result.stderr || result.stdout), "Add `--execute` if this SQL is meant to write"]);
  const sanitized = sanitizeSecretColumns(result.stdout);
  const body = parsed.flags.full ? sanitized : truncate(sanitized, RESULT_LIMIT).text;
  const lines = ["query:", `  read_only: ${readOnly}`, `  dry_run: false`, `  output: ${toonScalar(body)}`];
  if (!parsed.flags.full && truncate(sanitized, RESULT_LIMIT).truncated) lines.push(formatHelp(["Run `pg-axi query --sql <sql> --full` for complete sanitized output"]));
  print(lines.join("\n"));
}

function create(parsed, context) {
  const kind = parsed.flags.kind;
  const name = parsed.flags.name;
  if (!kind) usageError("--kind is required", ["Run `pg-axi create --kind <database|schema|table|index|role|extension|view> --name <name>`"]);
  if (!name) usageError("--name is required", ["Run `pg-axi create --kind schema --name <name>`"]);
  const command = createCommand(kind, name, parsed.flags, context);
  if (!command) usageError(`unknown create kind ${toonScalar(kind)}`, ["valid kinds: database, schema, table, index, role, extension, view"]);
  if (!parsed.flags.execute) {
    print(["create:", "  dry_run: true", `  kind: ${kind}`, `  name: ${toonScalar(name)}`, `  command: ${toonScalar(sanitize(formatCommand(command)))}`, formatHelp([`Run \`pg-axi create --kind ${kind} --name ${name} --execute\` to create after review`])].join("\n"));
    return;
  }
  ensureTool(command.cmd, "create");
  const result = runCommand(command.cmd, command.args, commandContext(command, context));
  if (result.status !== 0) runtimeError("postgres create command failed", [sanitize(result.stderr || result.stdout)]);
  print(["create:", "  dry_run: false", `  kind: ${kind}`, `  name: ${toonScalar(name)}`, `  output: ${toonScalar(truncate(sanitize(result.stdout || result.stderr), PREVIEW_LIMIT).text)}`].join("\n"));
}

function dropObject(parsed, context) {
  const kind = parsed.flags.kind;
  const name = parsed.flags.name;
  if (!kind) usageError("--kind is required", ["Run `pg-axi drop --kind <database|schema|table|index|role|extension|view> --name <name> --confirm <name>`"]);
  if (!name) usageError("--name is required", ["Run `pg-axi drop --kind table --name <name> --confirm <name>`"]);
  if (parsed.flags.confirm !== name) usageError("destructive drop requires --confirm matching --name", [`Run \`pg-axi drop --kind ${kind} --name ${name} --confirm ${name}\` after review`]);
  const command = dropCommand(kind, name, parsed.flags, context);
  if (!command) usageError(`unknown drop kind ${toonScalar(kind)}`, ["valid kinds: database, schema, table, index, role, extension, view"]);
  if (!parsed.flags.execute) {
    print(["drop:", "  dry_run: true", `  kind: ${kind}`, `  name: ${toonScalar(name)}`, `  command: ${toonScalar(sanitize(formatCommand(command)))}`, formatHelp([`Run \`pg-axi drop --kind ${kind} --name ${name} --confirm ${name} --execute\` to drop after review`])].join("\n"));
    return;
  }
  ensureTool(command.cmd, "drop");
  const result = runCommand(command.cmd, command.args, commandContext(command, context));
  if (result.status !== 0) runtimeError("postgres drop command failed", [sanitize(result.stderr || result.stdout)]);
  print(["drop:", "  dry_run: false", `  kind: ${kind}`, `  name: ${toonScalar(name)}`, `  output: ${toonScalar(truncate(sanitize(result.stdout || result.stderr), PREVIEW_LIMIT).text)}`].join("\n"));
}

function backup(parsed, context) {
  const database = parsed.flags.database ?? context.database;
  const file = parsed.flags.file;
  const format = parsed.flags.format ?? "custom";
  if (!database) usageError("--database is required", ["Run `pg-axi backup --database <name> --file <path>`"]);
  if (!file) usageError("--file is required", ["Run `pg-axi backup --database <name> --file <path>`"]);
  if (!["plain", "custom"].includes(format)) usageError("unknown backup format", ["valid formats: plain, custom"]);
  assertDatabaseMatchesUrl(database, context);
  const command = pgDumpCommand(database, file, format, context);
  if (!parsed.flags.execute) {
    print(["backup:", "  dry_run: true", `  database: ${toonScalar(database)}`, `  file: ${toonScalar(file)}`, `  command: ${toonScalar(sanitize(formatCommand(command)))}`, formatHelp(["Add `--execute` to write the backup after review"])].join("\n"));
    return;
  }
  ensureTool("pg_dump", "backup");
  const result = runCommand(command.cmd, command.args, context);
  if (result.status !== 0) runtimeError("postgres backup failed", [sanitize(result.stderr || result.stdout)]);
  print(["backup:", "  dry_run: false", `  database: ${toonScalar(database)}`, `  file: ${toonScalar(file)}`, `  output: ${toonScalar(truncate(sanitize(result.stdout || result.stderr || "backup complete"), PREVIEW_LIMIT).text)}`].join("\n"));
}

function restore(parsed, context) {
  const database = parsed.flags.database ?? context.database;
  const file = parsed.flags.file;
  if (!database) usageError("--database is required", ["Run `pg-axi restore --database <name> --file <path> --confirm <name>`"]);
  if (!file) usageError("--file is required", ["Run `pg-axi restore --database <name> --file <path> --confirm <name>`"]);
  if (parsed.flags.confirm !== database) usageError("restore requires --confirm matching --database", [`Run \`pg-axi restore --database ${database} --file ${file} --confirm ${database}\` after review`]);
  assertDatabaseMatchesUrl(database, context);
  if (parsed.flags.clean && parsed.flags.confirm_clean !== database) usageError("--clean drops every object in the dump before restoring and requires --confirm-clean matching --database", [`Run \`pg-axi restore --database ${database} --file ${file} --confirm ${database} --clean --confirm-clean ${database}\` after review`]);
  const preflight = restorePreflight(database, context);
  const command = restoreCommand(database, file, parsed.flags.clean, context);
  if (!parsed.flags.execute) {
    const help = ["Add `--execute` to restore after review"];
    if (preflight.tables > 0) help.unshift(`Target ${database} already holds ${preflight.tables} tables and a restore into it can fail or merge`);
    print(["restore:", "  dry_run: true", `  database: ${toonScalar(database)}`, `  file: ${toonScalar(file)}`, `  target_exists: ${preflight.exists}`, `  target_tables: ${preflight.tables}`, `  command: ${toonScalar(sanitize(formatCommand(command)))}`, formatHelp(help)].join("\n"));
    return;
  }
  if (preflight.tables > 0 && !parsed.flags.clean) runtimeError(`restore target ${toonScalar(database)} already holds ${preflight.tables} tables`, ["Restore into an empty database", `Run \`pg-axi restore --database ${database} --file ${file} --confirm ${database} --clean --confirm-clean ${database} --execute\` to replace the objects in the dump`]);
  ensureTool(command.cmd, "restore");
  const result = runCommand(command.cmd, command.args, context);
  if (result.status !== 0) runtimeError("postgres restore failed", [sanitize(result.stderr || result.stdout)]);
  print(["restore:", "  dry_run: false", `  database: ${toonScalar(database)}`, `  output: ${toonScalar(truncate(sanitize(result.stdout || result.stderr), PREVIEW_LIMIT).text)}`].join("\n"));
}

function maintenance(parsed, context) {
  const action = parsed.flags.action;
  if (!action) usageError("--action is required", ["Run `pg-axi maintenance --action <analyze|vacuum|vacuum-full|reindex>`"]);
  const sql = maintenanceSql(action, parsed.flags.target);
  if (!sql) usageError(`unknown maintenance action ${toonScalar(action)}`, ["valid actions: analyze, vacuum, vacuum-full, reindex"]);
  const needsConfirm = ["vacuum-full", "reindex"].includes(action);
  if (needsConfirm && !parsed.flags.target) usageError(`--target is required for ${action}`, [`Run \`pg-axi maintenance --action ${action} --target <schema.table> --confirm <schema.table>\``]);
  const target = parsed.flags.target ?? "database";
  if (needsConfirm && parsed.flags.confirm !== target) usageError("destructive maintenance requires --confirm matching --target", [`Run \`pg-axi maintenance --action ${action} --target ${target} --confirm ${target}\``]);
  if (!parsed.flags.execute) {
    print(["maintenance:", "  dry_run: true", `  action: ${action}`, `  target: ${toonScalar(target)}`, `  connection: ${toonScalar(connectionLabel(context))}`, `  sql: ${toonScalar(sql)}`, formatHelp(["Add `--execute` to run maintenance after review"])].join("\n"));
    return;
  }
  ensureTool("psql", "maintenance");
  const result = runPsql(sql, context, { tuplesOnly: false, noAlign: false });
  if (result.status !== 0) runtimeError("postgres maintenance failed", [sanitize(result.stderr || result.stdout)]);
  print(["maintenance:", "  dry_run: false", `  action: ${action}`, `  output: ${toonScalar(truncate(sanitize(result.stdout || result.stderr), PREVIEW_LIMIT).text)}`].join("\n"));
}

function activity(parsed, context) {
  const limit = parsePositiveInteger(parsed.flags.limit ?? "20", "--limit");
  ensureTool("psql", "activity");
  const sql = `select pid, usename, datname, state, wait_event_type, left(query, 80) as query from pg_stat_activity where pid <> pg_backend_pid() order by query_start nulls last limit ${limit}`;
  const result = runPsql(sql, context, { tuplesOnly: true, noAlign: true });
  if (result.status !== 0) runtimeError("postgres activity query failed", [sanitize(result.stderr || result.stdout)]);
  const rows = parseRows(result.stdout, ["pid", "user", "database", "state", "wait", "query"]);
  print(rows.length === 0 ? "activity: 0 sessions found" : [`count: ${rows.length} sessions`, formatTable("sessions", rows, ["pid", "user", "database", "state", "wait", "query"])].join("\n"));
}

function stats(parsed, context) {
  const kind = parsed.flags.kind ?? "database";
  const spec = statsSpec(kind, parsed.flags);
  if (!spec) usageError(`unknown stats kind ${toonScalar(kind)}`, ["valid kinds: database, tables, indexes"]);
  ensureTool("psql", "stats");
  const result = runPsql(spec.sql, context, { tuplesOnly: true, noAlign: true });
  if (result.status !== 0) runtimeError("postgres stats query failed", [sanitize(result.stderr || result.stdout)]);
  const rows = parseRows(result.stdout, spec.fields).slice(0, parsePositiveInteger(parsed.flags.limit ?? "50", "--limit"));
  print(rows.length === 0 ? `stats: 0 ${kind} rows found` : [`count: ${rows.length} ${kind} stats`, formatTable("stats", rows, spec.fields)].join("\n"));
}

function killBackend(parsed, context) {
  const pid = parsed.flags.pid;
  if (!pid) usageError("--pid is required", ["Run `pg-axi kill --pid <pid> --confirm <pid>`"]);
  if (parsed.flags.confirm !== pid) usageError("kill requires --confirm matching --pid", [`Run \`pg-axi kill --pid ${pid} --confirm ${pid}\` after review`]);
  const sql = `select pg_terminate_backend(${Number(pid)})`;
  if (!Number.isInteger(Number(pid)) || Number(pid) < 1) usageError("--pid must be a positive integer", ["Run `pg-axi activity` to find backend pids"]);
  if (!parsed.flags.execute) {
    print(["kill:", "  dry_run: true", `  pid: ${pid}`, `  sql: ${toonScalar(sql)}`, formatHelp([`Run \`pg-axi kill --pid ${pid} --confirm ${pid} --execute\` to terminate after review`])].join("\n"));
    return;
  }
  ensureTool("psql", "kill");
  const result = runPsql(sql, context, { tuplesOnly: true, noAlign: true });
  if (result.status !== 0) runtimeError("postgres kill failed", [sanitize(result.stderr || result.stdout)]);
  print(["kill:", "  dry_run: false", `  pid: ${pid}`, `  output: ${toonScalar(truncate(sanitize(result.stdout), PREVIEW_LIMIT).text)}`].join("\n"));
}

function hooksInstall(parsed, context) {
  const agent = parsed.flags.agent ?? "all";
  const scope = parsed.flags.scope ?? "project";
  const validAgents = new Set(["codex", "claude", "opencode", "all"]);
  const validScopes = new Set(["user", "project"]);
  if (!validAgents.has(agent)) usageError(`unknown agent ${toonScalar(agent)}`, ["valid agents: codex, claude, opencode, all"]);
  if (!validScopes.has(scope)) usageError(`unknown scope ${toonScalar(scope)}`, ["valid scopes: user, project"]);
  const rows = hookTargets(agent, scope, context);
  if (!parsed.flags.execute) {
    print(["hooks:", "  dry_run: true", formatTable("files", rows, ["agent", "path", "status"]), formatHelp(["Run `pg-axi hooks install --agent all --scope project --execute` to write hook files"])].join("\n"));
    return;
  }
  for (const row of rows) {
    fs.mkdirSync(path.dirname(row.absolutePath), { recursive: true });
    fs.writeFileSync(row.absolutePath, hookContent(row.agent), "utf8");
  }
  print(formatTable("files", rows.map((row) => ({ agent: row.agent, path: row.path, status: "written" })), ["agent", "path", "status"]));
}

function skillGenerate(parsed, context) {
  const output = path.resolve(context.cwd, parsed.flags.output ?? "SKILL.md");
  const content = skillContent();
  if (parsed.flags.check) {
    const actual = fs.existsSync(output) ? fs.readFileSync(output, "utf8") : "";
    if (actual !== content) runtimeError("generated skill is stale or missing", [`Run \`pg-axi skill generate --output ${displayPath(output, context.cwd)}\``], 1);
    print("skill: up-to-date");
    return;
  }
  fs.writeFileSync(output, content, "utf8");
  print(["skill:", `  path: ${toonScalar(displayPath(output, context.cwd))}`, "  status: written"].join("\n"));
}

function pgState(context) {
  if (!findExecutable("psql")) return { psql: "missing", ready: "missing", database: "", user: "", version: "", schemas: 0, tables: 0, indexes: 0, roles: 0 };
  const ready = readiness(context);
  const identity = queryKeyValues("select current_database() as database, current_user as user, current_setting('server_version') as version", context);
  const counts = queryKeyValues("select (select count(*) from information_schema.schemata) as schemas, (select count(*) from information_schema.tables where table_schema not in ('pg_catalog','information_schema')) as tables, (select count(*) from pg_indexes where schemaname not in ('pg_catalog')) as indexes, (select count(*) from pg_roles) as roles", context);
  return {
    psql: "ok",
    ready: ready.status,
    database: identity.database ?? "",
    user: identity.user ?? "",
    version: identity.version ?? "",
    schemas: counts.schemas ?? 0,
    tables: counts.tables ?? 0,
    indexes: counts.indexes ?? 0,
    roles: counts.roles ?? 0
  };
}

function readiness(context) {
  if (!findExecutable("pg_isready")) return { status: "missing", detail: "pg_isready not found" };
  const args = [];
  if (context.host) args.push("-h", context.host);
  if (context.port) args.push("-p", context.port);
  if (context.user) args.push("-U", context.user);
  if (context.database) args.push("-d", context.database);
  const result = runCommand("pg_isready", args, context);
  return { status: result.status === 0 ? "ok" : "error", detail: truncate(sanitize(result.stdout || result.stderr || "not ready"), 160).text };
}

function queryKeyValues(sql, context) {
  const result = runPsql(sql, context, { tuplesOnly: true, noAlign: true });
  if (result.status !== 0) return {};
  const values = result.stdout.trim().split("|");
  if (/current_database\(\)|schemas/.test(result.stdout)) return {};
  if (values.length === 3 && /PostgreSQL|^\d/.test(values[2])) return { database: values[0] ?? "", user: values[1] ?? "", version: values[2] ?? "" };
  if (values.length === 4) return { schemas: values[0] ?? 0, tables: values[1] ?? 0, indexes: values[2] ?? 0, roles: values[3] ?? 0 };
  return {};
}

function runPsql(sql, context, options = {}) {
  const args = ["-X", "--set", "ON_ERROR_STOP=1"];
  if (options.tuplesOnly) args.push("--tuples-only");
  if (options.noAlign) args.push("--no-align");
  args.push(...connectionArgs(context, "psql"));
  args.push("-c", sql);
  return runCommand("psql", args, options.readOnly ? readOnlyContext(context) : context);
}

function readOnlyContext(context) {
  const options = `${process.env.PGOPTIONS ?? ""} -c default_transaction_read_only=on`.trim();
  return { ...context, env: { ...(context.env ?? {}), PGOPTIONS: options } };
}

function connectionArgs(context, tool) {
  const args = [];
  if (context.url) args.push(...(tool === "psql" ? [context.url] : ["-d", context.url]));
  if (context.host) args.push("-h", context.host);
  if (context.port) args.push("-p", context.port);
  if (context.user) args.push("-U", context.user);
  if (!context.url && context.database && tool !== "createdb" && tool !== "dropdb") args.push("-d", context.database);
  return args;
}

function assertDatabaseMatchesUrl(database, context) {
  if (!context.url || !database) return;
  const named = urlDatabase(context.url);
  if (named && named !== database) usageError(`--database ${toonScalar(database)} does not match the database in --url`, [`Run the command with --database ${named} or point --url at ${toonScalar(database)}`]);
}

function urlDatabase(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
}

function commandContext(_command, context) {
  const env = { ...process.env };
  if (context.service) env.PGSERVICE = context.service;
  return { ...context, env };
}

function createCommand(kind, name, flags, context) {
  if (kind === "database") return { cmd: "createdb", args: [...connectionArgs(context, "createdb"), name] };
  const sql = flags.sql ?? (flags.file ? safeRead(path.resolve(context.cwd, flags.file)) : createSql(kind, name, flags.schema));
  if (!sql) return null;
  return { cmd: "psql", args: ["-X", "--set", "ON_ERROR_STOP=1", ...connectionArgs(context, "psql"), "-c", sql] };
}

function dropCommand(kind, name, flags, context) {
  if (kind === "database") return { cmd: "dropdb", args: [...connectionArgs(context, "dropdb"), name] };
  const sql = dropSql(kind, name, flags.schema);
  if (!sql) return null;
  return { cmd: "psql", args: ["-X", "--set", "ON_ERROR_STOP=1", ...connectionArgs(context, "psql"), "-c", sql] };
}

function createSql(kind, name, schema = "public") {
  const ident = quoteIdent(name);
  const qualified = `${quoteIdent(schema)}.${ident}`;
  const values = {
    schema: `CREATE SCHEMA ${ident}`,
    table: `CREATE TABLE ${qualified} (id bigserial PRIMARY KEY)`,
    index: `CREATE INDEX ${ident} ON ${quoteIdent(schema)}.${quoteIdent("table_name")} (id)`,
    role: `CREATE ROLE ${ident}`,
    extension: `CREATE EXTENSION IF NOT EXISTS ${ident}`,
    view: `CREATE VIEW ${qualified} AS SELECT 1 AS id`
  };
  return values[kind] ?? "";
}

function dropSql(kind, name, schema = "public") {
  const ident = quoteIdent(name);
  const qualified = `${quoteIdent(schema)}.${ident}`;
  const values = {
    schema: `DROP SCHEMA ${ident}`,
    table: `DROP TABLE ${qualified}`,
    index: `DROP INDEX ${qualified}`,
    role: `DROP ROLE ${ident}`,
    extension: `DROP EXTENSION ${ident}`,
    view: `DROP VIEW ${qualified}`
  };
  return values[kind] ?? "";
}

function pgDumpCommand(database, file, format, context) {
  return { cmd: "pg_dump", args: [...connectionArgs({ ...context, database }, "pg_dump"), "-F", format === "plain" ? "p" : "c", "-f", file] };
}

function restorePreflight(database, context) {
  if (!findExecutable("psql")) return { exists: "unknown", tables: "unknown" };
  const result = runPsql("select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r','p') and n.nspname not in ('pg_catalog','information_schema')", { ...context, database }, { tuplesOnly: true, noAlign: true });
  if (result.status !== 0) return { exists: false, tables: 0 };
  const tables = Number(result.stdout.trim());
  return { exists: true, tables: Number.isInteger(tables) ? tables : 0 };
}

function restoreCommand(database, file, clean, context) {
  if (file.endsWith(".sql")) return { cmd: "psql", args: ["-X", "--set", "ON_ERROR_STOP=1", ...connectionArgs({ ...context, database }, "psql"), "-f", file] };
  return { cmd: "pg_restore", args: [...connectionArgs({ ...context, database }, "pg_restore"), ...(clean ? ["--clean"] : []), file] };
}

function listSpec(kind, flags) {
  const schema = sqlLiteral(flags.schema ?? "public");
  const specs = {
    databases: { fields: ["name", "owner", "encoding", "size"], defaultFields: ["name", "owner", "size"], sql: "select datname, pg_catalog.pg_get_userbyid(datdba), pg_encoding_to_char(encoding), pg_size_pretty(pg_database_size(datname)) from pg_database where datistemplate = false order by datname" },
    schemas: { fields: ["name", "owner"], defaultFields: ["name", "owner"], sql: "select schema_name, schema_owner from information_schema.schemata order by schema_name" },
    tables: { fields: ["schema", "name", "type"], defaultFields: ["schema", "name", "type"], sql: `select table_schema, table_name, table_type from information_schema.tables where table_schema = ${schema} order by table_name` },
    views: { fields: ["schema", "name", "type"], defaultFields: ["schema", "name", "type"], sql: `select table_schema, table_name, table_type from information_schema.views where table_schema = ${schema} order by table_name` },
    indexes: { fields: ["schema", "name", "table"], defaultFields: ["schema", "name", "table"], sql: `select schemaname, indexname, tablename from pg_indexes where schemaname = ${schema} order by indexname` },
    roles: { fields: ["name", "superuser", "createdb", "login"], defaultFields: ["name", "superuser", "login"], sql: "select rolname, rolsuper, rolcreatedb, rolcanlogin from pg_roles order by rolname" },
    extensions: { fields: ["name", "version", "schema"], defaultFields: ["name", "version", "schema"], sql: "select extname, extversion, nspname from pg_extension join pg_namespace on pg_namespace.oid = pg_extension.extnamespace order by extname" },
    functions: { fields: ["schema", "name", "args"], defaultFields: ["schema", "name", "args"], sql: `select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = ${schema} order by p.proname` },
    publications: { fields: ["name", "all_tables"], defaultFields: ["name", "all_tables"], sql: "select pubname, puballtables from pg_publication order by pubname" },
    subscriptions: { fields: ["name", "enabled"], defaultFields: ["name", "enabled"], sql: "select subname, subenabled from pg_subscription order by subname" }
  };
  return specs[kind];
}

function inspectSpec(kind, name, schema = "public") {
  const literal = sqlLiteral(name);
  const schemaLiteral = sqlLiteral(schema);
  const specs = {
    server: { sql: "select version(), current_database(), current_user, inet_server_addr(), inet_server_port()" },
    database: { sql: `select datname, pg_catalog.pg_get_userbyid(datdba), pg_size_pretty(pg_database_size(datname)) from pg_database where datname = ${literal}` },
    schema: { sql: `select schema_name, schema_owner from information_schema.schemata where schema_name = ${literal}` },
    table: { sql: `select column_name, data_type, is_nullable from information_schema.columns where table_schema = ${schemaLiteral} and table_name = ${literal} order by ordinal_position` },
    view: { sql: `select table_schema, table_name, view_definition from information_schema.views where table_schema = ${schemaLiteral} and table_name = ${literal}` },
    "materialized-view": { sql: `select schemaname, matviewname, definition from pg_matviews where schemaname = ${schemaLiteral} and matviewname = ${literal}` },
    index: { sql: `select schemaname, tablename, indexname, indexdef from pg_indexes where schemaname = ${schemaLiteral} and indexname = ${literal}` },
    role: { sql: `select rolname, rolsuper, rolcreatedb, rolcanlogin, rolreplication from pg_roles where rolname = ${literal}` },
    extension: { sql: `select extname, extversion, nspname from pg_extension join pg_namespace on pg_namespace.oid = pg_extension.extnamespace where extname = ${literal}` },
    function: { sql: `select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = ${schemaLiteral} and p.proname = ${literal}` },
    publication: { sql: `select pubname, puballtables, pubinsert, pubupdate, pubdelete from pg_publication where pubname = ${literal}` },
    subscription: { sql: `select subname, subenabled, subconninfo from pg_subscription where subname = ${literal}` }
  };
  return specs[kind];
}

function statsSpec(kind, flags) {
  const schema = sqlLiteral(flags.schema ?? "public");
  const specs = {
    database: { fields: ["database", "connections", "commits", "rollbacks"], sql: "select datname, numbackends, xact_commit, xact_rollback from pg_stat_database where datname is not null order by datname" },
    tables: { fields: ["schema", "table", "seq_scan", "idx_scan", "n_live_tup"], sql: `select schemaname, relname, seq_scan, idx_scan, n_live_tup from pg_stat_user_tables where schemaname = ${schema} order by relname` },
    indexes: { fields: ["schema", "table", "index", "idx_scan"], sql: `select schemaname, relname, indexrelname, idx_scan from pg_stat_user_indexes where schemaname = ${schema} order by idx_scan asc, indexrelname` }
  };
  return specs[kind];
}

function maintenanceSql(action, target) {
  const suffix = target ? ` ${quoteQualified(target)}` : "";
  const specs = {
    analyze: `ANALYZE${suffix}`,
    vacuum: `VACUUM${suffix}`,
    "vacuum-full": `VACUUM FULL${suffix}`,
    reindex: target ? `REINDEX TABLE ${quoteQualified(target)}` : "REINDEX DATABASE CURRENT_DATABASE_PLACEHOLDER"
  };
  return specs[action]?.replace("CURRENT_DATABASE_PLACEHOLDER", "current_database()") ?? "";
}

function readSql(flags, context) {
  if (flags.sql && flags.file) usageError("--sql and --file cannot be combined", ["Choose one SQL source"]);
  if (flags.sql) return flags.sql;
  if (flags.file) return safeRead(path.resolve(context.cwd, flags.file));
  return "";
}

function isReadOnlySql(sql) {
  const normalized = String(sql).trim().replace(/^\/\*[\s\S]*?\*\//, "").replace(/^--.*$/gm, "").trim().toLowerCase();
  return /^(select|with|show|explain)\b/.test(normalized) && !/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy\s+.+\s+from)\b/.test(normalized);
}

function applyLimit(sql, limitValue) {
  if (!limitValue) return sql;
  const limit = parsePositiveInteger(limitValue, "--limit");
  if (!isReadOnlySql(sql) || /\blimit\s+\d+/i.test(sql)) return sql;
  return `select * from (${sql.replace(/;+\s*$/, "")}) pg_axi_limited limit ${limit}`;
}

function discoverTargets(context) {
  const targets = [];
  targets.push(...customTargets(context));
  const envFiles = [".env", ".env.local", ".env.development", ".env.test"].map((name) => path.join(context.cwd, name)).filter((file) => fs.existsSync(file));
  for (const file of envFiles) {
    const content = safeRead(file);
    if (/DATABASE_URL\s*=|POSTGRES_URL\s*=|PGHOST\s*=/i.test(content)) {
      targets.push({ id: `env:${path.basename(file)}`, type: "connection-env", path: file, detail: "PostgreSQL connection env", provider: providerFromText(content), reason: "database environment variables found" });
    }
  }
  for (const file of findFiles(context.cwd, isComposeFile, 2)) {
    const content = safeRead(file);
    if (/postgres(?:ql)?:|image:\s*postgres/i.test(content)) {
      targets.push({ id: `compose:${displayPath(file, context.cwd)}`, type: "compose-postgres", path: file, detail: "Docker Compose Postgres service", provider: "local", reason: "compose file references postgres image or service" });
    }
  }
  for (const dir of ["migrations", "db/migrate", "db/migrations", "sql", "schema"].map((name) => path.join(context.cwd, name)).filter((file) => fs.existsSync(file))) {
    targets.push({ id: `migrations:${displayPath(dir, context.cwd)}`, type: "migrations", path: dir, detail: `${findFiles(dir, (file) => file.endsWith(".sql"), 3).length} sql files`, provider: "", reason: "migration or SQL directory found" });
  }
  for (const file of ["prisma/schema.prisma", "drizzle.config.ts", "drizzle.config.js", "knexfile.js", "knexfile.ts", "supabase/config.toml", "neon.json"].map((name) => path.join(context.cwd, name)).filter((file) => fs.existsSync(file))) {
    targets.push({ id: `config:${displayPath(file, context.cwd)}`, type: configType(file), path: file, detail: configDetail(file), provider: providerFromText(`${file}\n${safeRead(file)}`), reason: "database tooling config found" });
  }
  targets.push(...managedHints(context));
  return dedupeTargets(targets);
}

function customTargets(context) {
  const file = path.join(context.cwd, "pg-axi.config.json");
  const config = readJson(file);
  if (!config?.targets || !Array.isArray(config.targets)) return [];
  return config.targets.map((target) => ({
    id: `config:${untrustedText(target.id, 60)}`,
    type: untrustedText(target.type ?? "custom", 40),
    path: path.resolve(context.cwd, target.path ?? "."),
    detail: `[config] ${untrustedText(target.detail ?? "custom PostgreSQL workflow", 120)}`,
    provider: untrustedText(target.provider ?? "", 40),
    reason: `[config] ${untrustedText(target.reason ?? "pg-axi.config.json target", 120)}`,
    commands: target.commands
  }));
}

function untrustedText(value, limit) {
  return truncate(String(value ?? "").replace(/\s+/g, " ").trim(), limit).text;
}

function managedHints(context) {
  const hints = [];
  for (const file of findFiles(context.cwd, (item) => /\.(tf|toml|json|ya?ml|env)$/.test(item), 3)) {
    const text = `${file}\n${safeRead(file)}`;
    const provider = providerFromText(text);
    if (provider && provider !== "local") {
      hints.push({ id: `managed:${provider}:${displayPath(file, context.cwd)}`, type: "managed-postgres", path: file, detail: `${provider} config hint`, provider, reason: "managed PostgreSQL provider config found" });
    }
  }
  return dedupeTargets(hints);
}

function providerFromText(text) {
  if (/supabase/i.test(text)) return "supabase";
  if (/neon\.tech|neon_/i.test(text)) return "neon";
  if (/aws_db_instance|rds\.amazonaws\.com|aurora|rds/i.test(text)) return "rds";
  if (/postgres(?:ql)?:\/\/[^@\s]+@/i.test(text)) return "hosted-postgres";
  return "";
}

function configType(file) {
  if (file.includes("prisma")) return "prisma";
  if (file.includes("drizzle")) return "drizzle";
  if (file.includes("knex")) return "knex";
  if (file.includes("supabase")) return "supabase";
  if (file.includes("neon")) return "neon";
  return "database-config";
}

function configDetail(file) {
  if (file.includes("supabase")) return "Supabase local/project config";
  if (file.includes("neon")) return "Neon project config";
  return "database tooling config";
}

function isComposeFile(file) {
  return ["compose.yml", "compose.yaml", "docker-compose.yml", "docker-compose.yaml"].includes(path.basename(file));
}

function runCommand(cmd, args, context) {
  const env = { ...process.env, ...(context.env ?? {}) };
  if (context.service) env.PGSERVICE = context.service;
  const result = spawnSync(cmd, args, { cwd: context.cwd, env, encoding: "utf8", maxBuffer: 1024 * 1024 * 8 });
  if (result.error) return { status: 127, stdout: "", stderr: result.error.message };
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function ensureTool(cmd, purpose) {
  if (!findExecutable(cmd)) runtimeError(`${cmd} is required for ${purpose}`, [`Install PostgreSQL client tool ${cmd} and retry`]);
}

function findExecutable(name) {
  if (name.includes(path.sep)) return fs.existsSync(name) ? name : "";
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const full = path.join(dir, name);
    if (fs.existsSync(full)) return full;
  }
  return "";
}

function parseRows(output, fields) {
  return String(output ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const values = line.split("|");
    return Object.fromEntries(fields.map((field, index) => [field, sanitizeSecretField(field, values[index] ?? "")]));
  });
}

function sanitizeSecretColumns(value) {
  const lines = String(value ?? "").split(/\r?\n/);
  if (lines.length === 0) return "";
  const header = lines.find((line) => line.includes("|")) ?? "";
  if (!header) return sanitize(value);
  const fields = header.split("|").map((field) => field.trim());
  return lines.map((line, lineIndex) => {
    if (lineIndex === 0 || !line.includes("|")) return sanitize(line);
    return line.split("|").map((cell, index) => sanitizeSecretField(fields[index] ?? "", cell)).join("|");
  }).join("\n").trim();
}

function sanitizeSecretField(field, value) {
  if (/(password|secret|token|api[_-]?key|private[_-]?key|conninfo|dsn|url|auth)/i.test(field)) return "<redacted>";
  return sanitize(value);
}

function sanitize(value) {
  let text = String(value ?? "");
  text = text.replace(/(postgres(?:ql)?:\/\/)([^:\s/@]+):([^@\s]+)@/gi, "$1<redacted>:<redacted>@");
  text = text.replace(/((?:DATABASE_URL|POSTGRES_URL|PGPASSWORD|PASSWORD|TOKEN|SECRET|API_KEY|PRIVATE_KEY|AUTH)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,}]+)/gi, "$1<redacted>");
  text = text.replace(/("?[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASS|API_KEY|PRIVATE_KEY|AUTH)[A-Z0-9_]*"?\s*:\s*)("[^"]*"|'[^']*'|[^\s,}]+)/gi, "$1\"<redacted>\"");
  text = text.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "<redacted-jwt>");
  return text.trim();
}

function parseFields(value, defaults, allowed) {
  if (!value) return defaults;
  const fields = value.split(",").map((field) => field.trim()).filter(Boolean);
  const unknown = fields.find((field) => !allowed.includes(field));
  if (unknown) usageError(`unknown field ${toonScalar(unknown)}`, [`valid fields: ${allowed.join(", ")}`]);
  return fields.length > 0 ? fields : defaults;
}

function parsePositiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) usageError(`${flag} must be a positive integer`, [`Run \`pg-axi activity ${flag} 20\``]);
  return parsed;
}

function pick(row, fields) {
  return Object.fromEntries(fields.map((field) => [field, row[field] ?? ""]));
}

function truncate(value, limit) {
  const text = String(value ?? "");
  if (text.length <= limit) return { text, truncated: false, total: text.length };
  return { text: `${text.slice(0, limit)}... (truncated, ${text.length} chars total)`, truncated: true, total: text.length };
}

function quoteIdent(value) {
  return `"${String(value).replaceAll("\"", "\"\"")}"`;
}

function quoteQualified(value) {
  return String(value).split(".").map(quoteIdent).join(".");
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function safeRead(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function findFiles(root, predicate, maxDepth, depth = 0) {
  if (depth > maxDepth) return [];
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (["node_modules", ".git", "coverage"].includes(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...findFiles(full, predicate, maxDepth, depth + 1));
    else if (predicate(full)) files.push(full);
  }
  return files;
}

function dedupeTargets(targets) {
  const seen = new Set();
  return targets.filter((target) => {
    if (seen.has(target.id)) return false;
    seen.add(target.id);
    return true;
  });
}

function connectionLabel(context) {
  if (context.service) return `service:${context.service}`;
  if (context.url) return sanitize(context.url);
  const parts = [];
  if (context.user) parts.push(`user:${context.user}`);
  if (context.host) parts.push(`host:${context.host}`);
  if (context.port) parts.push(`port:${context.port}`);
  if (context.database) parts.push(`db:${context.database}`);
  return parts.join("|") || "default";
}

function formatCommand(command) {
  return [command.cmd, ...command.args.map((arg) => String(arg).includes(" ") ? `"${String(arg).replaceAll("\"", "\\\"")}"` : String(arg))].join(" ");
}

function formatTable(name, rows, fields) {
  const header = `${name}[${rows.length}]{${fields.join(",")}}:`;
  return [header, ...rows.map((row) => `  ${fields.map((field) => toonScalar(row[field])).join(",")}`)].join("\n");
}

function formatHelp(items) {
  return [`help[${items.length}]:`, ...items.map((item) => `  ${item}`)].join("\n");
}

function toonScalar(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  const text = String(value);
  if (text === "") return "\"\"";
  const mustQuote = /[,\[\]{}:"#\n\r\t|]|^\s|\s$/.test(text);
  if (!mustQuote) return text;
  return `"${text.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"").replaceAll("\n", "\\n").replaceAll("\r", "\\r").replaceAll("\t", "\\t")}"`;
}

function collapseHome(filePath) {
  const home = os.homedir();
  return filePath.startsWith(home) ? `~${filePath.slice(home.length)}` : filePath;
}

function displayPath(filePath, cwd) {
  const relative = path.relative(cwd, filePath);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative;
  return collapseHome(filePath);
}

function hookTargets(agent, scope, context) {
  const selected = agent === "all" ? ["codex", "claude", "opencode"] : [agent];
  return selected.map((item) => {
    const absolutePath = hookPath(item, scope, context);
    return { agent: item, path: displayPath(absolutePath, context.cwd), absolutePath, status: fs.existsSync(absolutePath) ? "repair" : "create" };
  });
}

function hookPath(agent, scope, context) {
  if (agent === "codex") return scope === "project" ? path.join(context.cwd, ".codex", "hooks.json") : path.join(os.homedir(), ".codex", "hooks.json");
  if (agent === "claude") return scope === "project" ? path.join(context.cwd, ".claude", "settings.json") : path.join(os.homedir(), ".claude", "settings.json");
  return scope === "project" ? path.join(context.cwd, ".opencode", "pg-axi.json") : path.join(os.homedir(), ".config", "opencode", "plugins", "pg-axi.json");
}

function hookContent(agent) {
  const command = hookCommand();
  if (agent === "codex") return `${JSON.stringify({ SessionStart: [{ command }] }, null, 2)}\n`;
  if (agent === "claude") return `${JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command }] }] } }, null, 2)}\n`;
  return `${JSON.stringify({ name: "pg-axi", command }, null, 2)}\n`;
}

function hookCommand() {
  const installed = findExecutable("pg-axi");
  if (installed && path.resolve(installed) === path.resolve(process.argv[1])) return "pg-axi";
  return `${process.execPath} ${process.argv[1]}`;
}

function skillContent() {
  return `---\nname: pg-axi\ndescription: Use pg-axi to discover, create, inspect, query, back up, restore, and maintain PostgreSQL databases through safe TOON CLI workflows.\n---\n\n# pg-axi\n\nUse \`pg-axi\` when a task involves PostgreSQL databases, schemas, tables, indexes, roles, extensions, functions, queries, backups, restores, maintenance, activity, stats, replication, local Postgres, Docker Compose Postgres, or managed Postgres connection safety checks.\n\nRun \`pg-axi\` for live context. Use \`pg-axi doctor\` before database work. Discover targets with \`pg-axi discover\`. Inspect before mutating: \`pg-axi inspect --kind table --schema public --name <name>\`. Mutations require \`--execute\`; destructive operations also require \`--confirm <exact-name>\`.\n`;
}

function usageError(message, help, code = 2) {
  print([`error: ${message}`, formatHelp(help)].join("\n"));
  process.exit(code);
}

function runtimeError(message, help, code = 1) {
  print([`error: ${message}`, formatHelp(help)].join("\n"));
  process.exit(code);
}

function print(value) {
  process.stdout.write(value);
}

function helpHome() {
  return [
    `bin: ${toonScalar(collapseHome(process.argv[1]))}`,
    `description: ${toonScalar(DESCRIPTION)}`,
    "commands[18]{name,description}:",
    "  doctor,Check PostgreSQL client tools readiness connection and provider hints",
    "  services,List PostgreSQL capability domains",
    "  discover,Detect env compose migrations ORM and managed Postgres targets",
    "  recommend,Suggest PostgreSQL workflows for a goal",
    "  list,List databases schemas tables roles extensions and replication objects",
    "  inspect,Inspect server database schema table role extension and more",
    "  query,Run read-only SQL by default and guarded writes with --execute",
    "  create,Create database schema table index role extension or view with --execute",
    "  drop,Drop database schema table index role extension or view with --execute and --confirm",
    "  backup,Plan or run pg_dump",
    "  restore,Plan or run psql or pg_restore",
    "  maintenance,Plan or run analyze vacuum vacuum-full or reindex",
    "  activity,List active sessions",
    "  stats,List database table or index stats",
    "  kill,Terminate a backend with --execute and --confirm",
    "  hooks install,Install session context hooks",
    "  skill generate,Generate installable Agent Skill guidance",
    "examples[3]:",
    "  pg-axi",
    "  pg-axi list --kind tables --schema public",
    "  pg-axi inspect --kind table --schema public --name users"
  ].join("\n");
}

function helpDoctor() {
  return helpUsage("pg-axi doctor", "Check PostgreSQL client tools readiness connection and provider hints");
}
function helpServices() {
  return helpUsage("pg-axi services [--capability <name>] [--fields <csv>]", "List PostgreSQL capability domains");
}
function helpDiscover() {
  return helpUsage("pg-axi discover [--fields <csv>] [--full]", "Detect PostgreSQL project and provider targets");
}
function helpRecommend() {
  return helpUsage("pg-axi recommend --goal <inspect|create|schema|query|backup|restore|roles|extensions|performance|replication|managed|local-dev>", "Suggest PostgreSQL workflow paths");
}
function helpList() {
  return helpUsage("pg-axi list --kind <databases|schemas|tables|views|indexes|roles|extensions|functions|publications|subscriptions> [--schema <name>] [--fields <csv>]", "List PostgreSQL objects");
}
function helpInspect() {
  return helpUsage("pg-axi inspect --kind <server|database|schema|table|view|materialized-view|index|role|extension|function|publication|subscription> --name <name> [--schema <name>] [--full]", "Inspect PostgreSQL objects");
}
function helpQuery() {
  return helpUsage("pg-axi query --sql <sql>|--file <path> [--limit <n>] [--execute] [--full]", "Run read-only SQL by default and guarded writes with --execute");
}
function helpCreate() {
  return helpUsage("pg-axi create --kind <database|schema|table|index|role|extension|view> --name <name> [--execute]", "Create PostgreSQL objects with explicit execution");
}
function helpDrop() {
  return helpUsage("pg-axi drop --kind <database|schema|table|index|role|extension|view> --name <name> --confirm <name> [--execute]", "Drop PostgreSQL objects with destructive guards");
}
function helpBackup() {
  return helpUsage("pg-axi backup --database <name> --file <path> [--format plain|custom] [--execute]", "Plan or run pg_dump");
}
function helpRestore() {
  return helpUsage("pg-axi restore --database <name> --file <path> --confirm <name> [--clean --confirm-clean <name>] [--execute]", "Plan or run psql or pg_restore restore");
}
function helpMaintenance() {
  return helpUsage("pg-axi maintenance --action <analyze|vacuum|vacuum-full|reindex> [--target <name>] [--confirm <target>] [--execute]", "Plan or run PostgreSQL maintenance");
}
function helpActivity() {
  return helpUsage("pg-axi activity [--limit <n>]", "List active PostgreSQL sessions");
}
function helpStats() {
  return helpUsage("pg-axi stats [--kind database|tables|indexes] [--schema <name>] [--limit <n>]", "List PostgreSQL stats");
}
function helpKill() {
  return helpUsage("pg-axi kill --pid <pid> --confirm <pid> [--execute]", "Terminate a backend with explicit guards");
}
function helpHooksInstall() {
  return helpUsage("pg-axi hooks install [--agent codex|claude|opencode|all] [--scope user|project] [--execute]", "Install or preview session hooks");
}
function helpSkillGenerate() {
  return helpUsage("pg-axi skill generate [--output SKILL.md] [--check]", "Generate or verify installable Agent Skill guidance");
}

function helpUsage(usage, description) {
  return [
    `usage: ${usage}`,
    `description: ${description}`,
    "global_flags[8]{name,default,description}:",
    "  --cwd,\".\",Workspace root",
    "  --url,\"$DATABASE_URL\",PostgreSQL connection URL without printing credentials",
    "  --host,\"$PGHOST\",PostgreSQL host",
    "  --port,\"$PGPORT\",PostgreSQL port",
    "  --user,\"$PGUSER\",PostgreSQL user",
    "  --database,\"$PGDATABASE\",PostgreSQL database",
    "  --service,\"$PGSERVICE\",PostgreSQL service name",
    "  --help,false,Show this help",
    "examples[2]:",
    `  ${usage.replace(/\s?\[.*?\]/g, "").replace(/<[^>]+>/g, "example")}`,
    "  pg-axi doctor --database postgres"
  ].join("\n");
}
