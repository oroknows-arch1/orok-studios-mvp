"use strict";

const { renderCoreVoiceBlock } = require("./voice");
const { renderSurfaceBlock, getSurfaceRules } = require("./formatting");
const { describeScheduleResolution } = require("./schedule");
const { renderGroundingBlock } = require("./grounding");
const { PROFILE_LABELS } = require("./types");

/**
 * Typed OROK prompt builder — single place for system + user prompt assembly.
 * Debug mode returns inspectable prompts without secrets.
 */
class OrokPromptBuilder {
  /**
   * @param {import("./types").ResolvedEditorialContext & {
   *   scheduleMeta?: { source: string, weekday: number|null },
   *   candidateCount?: number,
   *   debug?: boolean,
   * }} context
   */
  constructor(context) {
    if (!context || !context.profile) {
      throw new Error("OrokPromptBuilder requires a resolved editorial profile");
    }
    this.context = context;
    this.candidateCount = context.candidateCount || 3;
  }

  /**
   * @returns {{
   *   system: string,
   *   user: string,
   *   messages: Array<{role: string, content: string}>,
   *   meta: object,
   *   debug?: object
   * }}
   */
  build() {
    const { profile, surface, topic } = this.context;
    const surfaceRules = getSurfaceRules(surface);
    const system = this._buildSystem();
    const user = this._buildUser();
    const meta = {
      editorialProfile: profile.id,
      editorialProfileLabel: profile.label || PROFILE_LABELS[profile.id],
      surface,
      surfaceLabel: surfaceRules.label,
      stream: this.context.stream || null,
      category: this.context.category || null,
      topic,
      scheduledFor: this.context.scheduledFor || null,
      scheduleNote: this.context.scheduleMeta
        ? describeScheduleResolution(this.context.scheduleMeta)
        : null,
      requiresGrounding: profile.requiresGrounding,
      lengthTarget: profile.lengthTarget,
    };

    const result = {
      system,
      user,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      meta,
    };

    if (this.context.debug) {
      result.debug = {
        system,
        user,
        meta,
        // no secrets — prompts only
      };
    }

    return result;
  }

  _buildSystem() {
    const { profile, surface, voiceProfile } = this.context;
    const must = profile.must.map((m) => `- ${m}`).join("\n");
    const mustNot = profile.mustNot.map((m) => `- ${m}`).join("\n");

    return `You are the OROK Studios editorial writer.

You write only within the resolved OROK editorial profile. If the profile were missing, you would refuse — never produce generic motivational content.

${renderCoreVoiceBlock(voiceProfile)}

RESOLVED EDITORIAL PROFILE: ${profile.label} (${profile.id})
Purpose: ${profile.purpose}

Profile MUST:
${must}

Profile MUST NOT:
${mustNot}

Internal reasoning notes: ${profile.reasoningNotes}

Length target (editorial, where the destination permits): ${profile.lengthTarget.min || "—"}–${profile.lengthTarget.max || "—"} characters for the post body. Treat as a target, not a reason for awkward wording.
${surface === "x-post" ? "X posts must always obey the 280-character platform maximum including hashtags." : ""}

${renderSurfaceBlock(surface)}

OUTPUT SCHEMA:
- Create exactly ${this.candidateCount} candidate posts
- Separate each candidate with a line containing only ---
- Candidates must use meaningfully different openings, factual emphasis, narrative structure, and practical takeaways
- Candidates must NOT be simple paraphrases of one another
- Do NOT leak profile labels, section titles (Observation/Pattern/Coffee Break), or prompt instructions into the post
- Do NOT invent facts
`;
  }

  _buildUser() {
    const ctx = this.context;
    const scheduleNote = ctx.scheduleMeta
      ? describeScheduleResolution(ctx.scheduleMeta)
      : "n/a";

    const recent = (ctx.recentContext || []).slice(0, 12);
    const recentBlock = recent.length
      ? recent
          .map(
            (r, i) =>
              `${i + 1}. [${r.stream || "?"} / ${r.category || r.profile || "?"}] ${r.topic || "(no topic)"} — ${(r.text || "").slice(0, 120)}`
          )
          .join("\n")
      : "(no recent posts supplied)";

    const examples = ctx.examples || [];
    const exampleBlock = examples.length
      ? examples
          .map(
            (e, i) =>
              `Example ${i + 1} (${e.profile} / ${e.surface} / ${e.quality}):\n${e.text}\nNotes: ${e.notes || "reference pattern only"}`
          )
          .join("\n\n")
      : "(no approved examples loaded)";

    return `Write ${this.candidateCount} OROK candidates.

STREAM: ${ctx.stream || "(none)"}
CATEGORY: ${ctx.category || ctx.profile.label}
EDITORIAL PROFILE: ${ctx.profile.label}
OUTPUT SURFACE: ${ctx.surface}
SCHEDULE CONTEXT: ${scheduleNote}
SCHEDULED FOR: ${ctx.scheduledFor || "(not set)"}
TOPIC / SUBJECT: ${ctx.topic}

${renderGroundingBlock(ctx.grounding)}

WEEKLY SOURCE MATERIAL (Friday Recap when relevant):
${ctx.weeklyPosts || "No weekly posts provided."}

RECENT POST CONTEXT (avoid repeating cultures, people, openings, takeaways, or near-duplicates):
${recentBlock}

APPROVED OROK EXAMPLES (reference patterns ONLY — do NOT copy phrases, sentences, or distinctive wording):
${exampleBlock}

PROHIBITED:
- Copying example wording
- Generic self-help or influencer tone
- Inventing cultural/historical/biographical facts
- Mortgage assumptions (Long Game)
- Launch hype (Coffee Break Build)
- Exoticising or romanticising cultures (Cultural Series)
- Leaking internal labels into the post

Return ${this.candidateCount} candidates separated by --- only.
`;
  }
}

module.exports = { OrokPromptBuilder };
