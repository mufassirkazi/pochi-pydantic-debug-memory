/**
 * routes/session.js — Email-based passwordless authentication
 *
 * POST /session/login
 *   Body: { email }
 *   - Validates email format
 *   - Looks up user by email (case-insensitive)
 *   - If new: creates user, assigns onboarding variant via rollout hash
 *   - Sets session cookie
 *   - Returns { ok, redirect } — client handles navigation
 *
 * GET /session/me
 *   Returns the currently authenticated user or 401.
 *
 * POST /session/logout
 *   Destroys the server session + clears cookie.
 *
 * Logfire events emitted:
 *   session_login   — user_id, email, is_new_user, onboarding_variant, status
 *   session_logout  — user_id, status
 */

"use strict";

const { Router } = require("express");
const crypto     = require("crypto");
const { stmts }  = require("../db");
const { assignVariant } = require("../lib/rollout");
const log        = require("../lib/logger");

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── POST /session/login ────────────────────────────────────────────────────
router.post("/login", (req, res) => {
  const raw = req.body?.email;

  if (!raw || typeof raw !== "string") {
    return res.status(400).json({ error: "Email is required" });
  }

  const email = raw.trim().toLowerCase();

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Please enter a valid email address" });
  }

  const requestId = log.requestId();
  let user  = stmts.getUserByEmail.get(email);
  let isNew = false;

  if (!user) {
    // ── New user — assign onboarding variant deterministically ──────────────
    const id      = crypto.randomUUID();
    const config  = stmts.getOnboardingConfig.get();
    const rollout = config?.rollout_percentage ?? 50;

    // bucket < rollout → variant 2 (improved flow), else → variant 1 (classic)
    const { variant: side, bucket } = assignVariant(id, rollout);
    const onboardingVariant = side === "treatment" ? 2 : 1;

    stmts.createUser.run({ id, email, variant: onboardingVariant });
    user  = stmts.getUserById.get(id);
    isNew = true;

    log.event("session_login", {
      request_id:         requestId,
      user_id:            id,
      email,
      is_new_user:        true,
      onboarding_variant: onboardingVariant,
      rollout_percentage: rollout,
      bucket,
      status:             "ok",
    });
  } else {
    log.event("session_login", {
      request_id:           requestId,
      user_id:              user.id,
      email,
      is_new_user:          false,
      onboarding_variant:   user.onboarding_variant,
      onboarding_completed: Boolean(user.onboarding_completed),
      status:               "ok",
    });
  }

  req.session.regenerate((err) => {
    if (err) {
      log.event("session_login", {
        request_id: requestId,
        email,
        status:     "error",
        error:      err.message,
      });
      return res.status(500).json({ error: "Authentication failed" });
    }

    req.session.userId = user.id;
    const redirect = user.onboarding_completed ? "/app" : "/onboarding";
    res.json({ ok: true, redirect });
  });
});

// ── GET /session/me ────────────────────────────────────────────────────────
router.get("/me", (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });

  const user = stmts.getUserById.get(userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: "Session expired" });
  }

  res.json({
    id:                   user.id,
    email:                user.email,
    onboarding_completed: Boolean(user.onboarding_completed),
  });
});

// ── POST /session/logout ───────────────────────────────────────────────────
router.post("/logout", (req, res) => {
  const userId    = req.session?.userId;
  const requestId = log.requestId();

  req.session.destroy((err) => {
    if (err) {
      log.event("session_logout", {
        request_id: requestId,
        user_id:    userId ?? null,
        status:     "error",
        error:      err.message,
      });
      return res.status(500).json({ error: "Logout failed" });
    }

    res.clearCookie("lumina.sid");

    log.event("session_logout", {
      request_id: requestId,
      user_id:    userId ?? null,
      status:     "ok",
    });

    res.json({ ok: true });
  });
});

// ── GET /session/preferences ───────────────────────────────────────────────
router.get("/preferences", (req, res) => {
  const userId    = req.session?.userId;
  const requestId = log.requestId();

  if (!userId) return res.status(401).json({ error: "Not authenticated" });

  const user = stmts.getUserById.get(userId);
  if (!user) return res.status(401).json({ error: "Session expired" });

  const payload = {
    credits_balance:   50,
    credits_used:      0,
    beta_credits:      0,
    default_style:     'digital art',
    history_limit:     24,
    ui_hints:          { show_style_row: true, show_history: true },
  };

  log.event("preferences_loaded", {
    request_id:        requestId,
    user_id:           userId,
    payload_keys:      Object.keys(payload).join(","),
    credits_remaining: payload.credits_remaining ?? null,
    credits_balance:   payload.credits_balance   ?? null,
    credits_used:      payload.credits_used      ?? null,
    default_style:     payload.default_style     ?? null,
    status:            "ok",
  });

  res.json(payload);
});

module.exports = router;
