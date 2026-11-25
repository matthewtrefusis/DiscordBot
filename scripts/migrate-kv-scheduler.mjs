import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const config = readFileSync(join(root, "wrangler.toml"), "utf8");
const namespaceId = config.match(
  /binding\s*=\s*"FEEDBACK_CONFIG"[\s\S]*?id\s*=\s*"([^"]+)"/,
)?.[1];
const databaseName = config.match(
  /database_name\s*=\s*"([^"]+)"/,
)?.[1];
const dryRun = process.argv.includes("--dry-run");

if (!namespaceId || !databaseName) {
  throw new Error("Could not read the KV namespace or D1 database from wrangler.toml.");
}

function runWrangler(args) {
  return execFileSync(process.execPath, [wrangler, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function parseCommandJson(output) {
  const start = [output.indexOf("["), output.indexOf("{")]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  if (start === undefined) {
    throw new Error("Wrangler returned no JSON for a KV key listing.");
  }
  return JSON.parse(output.slice(start));
}

function listKeys(prefix) {
  const result = parseCommandJson(runWrangler([
    "kv",
    "key",
    "list",
    "--namespace-id",
    namespaceId,
    "--prefix",
    prefix,
    "--remote",
  ]));
  const keys = Array.isArray(result)
    ? result
    : result.keys ?? result.result;
  if (!Array.isArray(keys)) {
    throw new Error(`Wrangler returned an unexpected key listing for ${prefix}.`);
  }
  if (
    !Array.isArray(result) &&
    (result.list_complete === false || result.cursor)
  ) {
    throw new Error(
      `KV key listing for ${prefix} was paginated; complete the migration with Wrangler's full listing output.`,
    );
  }
  return keys
    .map((key) => key?.name)
    .filter((key) => typeof key === "string");
}

function getValue(key) {
  return runWrangler([
    "kv",
    "key",
    "get",
    key,
    "--namespace-id",
    namespaceId,
    "--remote",
    "--text",
  ]);
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlValue(value) {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return sqlString(value);
}

function insertStatement(row) {
  return `INSERT OR IGNORE INTO scheduled_items
    (item_type, item_key, due_at, lookup_key, reference_key, payload)
    VALUES (${row.map(sqlValue).join(", ")});`;
}

const rows = [];
for (const key of listKeys("reminder:")) {
  const match = /^reminder:([0-9a-f-]{36})$/.exec(key);
  if (!match) continue;
  let reminder;
  try {
    reminder = JSON.parse(getValue(key));
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error(`Skipping invalid reminder JSON at ${key}.`);
      continue;
    }
    throw error;
  }
  if (
    typeof reminder?.userId !== "string" ||
    !/^\d{17,20}$/.test(reminder.userId) ||
    typeof reminder.message !== "string" ||
    reminder.message.length === 0 ||
    reminder.message.length > 1000 ||
    typeof reminder.dueAt !== "number" ||
    !Number.isFinite(reminder.dueAt) ||
    typeof reminder.attempts !== "number" ||
    !Number.isInteger(reminder.attempts) ||
    reminder.attempts < 0
  ) {
    console.error(`Skipping malformed reminder at ${key}.`);
    continue;
  }
  rows.push([
    "reminder",
    match[1],
    reminder.dueAt,
    null,
    key,
    JSON.stringify(reminder),
  ]);
}

for (const key of listKeys("event-due:")) {
  const match = /^event-due:(\d{16}):(\d{17,20}):([0-9a-f-]{36})$/.exec(key);
  if (match) {
    rows.push([
      "event",
      `${match[2]}:${match[3]}`,
      Number(match[1]),
      null,
      key,
      null,
    ]);
  }
}

for (const key of listKeys("poll-reminder-due:")) {
  const match = /^poll-reminder-due:(\d{16}):([0-9a-f-]{36})$/.exec(key);
  if (match) {
    rows.push([
      "poll-reminder",
      match[2],
      Number(match[1]),
      null,
      key,
      null,
    ]);
  }
}

for (const key of listKeys("giveaway-due:")) {
  const match = /^giveaway-due:(\d{16}):([0-9a-f-]{36})$/.exec(key);
  if (match) {
    rows.push([
      "giveaway",
      match[2],
      Number(match[1]),
      null,
      key,
      null,
    ]);
  }
}

for (const key of listKeys("birthday-date:")) {
  const match = /^birthday-date:(\d{2})-(\d{2}):(\d{17,20}):(\d{17,20})$/
    .exec(key);
  if (match) {
    rows.push([
      "birthday",
      `${match[3]}:${match[4]}`,
      null,
      `${match[1]}-${match[2]}`,
      key,
      null,
    ]);
  }
}

for (const key of listKeys("stream-settings:")) {
  const match = /^stream-settings:(\d{17,20})$/.exec(key);
  if (match) {
    rows.push(["stream", match[1], null, null, null, null]);
  }
}

if (dryRun) {
  console.log(`Dry run: found ${rows.length} scheduled records to import.`);
  process.exit(0);
}

const tempDirectory = mkdtempSync(join(tmpdir(), "discordbot-d1-migration-"));
try {
  const batchSize = 100;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const sql = rows
      .slice(offset, offset + batchSize)
      .map(insertStatement)
      .join("\n");
    const sqlPath = join(tempDirectory, `batch-${offset}.sql`);
    writeFileSync(sqlPath, sql, "utf8");
    runWrangler([
      "d1",
      "execute",
      databaseName,
      "--remote",
      "--yes",
      "--file",
      sqlPath,
    ]);
  }
} finally {
  rmSync(tempDirectory, { recursive: true, force: true });
}

console.log(`Imported ${rows.length} legacy scheduled records into D1.`);
