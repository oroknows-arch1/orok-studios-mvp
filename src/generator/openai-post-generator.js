"use strict";

const {
  buildVoiceInstructions,
  categoryExtraRules,
  processGeneratedPosts,
} = require("./post-utils");
const { GREETING } = require("./constants");

/**
 * OpenAI-backed implementation of the PostGenerator interface.
 * Preserves the prompt construction and post-processing used by `/generate`.
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
   * Generate post candidates for an idea/category.
   * @param {{ idea: string, category: string, weeklyPosts?: string, voiceProfile?: object }} input
   * @returns {Promise<{ posts: string[], text: string }>}
   */
  async generatePosts(input = {}) {
    const idea = input.idea;
    const category = input.category;
    const weeklyPosts = input.weeklyPosts;
    const voiceProfile = input.voiceProfile;
    const extraCategoryRule = categoryExtraRules(category);

    const prompt = `
Create exactly 3 X post bodies.

Category: ${category}
Idea: ${idea}

WEEKLY SOURCE MATERIAL:
${weeklyPosts || "No weekly posts provided."}

VOICE:
${buildVoiceInstructions(voiceProfile)}

STYLE:
- write like a real person talking plainly
- use short to medium sentences
- one strong idea at a time
- often start with a normal surface-level point, then reveal the deeper pattern underneath
- matter-of-fact is good
- should feel human, not "written"
- do not rush the ending
- complete the thought fully
- For tribute categories, prioritise factual and biographical detail over interpretation
- Tribute posts should read like informed recognition, not artistic commentary
- Observation should only come after facts are established

AVOID:
- generic motivation phrases
- polished self-help language
- corporate or LinkedIn-style wording
- sounding like a speech
- overexplaining
- the words: unlock, transform, embrace the journey, step into your power
- vague personality analysis
- reading the subject's energy, aura or attitude
- making tribute posts sound like character commentary
- empty praise without facts

REQUIREMENTS:
- do NOT include "${GREETING}"
- do NOT include any sign-off
- write ONLY the body text
- start immediately with the message
- MUST end with a complete sentence
- separate each post with --- only

HASHTAG RULES (MANDATORY):
- Add EXACTLY 3 hashtags
- Include one rotating OROK brand hashtag: either #OurRootsOurKnowledge or #OnlyRealOnesKnow
- Include two other hashtags that are relevant to the topic and category
- Avoid repeating the same hashtags every time
- Do not default to generic pairs like #Discipline and #Growth unless they are truly necessary
- Put all 3 hashtags on the final line only
- Separate each hashtag with a space

BIOGRAPHICAL RULE:
- Include real-world identifying details where possible (age or life stage, origin, field, role, body of work, contribution, achievement)
- The post should help someone understand who the person or subject is, not just vaguely praise them
- Avoid vague descriptions — be specific

FACT DEPTH RULE:
- Each tribute post must contain at least 3 DIFFERENT pieces of information
- Do not repeat the same fact in different wording
- If input is limited, expand using context, background, pathway, body of work, contribution, or stage

TRIBUTE PRIORITY:
- If the category is Masters of Today or Masters of Yesterday, lead with facts
- Name what the person, group, culture or subject is known for
- Mention specific work, role, contribution, achievement, journey or legacy
- Only after that, explain why it matters

RECAP PRIORITY:
- If the category is Friday Recap, use the weekly source material to build the post
- Find the common thread across the week
- Summarise what the week was really pointing to
- Do not list the days one by one unless necessary

${extraCategoryRule}
`;

    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [{ role: "user", content: prompt }],
    });

    const rawText = response.choices?.[0]?.message?.content || "";
    const posts = processGeneratedPosts(rawText, category, idea);
    return {
      posts,
      text: posts.join("\n\n\n"),
    };
  }
}

/**
 * Deterministic stub for tests. Never calls OpenAI.
 */
class StubPostGenerator {
  /**
   * @param {{ posts?: string[] } | ((input: object) => { posts: string[] })} [impl]
   */
  constructor(impl) {
    this.impl = impl;
  }

  async generatePosts(input = {}) {
    if (typeof this.impl === "function") {
      const result = await this.impl(input);
      const posts = result.posts || [];
      return { posts, text: posts.join("\n\n\n") };
    }
    const posts =
      (this.impl && this.impl.posts) ||
      [
        `Morning everyone 👋\nStub post A about ${input.idea || "topic"}.\nEnjoy the day love you all c u this arvo😘\n#OnlyRealOnesKnow #Focus #RealTalk`,
        `Morning everyone 👋\nStub post B about ${input.idea || "topic"}.\nEnjoy the day love you all c u this arvo😘\n#OurRootsOurKnowledge #Mindset #Progress`,
        `Morning everyone 👋\nStub post C about ${input.idea || "topic"}.\nEnjoy the day love you all c u this arvo😘\n#OnlyRealOnesKnow #Consistency #Purpose`,
      ];
    return { posts, text: posts.join("\n\n\n") };
  }
}

module.exports = { OpenAIPostGenerator, StubPostGenerator };
