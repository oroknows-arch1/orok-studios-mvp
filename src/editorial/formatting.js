"use strict";

const { GREETING, SIGNOFF } = require("../generator/constants");

/**
 * Output-surface formatting rules for OROK posts.
 */

const FAMILY_GREETING = GREETING;
const FAMILY_SIGNOFF = SIGNOFF;

const SURFACE_RULES = Object.freeze({
  "family-message": Object.freeze({
    id: "family-message",
    label: "Family message",
    greeting: FAMILY_GREETING,
    signoff: FAMILY_SIGNOFF,
    requireGreeting: true,
    requireSignoff: true,
    allowHashtags: false,
    maxChars: null, // editorial length targets apply to body
    description:
      "Family message surface. Must begin with the exact greeting and end with the exact closing. No hashtags unless explicitly configured.",
  }),
  "x-post": Object.freeze({
    id: "x-post",
    label: "X post",
    greeting: null,
    signoff: null,
    requireGreeting: false,
    requireSignoff: false,
    allowHashtags: true,
    exactHashtagCount: 3,
    maxChars: 280,
    description:
      "X post surface. Maximum 280 characters. Exactly 3 hashtags. No family greeting or closing. No thread unless explicitly requested. No filler hashtags.",
  }),
});

/**
 * @param {import("./types").OutputSurface} surface
 */
function getSurfaceRules(surface) {
  const rules = SURFACE_RULES[surface];
  if (!rules) {
    throw new Error(`Unknown output surface: ${surface}`);
  }
  return rules;
}

/**
 * Wrap a body for the family-message surface.
 * @param {string} body
 */
function wrapFamilyMessage(body) {
  let text = String(body || "").trim();
  text = text.replace(/^Morning everyone.*\n?/i, "").trim();
  text = text.replace(/Enjoy the day.*$/i, "").trim();
  // Strip hashtags from family surface
  text = text.replace(/\n?#\w+(?:\s+#\w+)*/g, "").trim();
  return `${FAMILY_GREETING}\n${text}\n${FAMILY_SIGNOFF}`;
}

/**
 * @param {import("./types").OutputSurface} surface
 * @returns {string}
 */
function renderSurfaceBlock(surface) {
  const rules = getSurfaceRules(surface);
  if (surface === "family-message") {
    return `OUTPUT SURFACE: Family message
Required structure (exact greeting and closing — do not alter unless input explicitly requests a different surface):
${FAMILY_GREETING}
[post body]
${FAMILY_SIGNOFF}
- Do NOT include hashtags
- Do NOT invent a different greeting or sign-off
- Write the body only in your draft lines; the system will enforce greeting/closing
`;
  }
  return `OUTPUT SURFACE: X post
- Maximum ${rules.maxChars} characters total (including hashtags)
- Exactly ${rules.exactHashtagCount} hashtags on the final line
- NO family greeting
- NO family closing
- No thread unless explicitly requested
- No filler hashtags — use OROK-relevant tags (include one of #OurRootsOurKnowledge or #OnlyRealOnesKnow)
- Do NOT create a family post and trim it — write natively for this surface
`;
}

module.exports = {
  FAMILY_GREETING,
  FAMILY_SIGNOFF,
  SURFACE_RULES,
  getSurfaceRules,
  wrapFamilyMessage,
  renderSurfaceBlock,
};
