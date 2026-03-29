/**
 * routes/users.js
 *
 * GET /users
 *   Returns all users with their current assignment state.
 *   Useful for observing the inconsistency: after a flow update, some users
 *   will have assigned_variant set on a previous flow version while new users
 *   will get assigned on the current version.
 *
 * GET /users/:userId/assignments
 *   Returns the full assignment audit log for a single user, showing exactly
 *   which flow version they were served each time and whether it came from
 *   cache. This is the smoking gun when debugging stale-cache bugs.
 */

"use strict";

const { Router } = require("express");
const { stmts, db } = require("../db");
const log            = require("../lib/logger");

const router = Router();

// ── GET /users ─────────────────────────────────────────────────────────────
router.get("/", (req, res) => {
  const { segment } = req.query; // optional filter

  let users = stmts.getAllUsers.all();

  if (segment) {
    users = users.filter((u) => u.segment === segment);
    log.debug("GET /users", `Filtered by segment='${segment}'`, { count: users.length });
  }

  const flow = stmts.getLatestFlow.get();

  // Annotate each user with a staleness flag: if they were assigned on a
  // previous flow version their cache is technically stale.
  const assignmentCounts = db
    .prepare(`
      SELECT user_id, COUNT(*) AS total, SUM(cached) AS cached_hits
      FROM   variant_assignments
      GROUP  BY user_id
    `)
    .all()
    .reduce((acc, row) => {
      acc[row.user_id] = { total: row.total, cached_hits: row.cached_hits };
      return acc;
    }, {});

  const enriched = users.map((u) => ({
    ...u,
    cache_stale:
      u.assigned_variant !== null && flow
        ? (() => {
            // Find the flow version at assignment time via audit log
            const firstAssignment = db
              .prepare(`
                SELECT flow_version
                FROM   variant_assignments
                WHERE  user_id = ?
                ORDER  BY assigned_at ASC
                LIMIT  1
              `)
              .get(u.id);
            return firstAssignment
              ? firstAssignment.flow_version < flow.version
              : false;
          })()
        : false,
    assignment_stats: assignmentCounts[u.id] ?? { total: 0, cached_hits: 0 },
  }));

  log.info("GET /users", "Returning user list", {
    total:          enriched.length,
    assigned:       enriched.filter((u) => u.assigned_variant).length,
    stale:          enriched.filter((u) => u.cache_stale).length,
    currentFlowVersion: flow?.version ?? "N/A",
  });

  res.json({
    current_flow_version: flow?.version ?? null,
    users: enriched,
  });
});

// ── GET /users/:userId/assignments ─────────────────────────────────────────
router.get("/:userId/assignments", (req, res) => {
  const { userId } = req.params;

  const user = stmts.getUserById.get(userId);
  if (!user) {
    log.warn("GET /users/:userId/assignments", "User not found", { userId });
    return res.status(404).json({ error: `User '${userId}' not found` });
  }

  const history = db
    .prepare(`
      SELECT id, flow_version, variant, cached, assigned_at
      FROM   variant_assignments
      WHERE  user_id = ?
      ORDER  BY assigned_at DESC
    `)
    .all(userId);

  const flow = stmts.getLatestFlow.get();

  // Detect version drift: requests where the served flow_version != current
  const driftCount = history.filter(
    (h) => flow && h.flow_version !== flow.version
  ).length;

  log.info("GET /users/:userId/assignments", "Assignment history retrieved", {
    userId,
    userName:       user.name,
    totalRequests:  history.length,
    driftCount,
    currentFlowVersion: flow?.version ?? "N/A",
  });

  res.json({
    user: {
      id:               user.id,
      name:             user.name,
      segment:          user.segment,
      assigned_variant: user.assigned_variant,
      assigned_at:      user.assigned_at,
    },
    current_flow_version: flow?.version ?? null,
    assignment_history:   history,
    diagnostics: {
      total_requests:       history.length,
      stale_cache_hits:     history.filter((h) => h.cached).length,
      fresh_assignments:    history.filter((h) => !h.cached).length,
      version_drift_count:  driftCount,
    },
  });
});

// ── GET /users/:userId/reset — clear cached assignment (for testing) ───────
router.delete("/:userId/assignment", (req, res) => {
  const { userId } = req.params;

  const user = stmts.getUserById.get(userId);
  if (!user) {
    return res.status(404).json({ error: `User '${userId}' not found` });
  }

  db.prepare(`
    UPDATE users
    SET    assigned_variant = NULL,
           assigned_at      = NULL
    WHERE  id = ?
  `).run(userId);

  log.info(
    "DELETE /users/:userId/assignment",
    "Variant cache cleared manually",
    { userId, userName: user.name }
  );

  res.json({
    message: `Variant cache cleared for user '${userId}'`,
    user_id: userId,
  });
});

module.exports = router;
