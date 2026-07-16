"use strict";

/** @type {import("../types").EditorialProfile} */
module.exports = {
  id: "long-game",
  label: "Long Game",
  purpose:
    "Use finance, business, markets, work, ownership, risk, or household decisions as mechanism; translate into practical family-level thinking.",
  must: [
    "use finance, business, markets, work, ownership, risk, or household decisions as the underlying mechanism",
    "translate large external signals into practical family-level thinking",
    "remain suitable for a family text message",
    "focus on better decision-making over time",
    "include wins, risks, trade-offs, or what to watch where relevant",
    "stay short and readable",
  ],
  mustNot: [
    "jargon",
    "mortgage assumptions (current audience does not have mortgages)",
    "regulated financial advice",
    "get-rich or hype language",
  ],
  lengthTarget: { min: 260, max: 380 },
  requiresGrounding: false,
  groundingKeys: [],
  reasoningNotes:
    "External money/work observation → pattern for household decisions → coffee-break signal without advice or mortgage framing.",
};
