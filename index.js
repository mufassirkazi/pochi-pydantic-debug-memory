/**
 * index.js — Lumina AI: Image Generation Platform
 *
 * Page routes:
 *   GET  /           → redirect based on auth state
 *   GET  /login      → login page (redirect to /app if already authed)
 *   GET  /onboarding → onboarding (auth required, redirect if completed)
 *   GET  /app        → main image generation app (auth + onboarding required)
 *
 * API routes:
 *   POST /session/login
 *   GET  /session/me
 *   POST /session/logout
 *   GET  /onboarding/for-user
 *   GET  /onboarding/current
 *   POST /onboarding/complete
 *   POST /generate-image
 *   GET  /generate-image/history
 *   GET  /health
 */
require('dotenv').config();
"use strict";

// ── Telemetry MUST be the very first require ───────────────────────────────
// Registers the OTel SDK + global LoggerProvider before any instrumented code.
require("./lib/telemetry");

const express  = require("express");
const session  = require("express-session");
const path     = require("path");
const cors     = require("cors");
const log      = require("./lib/logger");
const { stmts } = require("./db");

const sessionRoutes    = require("./routes/session");
const onboardingRoutes = require("./routes/onboarding");
const generateRoutes   = require("./routes/generate");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(session({
  name:              "lumina.sid",
  secret:            process.env.SESSION_SECRET || "lumina-dev-secret-change-in-prod",
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

// Request logger — emits a structured http_request event for every response
app.use((req, res, next) => {
  const start     = Date.now();
  const requestId = log.requestId();
  res.on("finish", () => {
    const ms     = Date.now() - start;
    const userId = req.session?.userId ?? null;
    log.event("http_request", {
      request_id:    requestId,
      http_method:   req.method,
      http_path:     req.path,
      http_status:   res.statusCode,
      duration_ms:   ms,
      user_id:       userId,
      status:        res.statusCode < 400 ? "ok" : "error",
    });
  });
  next();
});

// ── Auth middleware ────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.redirect("/login");
  const user = stmts.getUserById.get(req.session.userId);
  if (!user) { req.session.destroy(() => {}); return res.redirect("/login"); }
  req.user = user;
  next();
}

function requireOnboardingComplete(req, res, next) {
  if (!req.user.onboarding_completed) return res.redirect("/onboarding");
  next();
}

// ── Page routes ────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  if (!req.session?.userId) return res.redirect("/login");
  const user = stmts.getUserById.get(req.session.userId);
  if (!user) return res.redirect("/login");
  return res.redirect(user.onboarding_completed ? "/app" : "/onboarding");
});

app.get("/login", (req, res) => {
  if (req.session?.userId) {
    const user = stmts.getUserById.get(req.session.userId);
    if (user) return res.redirect(user.onboarding_completed ? "/app" : "/onboarding");
  }
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/onboarding", requireAuth, (req, res) => {
  if (req.user.onboarding_completed) return res.redirect("/app");
  res.sendFile(path.join(__dirname, "public", "onboarding.html"));
});

app.get("/app", requireAuth, requireOnboardingComplete, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "app.html"));
});

// ── API routes ─────────────────────────────────────────────────────────────
app.use("/session",        sessionRoutes);
app.use("/onboarding",     onboardingRoutes);
app.use("/generate-image", generateRoutes);

// Health
app.get("/health", (_req, res) => {
  try {
    require("./db").db.prepare("SELECT 1").get();
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ status: "degraded", error: e.message });
  }
});

// 404
app.use((req, res) => {
  if (req.accepts("html")) return res.redirect("/login");
  res.status(404).json({ error: "Not found" });
});

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  log.error("UNHANDLED", err.message, { stack: err.stack });
  res.status(500).json({ error: "Internal server error" });
});

// ── Boot ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  log.info("SERVER", `Lumina AI running on http://localhost:${PORT}`);
  log.info("SERVER", `Image engine: ${process.env.OPENAI_API_KEY ? "DALL-E 3 (OpenAI)" : "Pollinations.ai (free)"}`);
  log.info("SERVER", "Pages: /login  /onboarding  /app");
});
