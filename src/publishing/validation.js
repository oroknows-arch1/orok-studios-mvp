"use strict";

const { STREAMS, STATUSES } = require("./constants");
const {
  streamAllowsSources,
  collectSourceErrors,
  MIN_SOURCES,
  MAX_SOURCES,
  isValidHttpUrl,
} = require("./long-game/sources");

/**
 * Error thrown when a publishing item or request body fails validation.
 * Carries a machine-readable list of field errors.
 */
class ValidationError extends Error {
  /**
   * @param {string} message
   * @param {string[]} [errors]
   */
  constructor(message, errors = []) {
    super(message);
    this.name = "ValidationError";
    this.errors = errors;
    this.statusCode = 400;
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isString(value) {
  return typeof value === "string";
}

/**
 * Validate an ISO-ish date string (YYYY-MM-DD or full ISO datetime).
 * @param {unknown} value
 */
function isValidDateString(value) {
  if (typeof value !== "string" || value.trim() === "") return false;
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed);
}

/**
 * Validate a full publishing item (used before persisting).
 * Returns a list of human-readable error strings (empty === valid).
 * @param {any} item
 * @returns {string[]}
 */
function collectItemErrors(item) {
  const errors = [];

  if (!item || typeof item !== "object") {
    return ["item must be an object"];
  }

  if (!isNonEmptyString(item.id)) errors.push("id is required");

  if (!STREAMS.includes(item.stream)) {
    errors.push(`stream must be one of: ${STREAMS.join(", ")}`);
  }

  if (!STATUSES.includes(item.status)) {
    errors.push(`status must be one of: ${STATUSES.join(", ")}`);
  }

  if (!isNonEmptyString(item.topic)) errors.push("topic is required");

  if (!isValidDateString(item.plannedDate)) {
    errors.push("plannedDate must be a valid date string");
  }

  if (!isValidDateString(item.generatedAt)) {
    errors.push("generatedAt must be a valid date string");
  }

  if (!isValidDateString(item.updatedAt)) {
    errors.push("updatedAt must be a valid date string");
  }

  if (
    typeof item.version !== "number" ||
    !Number.isInteger(item.version) ||
    item.version < 1
  ) {
    errors.push("version must be an integer >= 1");
  }

  if (!isString(item.text)) errors.push("text must be a string");

  if (typeof item.imageRequired !== "boolean") {
    errors.push("imageRequired must be a boolean");
  }

  if (
    item.seriesNumber !== undefined &&
    item.seriesNumber !== null &&
    (!Number.isInteger(item.seriesNumber) || item.seriesNumber < 1)
  ) {
    errors.push("seriesNumber must be a positive integer when present");
  }

  if (item.status === "rejected" && !isNonEmptyString(item.rejectionReason)) {
    errors.push("rejectionReason is required for rejected items");
  }

  if (item.status === "published" && !isValidDateString(item.publishedAt)) {
    errors.push("publishedAt is required for published items");
  }

  if (
    item.similarityKeys !== undefined &&
    (typeof item.similarityKeys !== "object" || item.similarityKeys === null)
  ) {
    errors.push("similarityKeys must be an object");
  }

  errors.push(...collectLongGameLedgerErrors(item));

  return errors;
}

/**
 * Ledger rules for Sunday Long Game intelligence fields and sources.
 * Other streams must not carry source links.
 * @param {any} item
 * @returns {string[]}
 */
function collectLongGameLedgerErrors(item) {
  const errors = [];
  const sources = item.sources;
  const hasSources = Array.isArray(sources) && sources.length > 0;

  if (!streamAllowsSources(item.stream)) {
    if (hasSources) {
      errors.push(
        "source links are only allowed on sunday-long-game items (not Motivation Monday, Words of Wisdom, Masters, or Coffee Break Build)"
      );
    }
    return errors;
  }

  // Sunday Long Game: when sources are present (or item is published), enforce 2–5 valid links.
  if (hasSources || item.status === "published") {
    if (!Array.isArray(sources)) {
      errors.push("sources must be an array for sunday-long-game items");
      return errors;
    }
    if (sources.length < MIN_SOURCES || sources.length > MAX_SOURCES) {
      errors.push(
        `sunday-long-game requires between ${MIN_SOURCES} and ${MAX_SOURCES} source links (got ${sources.length})`
      );
    }
    sources.forEach((s, i) => {
      errors.push(...collectSourceErrors(s, i));
    });
  } else if (sources !== undefined && !Array.isArray(sources)) {
    errors.push("sources must be an array when present");
  }

  return errors;
}

/**
 * Assert a full item is valid or throw ValidationError.
 * @param {any} item
 */
function assertValidItem(item) {
  const errors = collectItemErrors(item);
  if (errors.length > 0) {
    throw new ValidationError("Invalid publishing item", errors);
  }
  return true;
}

/**
 * Validate the body for creating a new draft/item.
 * Only a small set of fields are required; the service fills defaults.
 * @param {any} body
 * @returns {string[]}
 */
function collectCreateErrors(body) {
  const errors = [];
  if (!body || typeof body !== "object") return ["request body must be an object"];

  if (!STREAMS.includes(body.stream)) {
    errors.push(`stream must be one of: ${STREAMS.join(", ")}`);
  }
  if (!isNonEmptyString(body.topic)) errors.push("topic is required");
  if (!isValidDateString(body.plannedDate)) {
    errors.push("plannedDate must be a valid date string");
  }
  if (body.status !== undefined && !STATUSES.includes(body.status)) {
    errors.push(`status must be one of: ${STATUSES.join(", ")}`);
  }
  if (body.imageRequired !== undefined && typeof body.imageRequired !== "boolean") {
    errors.push("imageRequired must be a boolean");
  }
  if (body.text !== undefined && !isString(body.text)) {
    errors.push("text must be a string");
  }
  if (
    body.seriesNumber !== undefined &&
    body.seriesNumber !== null &&
    (!Number.isInteger(body.seriesNumber) || body.seriesNumber < 1)
  ) {
    errors.push("seriesNumber must be a positive integer when present");
  }
  errors.push(...collectSourcesBodyErrors(body));
  return errors;
}

/**
 * Validate the body for a PATCH update. All fields optional but typed.
 * @param {any} body
 * @returns {string[]}
 */
function collectPatchErrors(body) {
  const errors = [];
  if (!body || typeof body !== "object") return ["request body must be an object"];

  if (body.stream !== undefined && !STREAMS.includes(body.stream)) {
    errors.push(`stream must be one of: ${STREAMS.join(", ")}`);
  }
  if (body.topic !== undefined && !isNonEmptyString(body.topic)) {
    errors.push("topic must be a non-empty string");
  }
  if (body.plannedDate !== undefined && !isValidDateString(body.plannedDate)) {
    errors.push("plannedDate must be a valid date string");
  }
  if (body.text !== undefined && !isString(body.text)) {
    errors.push("text must be a string");
  }
  if (body.imageRequired !== undefined && typeof body.imageRequired !== "boolean") {
    errors.push("imageRequired must be a boolean");
  }
  if (
    body.seriesNumber !== undefined &&
    body.seriesNumber !== null &&
    (!Number.isInteger(body.seriesNumber) || body.seriesNumber < 1)
  ) {
    errors.push("seriesNumber must be a positive integer when present");
  }
  // status is intentionally NOT patchable directly: status changes must go
  // through the explicit transition endpoints (submit/approve/reject/etc).
  if (body.status !== undefined) {
    errors.push("status cannot be changed via PATCH; use the transition endpoints");
  }
  errors.push(...collectSourcesBodyErrors(body));
  return errors;
}

/**
 * Request-body source validation (create/patch). Does not require sources on
 * drafts; forbids sources on non-long-game streams.
 * @param {any} body
 * @returns {string[]}
 */
function collectSourcesBodyErrors(body) {
  const errors = [];
  if (body.sources === undefined) return errors;

  if (!Array.isArray(body.sources)) {
    errors.push("sources must be an array");
    return errors;
  }

  const stream = body.stream;
  if (stream && !streamAllowsSources(stream) && body.sources.length > 0) {
    errors.push(
      "source links are only allowed on sunday-long-game items"
    );
    return errors;
  }

  if (streamAllowsSources(stream) || (!stream && body.sources.length > 0)) {
    if (body.sources.length > 0) {
      if (
        body.sources.length < MIN_SOURCES ||
        body.sources.length > MAX_SOURCES
      ) {
        errors.push(
          `sunday-long-game requires between ${MIN_SOURCES} and ${MAX_SOURCES} source links`
        );
      }
      body.sources.forEach((s, i) => {
        errors.push(...collectSourceErrors(s, i));
      });
    }
  }
  return errors;
}

module.exports = {
  ValidationError,
  isNonEmptyString,
  isValidDateString,
  isValidHttpUrl,
  collectItemErrors,
  collectLongGameLedgerErrors,
  assertValidItem,
  collectCreateErrors,
  collectPatchErrors,
};
