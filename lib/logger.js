/**
 * lib/logger.js — Structured logger backed by OpenTelemetry spans → Logfire
 *
 * Logfire ingests OTLP *traces* (spans), not OTLP logs. Every structured
 * event is therefore emitted as a zero-duration span so it appears as a
 * log record in the Logfire UI and is queryable via the MCP query_run tool.
 *
 * Logfire span attribute conventions used here:
 *   logfire.msg_template   — the event name / message template
 *   logfire.span_type      — "log"
 *   logfire.level          — "info" | "warn" | "error"
 *
 * All application-specific fields (user_id, onboarding_variant, etc.) are
 * attached as flat span attributes — queryable as attributes->>'field' in SQL.
 *
 * Usage:
 *   const log = require('./logger');
 *
 *   // Raw levelled (drop-in for old logger):
 *   log.info('SERVER', 'listening on :3000');
 *
 *   // Structured event (preferred for routes):
 *   log.event('onboarding_served', {
 *     user_id:            userId,
 *     onboarding_variant: 2,
 *     onboarding_version: 1,
 *     status:             'ok',
 *   });
 */

"use strict";

const { trace, SpanStatusCode } = require("@opentelemetry/api");
const crypto = require("crypto");

const tracer = trace.getTracer("lumina-ai", "1.0.0");

// ── Console colours ────────────────────────────────────────────────────────
const CLR = {
  INFO:  "\x1b[32m",
  WARN:  "\x1b[33m",
  ERROR: "\x1b[31m",
  DEBUG: "\x1b[36m",
  RESET: "\x1b[0m",
};

// ── Core: emit a zero-duration span (appears as log record in Logfire) ─────
function emitSpan(level, spanName, attrs) {
  tracer.startActiveSpan(spanName, (span) => {
    // Logfire-specific metadata — makes it render as a log record
    span.setAttribute("logfire.msg_template", spanName);
    span.setAttribute("logfire.span_type",    "log");
    span.setAttribute("logfire.level",         level.toLowerCase());

    // Application attributes
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v !== undefined && v !== null) {
        span.setAttribute(k, String(v));
      }
    }

    if (level === "ERROR") {
      span.setStatus({ code: SpanStatusCode.ERROR });
    }

    span.end(); // zero-duration log record
  });
}

// ── Console printer ────────────────────────────────────────────────────────
function printConsole(level, component, message, attrs) {
  const ts     = new Date().toISOString();
  const colour = CLR[level] ?? CLR.INFO;
  const extra  = attrs && Object.keys(attrs).length ? " " + JSON.stringify(attrs) : "";
  const line   = `${colour}[${level}]${CLR.RESET} ${ts} [${component}] ${message}${extra}`;
  if (level === "ERROR") { console.error(line); } else { console.log(line); }
}

// ── Combined emit: span + console ─────────────────────────────────────────
function emit(level, component, message, attrs) {
  const allAttrs = { component, ...attrs };
  emitSpan(level, message, allAttrs);
  printConsole(level, component, message, attrs);
}

// ── Public API ─────────────────────────────────────────────────────────────
const log = {
  debug: (component, message, attrs) => emit("DEBUG", component, message, attrs),
  info:  (component, message, attrs) => emit("INFO",  component, message, attrs),
  warn:  (component, message, attrs) => emit("WARN",  component, message, attrs),
  error: (component, message, attrs) => emit("ERROR", component, message, attrs),

  /**
   * Emit a named structured event — the canonical route-level log call.
   *
   * Auto-adds: status ("ok"), request_id (16-char hex), timestamp (ISO).
   *
   * @param {string} eventName  e.g. "onboarding_served"
   * @param {object} attrs      key/value pairs — all queryable in Logfire
   */
  event(eventName, attrs = {}) {
    const record = {
      event:      eventName,
      status:     attrs.status    ?? "ok",
      request_id: attrs.request_id ?? log.requestId(),
      timestamp:  attrs.timestamp  ?? new Date().toISOString(),
      ...attrs,
    };

    // Span name = event name (becomes span_name in Logfire SQL)
    emitSpan("INFO", eventName, record);
    printConsole("INFO", "event", eventName, record);
  },

  /** Generate a short random correlation ID (16 hex chars). */
  requestId() {
    return crypto.randomBytes(8).toString("hex");
  },
};

module.exports = log;
