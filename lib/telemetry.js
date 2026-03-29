/**
 * lib/telemetry.js — OpenTelemetry bootstrap for Logfire
 *
 * Logfire receives data via OTLP **traces** (spans), not OTLP logs.
 * All structured events are emitted as zero-duration spans so they appear
 * as log records in the Logfire UI and are queryable via MCP.
 *
 * Environment variables:
 *   LOGFIRE_TOKEN     — Logfire WRITE token (required to send to Logfire cloud).
 *                       Must be a write token from:
 *                       https://logfire.pydantic.dev/<org>/<project>/settings/write-tokens/
 *                       Read/query tokens (used for MCP) will be rejected with 401.
 *   OTEL_SERVICE_NAME — overrides the service name reported in Logfire
 */

"use strict";

// Load .env before reading any env vars
require("dotenv").config();

const { diag, DiagConsoleLogger, DiagLogLevel } = require("@opentelemetry/api");
// Surface OTLP export errors (e.g. 401 Unauthorized) that BatchSpanProcessor
// swallows by default. Set to WARN to avoid verbose debug noise.
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

const { NodeSDK }             = require("@opentelemetry/sdk-node");
const { OTLPTraceExporter }   = require("@opentelemetry/exporter-trace-otlp-proto");
const { BatchSpanProcessor }  = require("@opentelemetry/sdk-trace-node");
const { resourceFromAttributes } = require("@opentelemetry/resources");

// ── Logfire OTLP endpoint ──────────────────────────────────────────────────
const LOGFIRE_ENDPOINT = "https://logfire-us.pydantic.dev";
const serviceName      = process.env.OTEL_SERVICE_NAME || "lumina-ai";

// Resolve the write token: env var takes precedence, then fall back to the
// credentials file written by `logfire auth` / the Pochi dev-session tool.
function resolveToken() {
  if (process.env.LOGFIRE_TOKEN) return process.env.LOGFIRE_TOKEN;
  try {
    const fs   = require("fs");
    const path = require("path");
    const creds = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", ".logfire", "logfire_credentials.json"), "utf8")
    );
    return creds.token ?? null;
  } catch {
    return null;
  }
}

const token = resolveToken();

const headers  = token ? { Authorization: token } : {};
const hasToken = Boolean(token);

// ── Resource ───────────────────────────────────────────────────────────────
const resource = resourceFromAttributes({
  "service.name":           serviceName,
  "service.version":        "1.0.0",
  "deployment.environment": process.env.NODE_ENV || "development",
});

// ── Trace exporter → Logfire /v1/traces ───────────────────────────────────
const traceExporter = new OTLPTraceExporter({
  url: `${LOGFIRE_ENDPOINT}/v1/traces`,
  headers,
});

const sdk = new NodeSDK({
  resource,
  spanProcessor: new BatchSpanProcessor(traceExporter, {
    maxExportBatchSize: 50,
    scheduledDelayMillis: 2000,   // flush every 2 s
    exportTimeoutMillis:  10000,
  }),
});

sdk.start();

// ── Graceful shutdown (flush remaining spans) ──────────────────────────────
function shutdown() {
  return sdk.shutdown().catch((err) => console.error("[telemetry] shutdown error:", err));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT",  () => shutdown().then(() => process.exit(0)));

if (hasToken) {
  console.log(`[telemetry] Logfire OTLP enabled → ${LOGFIRE_ENDPOINT} (service=${serviceName})`);
} else {
  console.warn("[telemetry] LOGFIRE_TOKEN not set — telemetry will NOT be exported to Logfire.");
}

module.exports = { sdk };
