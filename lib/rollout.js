/**
 * lib/rollout.js — deterministic rollout bucketing.
 *
 * Uses a simple djb2-style hash so the same userId always maps to the same
 * bucket (0–99). This makes the rollout stable across restarts while still
 * producing apparent randomness across different user IDs.
 *
 * Bug surface:
 *   assignVariant() is only called when assigned_variant IS NULL.
 *   Once a user is cached, they keep their old variant even after the flow
 *   version changes — that's the deliberate inconsistency we're simulating.
 */

"use strict";

/**
 * Hash a string to an integer in [0, 99].
 * @param {string} str
 * @returns {number}
 */
function hashToBucket(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
    hash = hash >>> 0; // keep unsigned 32-bit
  }
  return hash % 100;
}

/**
 * Determine which variant a user should receive.
 *
 * @param {string}  userId            — stable user identifier
 * @param {number}  rolloutPercentage — 0..100; users whose bucket < this get 'treatment'
 * @returns {{ variant: 'treatment' | 'control', bucket: number }}
 */
function assignVariant(userId, rolloutPercentage) {
  const bucket = hashToBucket(userId);
  const variant = bucket < rolloutPercentage ? "treatment" : "control";
  return { variant, bucket };
}

module.exports = { assignVariant, hashToBucket };
