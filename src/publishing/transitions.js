"use strict";

const { TRANSITIONS, STATUSES } = require("./constants");

/**
 * Error thrown when an illegal status transition is attempted.
 */
class TransitionError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = "TransitionError";
    this.statusCode = 409;
  }
}

/**
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
function canTransition(from, to) {
  if (!STATUSES.includes(from) || !STATUSES.includes(to)) return false;
  return TRANSITIONS[from].includes(to);
}

/**
 * Assert a transition is legal or throw TransitionError.
 * @param {string} from
 * @param {string} to
 */
function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new TransitionError(
      `Illegal status transition: ${from} -> ${to}`
    );
  }
  return true;
}

module.exports = { TransitionError, canTransition, assertTransition };
