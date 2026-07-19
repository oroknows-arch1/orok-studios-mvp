"use strict";

const GREETING = "Morning everyone 👋";
const SIGNOFF = "Enjoy the day love you all c u this arvo😘";

/**
 * Compose Masters of Yesterday family post in canonical OROK style.
 * @param {object} entry cultural catalogue entry
 * @param {object} countryStream
 * @returns {{familyText: string, xText: string, hashtags: string[], openingSentence: string, featuredFact: string}}
 */
function composeMastersOfYesterdayPost(entry, countryStream) {
  if (!entry || !Array.isArray(entry.verifiedFacts) || entry.verifiedFacts.length < 2) {
    return {
      familyText: "",
      xText: "",
      hashtags: [],
      openingSentence: "",
      featuredFact: "",
      reviewStatus: "Requires Review",
      reason: "insufficient approved facts",
    };
  }

  const intro = `${entry.subject} ${introClause(entry)}.`;
  const facts = entry.verifiedFacts.slice(0, 3).join(" ");
  const modern =
    entry.modernSignificance ||
    "This knowledge still matters for identity and care of place today.";

  const hashtags = normalizeHashtags(
    entry.suggestedHashtags,
    countryStream,
    entry.subject
  );

  const body = [intro, facts, modern].join(" ");
  const familyText = [GREETING, body, SIGNOFF, hashtags.join(" ")].join("\n");

  // Concise X version — same structure, slightly tighter body
  const xBody = [
    intro,
    entry.verifiedFacts[0],
    modern,
  ].join(" ");
  const xText = [GREETING, xBody, SIGNOFF, hashtags.join(" ")].join("\n");

  return {
    familyText,
    xText,
    hashtags,
    openingSentence: intro,
    featuredFact: entry.verifiedFacts[0],
    modernSignificance: modern,
    reviewStatus: entry.confidence === "low" ? "Requires Review" : "ready",
  };
}

function introClause(entry) {
  const type = entry.subjectType || "";
  const region = entry.region ? ` of ${entry.region}` : "";
  if (/iwi/i.test(type)) return `are an iwi${region}`;
  if (/waka/i.test(type)) return `form part of early Māori settlement memory${region}`;
  if (/civilisation|civilization/i.test(type)) return `shaped life${region}`;
  if (/island community/i.test(type)) return `is an island community${region}`;
  if (/Indigenous nation/i.test(type)) return `are original custodians${region}`;
  if (/people/i.test(type)) return `are a people${region}`;
  if (/cultural tradition/i.test(type)) return `is a cultural tradition${region}`;
  if (/ancestral community/i.test(type)) return `are an ancestral community${region}`;
  if (/historical confederation/i.test(type)) return `formed a historical confederation${region}`;
  return entry.shortSummary
    ? entry.shortSummary.replace(/\.$/, "")
    : `belong to living cultural history${region}`;
}

function normalizeHashtags(suggested, countryStream, subject) {
  const brand = "#OnlyRealOnesKnow";
  const mid =
    (suggested && suggested[1]) ||
    (countryStream && countryStream.hashtag
      ? `#${String(countryStream.hashtag).replace(/^#/, "")}`
      : "#Culture");
  const subjectTag =
    (suggested && suggested[2]) ||
    `#${String(subject || "Heritage")
      .replace(/[^a-zA-ZāēīōūĀĒĪŌŪŋŊ\s-]/g, "")
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join("")
      .slice(0, 28)}`;
  const tags = [brand, mid.startsWith("#") ? mid : `#${mid}`, subjectTag.startsWith("#") ? subjectTag : `#${subjectTag}`];
  // Exactly three
  return tags.slice(0, 3);
}

function assertCanonicalShape(text) {
  const errors = [];
  if (!text.startsWith(GREETING)) errors.push("missing greeting");
  if (!text.includes(SIGNOFF)) errors.push("missing signoff");
  const tags = text.match(/#\w+/g) || [];
  if (tags.length !== 3) errors.push(`expected exactly 3 hashtags, got ${tags.length}`);
  if (/did you know/i.test(text)) errors.push("contains Did you know");
  return errors;
}

module.exports = {
  GREETING,
  SIGNOFF,
  composeMastersOfYesterdayPost,
  normalizeHashtags,
  assertCanonicalShape,
};
