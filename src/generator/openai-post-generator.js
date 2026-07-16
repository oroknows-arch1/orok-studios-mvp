"use strict";

const {
  buildOrokPrompt,
  resolveEditorialContext,
  validateCandidates,
  wrapFamilyMessage,
  EditorialResolutionError,
} = require("../editorial");
const { getHashtags } = require("./post-utils");

/**
 * OpenAI-backed PostGenerator.
 * Every real generation request must go through the canonical OROK editorial
 * prompt builder. Generic generation without a resolved profile is refused.
 */
class OpenAIPostGenerator {
  /**
   * @param {import("openai").default} openai
   * @param {{ model?: string }} [opts]
   */
  constructor(openai, opts = {}) {
    if (!openai) {
      throw new Error("OpenAIPostGenerator requires an OpenAI client");
    }
    this.openai = openai;
    this.model = opts.model || "gpt-4.1-mini";
  }

  /**
   * @param {object} input
   * @returns {Promise<{
   *   posts: string[],
   *   text: string,
   *   editorial: object,
   *   promptMeta: object,
   * }>}
   */
  async generatePosts(input = {}) {
    const context =
      input.editorialContext ||
      resolveEditorialContext({
        idea: input.idea,
        topic: input.topic || input.idea,
        category: input.category,
        stream: input.stream,
        surface: input.surface,
        scheduledFor: input.scheduledFor || input.plannedDate,
        grounding: input.grounding,
        weeklyPosts: input.weeklyPosts,
        voiceProfile: input.voiceProfile,
        recentContext: input.recentContext,
        profile: input.profile || input.editorialProfile,
      });

    if (!context || !context.profile) {
      throw new EditorialResolutionError(
        "No OROK editorial profile resolved — refusing generic generation",
        ["editorial profile is required"]
      );
    }

    const built = buildOrokPrompt({
      ...context,
      candidateCount: input.candidateCount || 3,
      debug: input.debug === true,
    });

    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: built.messages,
    });

    const rawText = response.choices?.[0]?.message?.content || "";
    const posts = formatCandidatesForSurface(
      rawText,
      context,
      input.idea || context.topic
    );

    const validated = validateCandidates(posts, context);

    return {
      posts: validated.candidates,
      text: validated.candidates.join("\n\n\n"),
      editorial: {
        editorialProfile: context.profile.id,
        editorialProfileLabel: context.profile.label,
        surface: context.surface,
        scheduleSource: context.scheduleMeta && context.scheduleMeta.source,
        validationStatus: "passed",
      },
      promptMeta: built.meta,
      debug: built.debug,
    };
  }
}

/**
 * Deterministic stub for tests. Never calls OpenAI.
 * When an editorialContext is provided, returns profile-aware fixtures that
 * pass validation (including Cultural Series grounding).
 */
class StubPostGenerator {
  /**
   * @param {object|Function} [impl]
   */
  constructor(impl) {
    this.impl = impl;
    this.calls = 0;
    this.lastPromptMeta = null;
  }

  async generatePosts(input = {}) {
    this.calls += 1;

    if (typeof this.impl === "function") {
      const result = await this.impl(input);
      if (result && result.fail) {
        throw result.fail instanceof Error
          ? result.fail
          : new Error("stub generation failed");
      }
      return finalizeStubResult(result, input);
    }

    if (this.impl && this.impl.fail) {
      throw this.impl.fail instanceof Error
        ? this.impl.fail
        : new Error("stub generation failed");
    }

    if (this.impl && Array.isArray(this.impl.posts)) {
      return finalizeStubResult({ posts: this.impl.posts }, input);
    }

    const context =
      input.editorialContext ||
      resolveEditorialContext({
        idea: input.idea || input.topic || "topic",
        topic: input.topic || input.idea || "topic",
        category: input.category,
        stream: input.stream,
        surface: input.surface || "family-message",
        scheduledFor: input.scheduledFor || input.plannedDate,
        grounding: input.grounding,
        weeklyPosts: input.weeklyPosts,
        profile: input.profile,
      });

    const built = buildOrokPrompt({ ...context, candidateCount: 3 });
    this.lastPromptMeta = built.meta;

    const posts = buildStubCandidates(context);
    const validated = validateCandidates(posts, context);

    return {
      posts: validated.candidates,
      text: validated.candidates.join("\n\n\n"),
      editorial: {
        editorialProfile: context.profile.id,
        editorialProfileLabel: context.profile.label,
        surface: context.surface,
        scheduleSource: context.scheduleMeta && context.scheduleMeta.source,
        validationStatus: "passed",
      },
      promptMeta: built.meta,
    };
  }
}

function finalizeStubResult(result, input) {
  const posts = result.posts || [];
  if (input.editorialContext || input.category || input.stream || input.profile) {
    const context =
      input.editorialContext ||
      resolveEditorialContext({
        idea: input.idea || input.topic || "topic",
        topic: input.topic || input.idea || "topic",
        category: input.category,
        stream: input.stream,
        surface: input.surface || "family-message",
        scheduledFor: input.scheduledFor,
        grounding: input.grounding,
        profile: input.profile,
      });
    const validated = validateCandidates(posts, context);
    return {
      posts: validated.candidates,
      text: validated.candidates.join("\n\n\n"),
      editorial: {
        editorialProfile: context.profile.id,
        editorialProfileLabel: context.profile.label,
        surface: context.surface,
        validationStatus: "passed",
      },
      promptMeta: buildOrokPrompt(context).meta,
    };
  }
  return { posts, text: posts.join("\n\n\n") };
}

/**
 * Build distinct stub candidates that satisfy profile validators.
 * @param {import("../editorial").resolveEditorialContext extends Function ? any : any} context
 */
function buildStubCandidates(context) {
  const surface = context.surface;
  const topic = context.topic;
  const g = context.grounding || {};
  const profileId = context.profile.id;

  if (profileId === "cultural-series") {
    const nation = g.nation || "the community";
    const region = g.region || "their Country";
    const practices = Array.isArray(g.practices) ? g.practices : [];
    const p1 = practices[0] || "seasonal work";
    const p2 = practices[1] || "local food practice";
    const p3 = practices[2] || "care of place";
    const continuity =
      g.continuity || "Cultural knowledge and custodianship continue today";

    const bodies = [
      `The ${topic} belong within the ${nation}, across ${region}. Their work included ${p1}, ${p2}, and ${p3} — practical skills tied to place, not a slogan. ${continuity}. Worth noticing how careful local knowledge still steadies ordinary decisions.`,
      `${region} holds ${topic} Country inside the ${nation}. Detail matters: ${p1}, then ${p2}, then ${p3}. ${continuity}. The takeaway is simple — respect starts with named facts, not romance.`,
      `Name the people first: ${topic}, ${nation}, ${region}. Practices such as ${p1}, ${p2}, and ${p3} show how place shaped daily work. ${continuity}. A coffee-break reminder: living culture is present tense.`,
    ];
    return bodies.map((b) => formatOne(b, surface, topic, profileId));
  }

  if (profileId === "coffee-break-build") {
    const stage = g.stage || "implementation";
    const problem = g.problem || "a real wiring gap";
    const lesson = g.lesson || "test before you announce";
    const bodies = [
      `Coffee Break Build update: still in ${stage}. Current problem — ${problem}. Not launched, not polished. Lesson so far: ${lesson}. Progress is the next honest step, not the press release.`,
      `Build note from ${stage}: we hit ${problem}. Fixing it taught ${lesson}. Calling this done would be hype; calling it in progress is accurate.`,
      `Today's build work stayed in ${stage}. The blocker was ${problem}. Takeaway — ${lesson}. Share the thinking, not a fake finish line.`,
    ];
    return bodies.map((b) => formatOne(b, surface, topic, profileId));
  }

  if (profileId === "long-game") {
    const bodies = [
      `Long game thinking on ${topic}: watch the trade-off, not the headline. Household decisions get clearer when you name the risk you can actually carry this year.`,
      `${topic} looks big from afar. Up close it is a series of small money and work choices. Ask what to watch this month, not what to fear forever.`,
      `A calm read on ${topic}: wins and risks both count. Better decisions compound when the family can explain the trade-off in plain words.`,
    ];
    return bodies.map((b) => formatOne(b, surface, topic, profileId));
  }

  if (profileId === "motivation") {
    const bodies = [
      `Most mornings the hard part is not the work — it is starting the same way when you do not feel like it. ${topic} gets easier when the routine carries you past the mood.`,
      `You notice ${topic} in small delays: the skipped prep, the late start. Discipline here is a repeated decision, not a speech.`,
      `When ${topic} shows up as friction, shrink the first step. One prepared action beats a loud promise.`,
    ];
    return bodies.map((b) => formatOne(b, surface, topic, profileId));
  }

  if (
    profileId === "masters-of-today" ||
    profileId === "masters-of-yesterday"
  ) {
    const facts = Array.isArray(g.facts) ? g.facts : flattenFacts(g);
    const f1 = facts[0] || `${topic} is clearly identified`;
    const f2 = facts[1] || "known for a specific body of work";
    const f3 = facts[2] || "working method shaped the outcome";
    const bodies = [
      `${f1}. ${f2}. ${f3}. The pattern is method over myth — useful when your own work feels noisy.`,
      `Subject first: ${topic}. Fact set — ${f1}; ${f2}; ${f3}. What lasts is the discipline underneath the highlight.`,
      `${topic}: ${f1}. Then ${f2}. Then ${f3}. Take the process home; leave the pedestal.`,
    ];
    return bodies.map((b) => formatOne(b, surface, topic, profileId));
  }

  // Default distinct bodies for wisdom / friday / saturday etc.
  const bodies = [
    `A quiet read on ${topic}: the surface detail is ordinary, the pattern underneath is repetition. Carry one clear action into the afternoon.`,
    `${topic} shows up in small choices before it shows up in big speeches. Notice the pattern, then keep the next step simple.`,
    `Looking at ${topic} without the hype — what repeats is usually the lesson. Hold that through the day.`,
  ];
  return bodies.map((b, i) => formatOne(b + ` (${i + 1})`, surface, topic, profileId));
}

function flattenFacts(g) {
  const out = [];
  for (const v of Object.values(g || {})) {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) out.push(...v.filter((x) => typeof x === "string"));
  }
  return out;
}

function formatOne(body, surface, topic, profileId) {
  if (surface === "x-post") {
    let text = body.trim();
    if (text.length > 240) text = text.slice(0, 240).trim();
    const tags = getHashtags(
      profileIdToLegacyCategory(profileId),
      topic
    );
    let out = `${text}\n${tags}`;
    if (out.length > 280) {
      const room = 280 - (tags.length + 1);
      out = `${text.slice(0, Math.max(0, room)).trim()}\n${tags}`;
    }
    return out;
  }
  return wrapFamilyMessage(body);
}

function profileIdToLegacyCategory(profileId) {
  const map = {
    motivation: "Motivation Monday",
    "masters-of-today": "Masters of Today",
    wisdom: "Wisdom Wednesday",
    "masters-of-yesterday": "Masters of Yesterday",
    "cultural-series": "Masters of Yesterday",
    "friday-recap": "Friday Recap",
    "friday-freestyle": "Friday Freestyle",
    "coffee-break-build": "Friday Freestyle",
    "long-game": "Wisdom Wednesday",
    "saturday-mixed": "Friday Freestyle",
  };
  return map[profileId] || "Motivation Monday";
}

/**
 * Parse model output and enforce surface formatting.
 */
function formatCandidatesForSurface(rawText, context, idea) {
  const surface = context.surface;
  // Reuse splitter; then re-apply surface rules (family wrap or X constraints)
  const legacyCategory = profileIdToLegacyCategory(context.profile.id);
  let posts = String(rawText || "")
    .split("---")
    .map((p) => p.trim())
    .filter(Boolean);

  if (posts.length !== 3) {
    posts = String(rawText || "")
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)
      .slice(0, 3);
  }

  if (surface === "family-message") {
    return posts.map((p) => wrapFamilyMessage(p));
  }

  // X: strip family wrappers if model added them; ensure hashtags
  return posts.map((p) => {
    let text = p
      .replace(/^Morning everyone.*\n?/i, "")
      .replace(/Enjoy the day.*$/i, "")
      .trim();
    const existing = text.match(/#[\w]+/g) || [];
    text = text.replace(/\n?#\w+(?:\s+#\w+)*/g, "").trim();
    const tags =
      existing.length === 3
        ? existing.join(" ")
        : getHashtags(legacyCategory, idea || context.topic);
    let out = `${text}\n${tags}`;
    if (out.length > 280) {
      const room = 280 - (tags.length + 1);
      out = `${text.slice(0, Math.max(0, room)).trim()}\n${tags}`;
    }
    return out;
  });
}

module.exports = {
  OpenAIPostGenerator,
  StubPostGenerator,
  // exported for tests
  buildStubCandidates,
  formatCandidatesForSurface,
};
