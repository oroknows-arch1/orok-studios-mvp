"use strict";

/** @type {import("../types").EditorialProfile} */
module.exports = {
  id: "coffee-break-build",
  label: "Coffee Break Build",
  purpose:
    "Document something actually being built — problem, decision, correction, test, or lesson — honestly and accessibly.",
  must: [
    "document something actually being built",
    "describe the current problem, decision, correction, test, or lesson",
    "distinguish clearly between idea, prototype, implementation, testing, deployment, and real-world use",
    "make the build understandable to a non-technical reader",
    "show progress honestly",
    "communicate the thinking behind the build, not just announce features",
  ],
  mustNot: [
    "pretend the project is further advanced than it is",
    "excessive technical jargon",
    "launch-style hype",
    "feature announcement without the thinking",
  ],
  lengthTarget: { min: 280, max: 420 },
  requiresGrounding: true,
  groundingKeys: ["stage", "problem", "lesson"],
  reasoningNotes:
    "Honest build observation → pattern in the decision/test → coffee-break signal about real progress.",
};
