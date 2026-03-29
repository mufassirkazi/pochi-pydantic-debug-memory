/**
 * db.js — Lumina AI: SQLite schema + seed data
 *
 * Tables:
 *   users               — authenticated users with sticky onboarding assignment
 *   onboarding_versions — versioned onboarding configs with rollout control
 *   generated_images    — image generation audit log per user
 */

"use strict";

const Database = require("better-sqlite3");
const path     = require("path");

const DB_PATH = path.join(__dirname, "lumina.db");
const db      = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ── Schema ─────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id                   TEXT PRIMARY KEY,
    email                TEXT UNIQUE NOT NULL COLLATE NOCASE,
    onboarding_completed INTEGER NOT NULL DEFAULT 0,
    onboarding_variant   INTEGER DEFAULT NULL,
    created_at           TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS onboarding_versions (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    version            INTEGER NOT NULL DEFAULT 1,
    steps              TEXT    NOT NULL,
    rollout_percentage INTEGER NOT NULL DEFAULT 50
                         CHECK(rollout_percentage BETWEEN 0 AND 100),
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS generated_images (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL REFERENCES users(id),
    prompt     TEXT NOT NULL,
    style      TEXT DEFAULT NULL,
    image_url  TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── Seed onboarding configs ────────────────────────────────────────────────
const seedOnboarding = db.transaction(() => {
  const { cnt } = db.prepare("SELECT COUNT(*) AS cnt FROM onboarding_versions").get();
  if (cnt > 0) return;

  // ── Variant 1 — Classic linear flow ──────────────────────────────────────
  const v1Steps = JSON.stringify([
    {
      id:      "use_case",
      title:   "What brings you to Lumina?",
      subtitle:"We'll personalise your experience.",
      type:    "radio",
      options: [
        { value: "personal",      label: "Personal projects",   hint: "Art, hobbies, exploration" },
        { value: "professional",  label: "Professional work",   hint: "Marketing, design, business" },
        { value: "exploring",     label: "Just exploring",      hint: "See what's possible" },
      ],
    },
    {
      id:      "category",
      title:   "What will you create most?",
      subtitle:"Select the category that fits your work best.",
      type:    "list",
      options: [
        { value: "logos",          label: "Logos & branding" },
        { value: "illustrations",  label: "Illustrations & art" },
        { value: "product",        label: "Product photography" },
        { value: "portraits",      label: "Portraits & characters" },
        { value: "landscapes",     label: "Landscapes & environments" },
        { value: "other",          label: "Something else" },
      ],
    },
  ]);

  // ── Variant 2 — Visual, guided flow ──────────────────────────────────────
  const v2Steps = JSON.stringify([
    {
      id:      "category",
      title:   "What would you like to create?",
      subtitle:"Choose a category to get started.",
      type:    "cards",
      options: [
        { value: "logos",         label: "Logos",        icon: "🎨", desc: "Brand identities & icons" },
        { value: "illustrations", label: "Illustration", icon: "✏️",  desc: "Digital art & drawings" },
        { value: "product",       label: "Product",      icon: "📦", desc: "E-commerce & marketing" },
        { value: "portraits",     label: "Portraits",    icon: "🖼️",  desc: "People & characters" },
        { value: "landscapes",    label: "Landscapes",   icon: "🌄", desc: "Scenery & environments" },
        { value: "abstract",      label: "Abstract",     icon: "✨", desc: "Patterns & artistic work" },
      ],
    },
    {
      id:      "inspiration",
      title:   "See what's possible",
      subtitle:"Others are already creating incredible work.",
      type:    "examples",
      examples: [
        { prompt: "Minimalist geometric logo, clean lines, white background, SVG style", tag: "Logo" },
        { prompt: "Anime girl with silver hair in neon-lit cyberpunk cityscape, raining", tag: "Illustration" },
        { prompt: "Premium ceramic skincare bottle on white marble, botanical herbs, soft shadows", tag: "Product" },
      ],
    },
    {
      id:      "defaults",
      title:   "Personalise your style",
      subtitle:"These defaults will pre-fill your prompts. Change them anytime.",
      type:    "guided",
      suggestions: {
        style:    ["Photorealistic", "Digital art", "Oil painting", "Watercolor", "3D render", "Anime"],
        mood:     ["Vibrant", "Minimal", "Dramatic", "Soft & airy", "Dark & moody"],
        lighting: ["Natural light", "Golden hour", "Studio lighting", "Cinematic"],
      },
    },
  ]);

  const insert = db.prepare(`
    INSERT INTO onboarding_versions (version, steps, rollout_percentage)
    VALUES (?, ?, 50)
  `);

  insert.run(1, v1Steps);
  insert.run(2, v2Steps);

  console.log("[DB] Onboarding config seeded — variant 1 (classic) + variant 2 (visual), rollout=50%");
  console.log("[DB] Users with bucket < 50 → variant 2 (improved), others → variant 1 (classic)");
});

seedOnboarding();

// ── Prepared statements ────────────────────────────────────────────────────
const stmts = {
  // Users
  getUserById:    db.prepare(`SELECT * FROM users WHERE id = ?`),
  getUserByEmail: db.prepare(`SELECT * FROM users WHERE email = ? COLLATE NOCASE`),

  createUser: db.prepare(`
    INSERT INTO users (id, email, onboarding_variant)
    VALUES (@id, @email, @variant)
  `),

  completeOnboarding: db.prepare(`
    UPDATE users SET onboarding_completed = 1 WHERE id = ?
  `),

  // Onboarding config (always the latest row)
  getOnboardingConfig: db.prepare(`
    SELECT * FROM onboarding_versions ORDER BY id DESC LIMIT 1
  `),

  // Images
  saveImage: db.prepare(`
    INSERT INTO generated_images (user_id, prompt, style, image_url)
    VALUES (@userId, @prompt, @style, @imageUrl)
  `),

  getUserImages: db.prepare(`
    SELECT id, prompt, style, image_url, created_at
    FROM   generated_images
    WHERE  user_id = ?
    ORDER  BY created_at DESC
    LIMIT  24
  `),
};

module.exports = { db, stmts };
