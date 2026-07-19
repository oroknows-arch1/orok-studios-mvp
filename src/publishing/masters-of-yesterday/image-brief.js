"use strict";

/**
 * Heritage Lens image brief for Masters of Yesterday — uses existing
 * /generate-image system; does not replace the image engine.
 */
function buildHeritageLensBrief(entry, countryStream) {
  const groundingOk =
    entry &&
    entry.imageBehaviourSignal &&
    entry.imageEnvironment &&
    Array.isArray(entry.prohibitedVisualElements);

  if (!groundingOk) {
    return {
      imageBrief:
        "Heritage Lens — MANUAL REVIEW REQUIRED. Cultural grounding insufficient for automatic imagery. Do not generate generic tribal or mixed-culture scenes.",
      imageLens: "Heritage Lens",
      imageBehaviourSignal: null,
      imageCompositionSignature: null,
      requiresManualImageReview: true,
    };
  }

  const prohibited = [
    ...(entry.prohibitedVisualElements || []),
    "visible text",
    "captions",
    "logos",
    "fabricated maps",
    "fantasy",
    "generic tribal imagery",
    "costume-style staging",
    "fake ceremonies",
    "colonial stereotypes",
    "mixing cultures from different countries",
    "dramatic posed expressions",
    "generic AI mysticism",
    "inappropriate sacred imagery",
    "literal reconstruction presented as fact when evidence is weak",
  ];

  const people =
    /civilisation|civilization|waka tradition|cultural tradition/i.test(
      entry.subjectType || ""
    )
      ? "2–4 people engaged in everyday practice (non-identifiable, documentary)"
      : "a small family or community group (non-identifiable, documentary)";

  const objects = (entry.imageObjects || []).join(", ") || "only culturally supported everyday objects";

  const brief = `Create a realistic 4-panel documentary collage with warm natural lighting and no text.

HERITAGE LENS — Masters of Yesterday
Country stream: ${countryStream.label}
Cultural subject: ${entry.subject} (${entry.subjectType})
Region: ${entry.region || "as supported"}

BEHAVIOUR SIGNAL: ${entry.imageBehaviourSignal}
ENVIRONMENT: ${entry.imageEnvironment}
PEOPLE: ${people}
ACTIVITY: show culture through real behaviour — ${entry.imageBehaviourSignal}
SUPPORTED OBJECTS ONLY: ${objects}
CAMERA: observational, mid-distance documentary perspective; no portrait likeness of real public figures
LIGHTING / MOOD: natural daylight, calm, grounded, non-dramatic

STRICT PROHIBITIONS:
${prohibited.map((p) => `- ${p}`).join("\n")}

GLOBAL RULES:
- documentary realism only
- authentic environment for this country stream only
- no mixing cultures from other countries in the rotation
- no text overlays
- no fantasy or cinematic exaggeration`;

  const signature = [
    countryStream.id,
    entry.id,
    entry.imageBehaviourSignal,
    entry.imageEnvironment,
    (entry.imageObjects || []).slice(0, 2).join("|"),
  ].join("::");

  return {
    imageBrief: brief,
    imageLens: "Heritage Lens",
    imageBehaviourSignal: entry.imageBehaviourSignal,
    imageCompositionSignature: signature,
    requiresManualImageReview: false,
  };
}

module.exports = { buildHeritageLensBrief };
