"use strict";

/**
 * Core OROK voice — inherited by every editorial profile.
 * Writing should sound like a blue-collar worker sharing something useful
 * during a morning coffee break.
 */

const CORE_VOICE = Object.freeze({
  traits: Object.freeze([
    "calm",
    "grounded",
    "observational",
    "concise",
    "clear",
    "human",
    "family-oriented where relevant",
  ]),
  mustNot: Object.freeze([
    "generic motivational language",
    "exaggerated praise",
    "corporate tone",
    "influencer tone",
    "empty inspiration",
    "vague AI-style conclusions",
    "unnecessary jargon",
    "invented facts",
    "forced emotional language",
  ]),
  posture:
    "Write like a blue-collar worker sharing something useful during a morning coffee break. Present the subject clearly, show why it matters, then leave the reader with a practical or reflective signal.",
});

/**
 * Internal OROK reasoning lens — never label these sections in the final post.
 */
const REASONING_LENS = Object.freeze({
  observationSignal:
    "Observation Signal: something factual, visible, historical, behavioural, or practical",
  patternSignal:
    "Pattern Signal: the deeper structure or repeated lesson underneath it",
  coffeeBreakSignal:
    "Coffee Break Signal: a grounded takeaway that connects naturally to everyday life",
  note: "Do NOT label these sections in the final post. They are internal writing logic only. The final post must read as one natural piece of writing.",
});

const GENERIC_SELF_HELP_PHRASES = Object.freeze([
  "believe in yourself",
  "never give up",
  "unlock your potential",
  "embrace the journey",
  "step into your power",
  "transform your life",
  "version of yourself",
  "foundation for tomorrow",
  "chase your dreams",
  "you got this",
  "live in harmony with nature",
  "harmony with nature",
]);

/**
 * @param {object|null|undefined} voiceProfile optional analyzed brand voice
 * @returns {string}
 */
function renderCoreVoiceBlock(voiceProfile) {
  const traits = CORE_VOICE.traits.map((t) => `- ${t}`).join("\n");
  const mustNot = CORE_VOICE.mustNot.map((t) => `- ${t}`).join("\n");
  let block = `OROK CORE VOICE (mandatory for every profile):
Traits:
${traits}

Must not:
${mustNot}

Posture:
${CORE_VOICE.posture}

OROK REASONING LENS (internal only — do not label in output):
- ${REASONING_LENS.observationSignal}
- ${REASONING_LENS.patternSignal}
- ${REASONING_LENS.coffeeBreakSignal}
${REASONING_LENS.note}
`;

  if (voiceProfile && typeof voiceProfile === "object") {
    block += `
OPTIONAL ANALYZED VOICE PROFILE (use as colour, never override core rules):
TONE: ${(voiceProfile.tone || []).map((t) => `- ${t}`).join("\n") || "- (none)"}
STYLE: ${(voiceProfile.style || []).map((s) => `- ${s}`).join("\n") || "- (none)"}
DO: ${(voiceProfile.doRules || []).map((r) => `- ${r}`).join("\n") || "- (none)"}
DON'T: ${(voiceProfile.dontRules || []).map((r) => `- ${r}`).join("\n") || "- (none)"}
`;
  }

  return block;
}

module.exports = {
  CORE_VOICE,
  REASONING_LENS,
  GENERIC_SELF_HELP_PHRASES,
  renderCoreVoiceBlock,
};
