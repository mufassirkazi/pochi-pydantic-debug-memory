/**
 * routes/generate.js — AI Image generation
 *
 * POST /generate-image
 *   Body: { prompt, style? }
 *   - Uses OpenAI DALL-E 3 if OPENAI_API_KEY is set
 *   - Otherwise: Pollinations.ai (free, no key needed, real AI generation)
 *   - Saves result to generated_images table
 *   - Returns { imageUrl, prompt, style }
 *
 * GET /generate-image/history
 *   Returns the current user's 24 most recent generations.
 *
 * Logfire events emitted:
 *   image_generated  — user_id, engine, prompt_length, style, status
 *   image_failed     — user_id, engine, error, status
 */

"use strict";

const { Router } = require("express");
const https      = require("https");
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

// ── Engine: OpenAI DALL-E 3 ──────────────────────────────────────────────
async function generateOpenAI(prompt, style) {
  const { default: OpenAI } = await import("openai");
  const client   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const full     = style ? `${prompt}, ${style}` : prompt;

  const response = await client.images.generate({
    model:   "dall-e-3",
    prompt:  full,
    n:       1,
    size:    "1024x1024",
    quality: "standard",
  });

  return response.data[0].url;
}

// ── Engine: Pollinations.ai (free, no key) ───────────────────────────────
function generatePollinations(prompt, style) {
  const full    = style ? `${prompt}, ${style}` : prompt;
  const encoded = encodeURIComponent(full);
  return Promise.resolve(
    `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&nologo=true&seed=${Date.now()}`
  );
}

// ── POST /generate-image ─────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const { prompt, style } = req.body;
  const userId            = req.session.userId;
  const requestId         = log.requestId();

  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: "Prompt is required" });
  }
  if (prompt.length > 500) {
    return res.status(400).json({ error: "Prompt is too long (max 500 characters)" });
  }

  const cleanPrompt = prompt.trim();
  const cleanStyle  = style?.trim() || null;
  const engine      = process.env.OPENAI_API_KEY ? "dall-e-3" : "pollinations";

  try {
    const imageUrl = process.env.OPENAI_API_KEY
      ? await generateOpenAI(cleanPrompt, cleanStyle)
      : await generatePollinations(cleanPrompt, cleanStyle);

    stmts.saveImage.run({
      userId,
      prompt:   cleanPrompt,
      style:    cleanStyle,
      imageUrl,
    });

    log.event("image_generated", {
      request_id:    requestId,
      user_id:       userId,
      engine,
      prompt_length: cleanPrompt.length,
      style:         cleanStyle ?? "none",
      status:        "ok",
    });

    res.json({ imageUrl, prompt: cleanPrompt, style: cleanStyle });
  } catch (err) {
    log.event("image_failed", {
      request_id:    requestId,
      user_id:       userId,
      engine,
      prompt_length: cleanPrompt.length,
      style:         cleanStyle ?? "none",
      status:        "error",
      error:         err.message,
    });
    res.status(500).json({ error: "Generation failed. Please try again." });
  }
});

// ── GET /generate-image/history ──────────────────────────────────────────
router.get("/history", (req, res) => {
  const userId    = req.session.userId;
  const requestId = log.requestId();
  const rows      = stmts.getUserImages.all(userId);

  log.event("history_fetched", {
    request_id:  requestId,
    user_id:     userId,
    image_count: rows.length,
    fields:      rows.length > 0 ? Object.keys(rows[0]) : [],
    sample_url:  rows[0]?.image_url ?? null,
    status:      "ok",
  });

  res.json({ images: rows });
});

module.exports = router;
