/**
 * routes/onboarding.js — Onboarding flow API
 *
 * GET /onboarding/for-user
 *   Returns the onboarding steps for the current session user.
 *
 * GET /onboarding/current
 *   Returns the raw config (admin use, no user context).
 *
 * POST /onboarding/complete
 *   Marks onboarding as done for the session user.
 *
 * Logfire events emitted:
 *   onboarding_served    — user_id, onboarding_variant, onboarding_version,
 *                          rollout_percentage, request_id, status
 *   onboarding_completed — user_id, onboarding_variant, request_id, status
 */

"use strict";

const { Router } = require("express");
const { stmts }  = require("../db");
const log        = require("../lib/logger");

const router = Router();

// Auth guard
router.use((req, res, next) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
});

// ── GET /onboarding/for-user ───────────────────────────────────────────────
router.get("/for-user", (req, res) => {
  const userId    = req.session.userId;
  const requestId = log.requestId();
  const user      = stmts.getUserById.get(userId);

  if (!user) {
    log.event("onboarding_served", {
      request_id: requestId,
      user_id:    userId,
      status:     "error",
      error:      "user_not_found",
    });
    return res.status(404).json({ error: "User not found" });
  }

  const config  = stmts.getOnboardingConfig.get();
  const variant = user.onboarding_variant ?? 1;
  const allSteps = JSON.parse(config.steps);

  // ── Structured Logfire event ─────────────────────────────────────────────
  log.event("onboarding_served", {
    request_id:         requestId,
    user_id:            userId,
    onboarding_variant: variant,
    onboarding_version: config.version,
    rollout_percentage: config.rollout_percentage,
    already_completed:  Boolean(user.onboarding_completed),
    status:             "ok",
  });

  res.json({
    variant,
    steps:              allSteps,
    config_version:     config.version,
    rollout_percentage: config.rollout_percentage,
    completed:          Boolean(user.onboarding_completed),
  });
});

// ── GET /onboarding/current ────────────────────────────────────────────────
router.get("/current", (req, res) => {
  const config = stmts.getOnboardingConfig.get();
  if (!config) return res.status(404).json({ error: "No onboarding config" });

  res.json({
    version:            config.version,
    rollout_percentage: config.rollout_percentage,
    steps:              JSON.parse(config.steps),
    updated_at:         config.updated_at,
  });
});

// ── POST /onboarding/complete ──────────────────────────────────────────────
router.post("/complete", (req, res) => {
  const userId    = req.session.userId;
  const requestId = log.requestId();
  const user      = stmts.getUserById.get(userId);

  stmts.completeOnboarding.run(userId);

  log.event("onboarding_completed", {
    request_id:         requestId,
    user_id:            userId,
    onboarding_variant: user?.onboarding_variant ?? null,
    status:             "ok",
  });

  res.json({ ok: true, redirect: "/app" });
});

module.exports = router;
