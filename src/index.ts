#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createYnabMcpServer } from "./server.js";
// Compiled in rather than read from package.json at runtime: this server runs
// with no filesystem access, and a require() of package.json is a file read.
import { SERVER_VERSION } from "./version.js";

function parseTtlSecondsEnv(
  name: string,
  value: string | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(
      `Invalid ${name} value "${value}". Use a positive number of seconds.`,
    );
  }

  return seconds * 1000;
}

function parsePositiveIntEnv(
  name: string,
  value: string | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid ${name} value "${value}". Use a positive whole number.`,
    );
  }

  return parsed;
}

function parseBooleanEnv(
  name: string,
  value: string | undefined,
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "true" || value === "1") {
    return true;
  }

  if (value === "false" || value === "0") {
    return false;
  }

  throw new Error(
    `Invalid ${name} value "${value}". Use "true", "false", "1", or "0".`,
  );
}

async function main(): Promise<void> {
  const accessToken = process.env.YNAB_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error(
      "YNAB_ACCESS_TOKEN is not set. This server expects the token to be " +
        "injected into its environment at launch, so it never passes through " +
        "a config file or a caller.",
    );
  }

  const endpointUrl = process.env.YNAB_API_URL;

  // Where undo history is kept. Deliberately REQUIRED with no default: the
  // obvious fallback is a shared path under the home directory, and a shared
  // undo store lets one agent's undo history be read and rewritten by another
  // agent working a different task. The launcher supplies a directory unique to
  // the calling session, and the Deno sandbox grants write access to that
  // directory and nothing else.
  const dataDirectory = process.env.YNAB_MCP_DATA_DIR;
  if (!dataDirectory) {
    throw new Error(
      "YNAB_MCP_DATA_DIR is not set. It must name a directory private to this " +
        "session, where undo history is stored. There is no default on purpose: " +
        "a shared location would let concurrent sessions overwrite each other's " +
        "undo history.",
    );
  }

  const readOnly =
    parseBooleanEnv("YNAB_READ_ONLY", process.env.YNAB_READ_ONLY) ?? false;

  const cacheTtlMs = parseTtlSecondsEnv(
    "YNAB_CACHE_TTL",
    process.env.YNAB_CACHE_TTL,
  );
  const pastMonthCacheTtlMs = parseTtlSecondsEnv(
    "YNAB_PAST_MONTH_CACHE_TTL",
    process.env.YNAB_PAST_MONTH_CACHE_TTL,
  );
  const undoHistoryLimit = parsePositiveIntEnv(
    "YNAB_UNDO_HISTORY_LIMIT",
    process.env.YNAB_UNDO_HISTORY_LIMIT,
  );

  const { server } = createYnabMcpServer({
    accessToken,
    endpointUrl,
    dataDirectory,
    version: SERVER_VERSION,
    readOnly,
    cacheTtlMs,
    pastMonthCacheTtlMs,
    undoHistoryLimit,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
