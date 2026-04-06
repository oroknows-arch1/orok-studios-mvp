const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
s
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const greeting = "Morning everyone 👋";
const signoff = "Enjoy the day love you all c u this arvo😘";
const maxChars = 500;

function soundsLikeHistoryLesson(text) {
  const badPatterns = [
    "is considered",
    "historically",
    "played a key role in",
    "significant contribution",
    "widely regarded as",
    "according to history",
    "throughout history",
  ];

  const lower = text.toLowerCase();
  return badPatterns.some((p) => lower.includes(p));
}

function soundsTooGeneric(text) {
  const badPhrases = [
    "embrace the journey",
    "unlock your potential",
    "step into your power",
    "foundation for tomorrow",
    "version of yourself",
    "believe in yourself",
    "transform your life",
  ];

  const lower = text.toLowerCase();
  return badPhrases.some((p) => lower.includes(p));
}

function cleanPost(post) {
  let text = post.trim();

  text = text.replace(/^Morning everyone.*\n?/i, "").trim();
  text = text.replace(/Enjoy the day.*$/i, "").trim();

  const reserved = greeting.length + signoff.length + 2;
  const room = maxChars - reserved;

  if (text.length > room) {
    text = text.slice(0, room).trim();
  }

  const sentenceMatches = text.match(/[^.!?]+[.!?]+/g);

  if (sentenceMatches && sentenceMatches.length > 0) {
    let rebuilt = "";

    for (const sentence of sentenceMatches) {
      const candidate = (rebuilt + " " + sentence.trim()).trim();
      if (candidate.length <= room) {
        rebuilt = candidate;
      } else {
        break;
      }
    }

    if (rebuilt.length > 0) {
      text = rebuilt.trim();
    }
  }

  if (!/[.!?]$/.test(text)) {
    const lastSentenceEnd = Math.max(
      text.lastIndexOf("."),
      text.lastIndexOf("!"),
      text.lastIndexOf("?")
    );

    if (lastSentenceEnd > 40) {
      text = text.slice(0, lastSentenceEnd + 1).trim();
    }
  }

  return `${greeting}\n${text}\n${signoff}`;
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.post("/generate", async (req, res) => {
  const { idea, category, weeklyPosts } = req.body;

  let extraCategoryRule = "";

  if (category === "Motivation Monday") {
    extraCategoryRule = `
- Tone should be direct, disciplined and action-based
- Focus on effort, consistency, discipline, pressure, persistence, or doing the work
- The post must contain 3 layers:
  1. a clear opening truth
  2. a deeper explanation of what that truth means
  3. a grounded real-world point or behavioural takeaway
- Keep the body between 260 and 360 characters
- 3 to 5 sentences maximum
- End with a complete thought that feels fully landed
`;
  } else if (category === "Masters of Today") {
    extraCategoryRule = `
- Tone should be respectful, factual, grounded and biographical
- Focus on a living person

MANDATORY DETAILS (must include at least 3 of these):
- age OR approximate life stage (young, teenager, early career, established etc)
- where they are from (country, region, background or origin)
- what they are known for (profession, field, role or craft)
- what stage they are at (emerging, active, established, influential, veteran etc)
- at least one clear achievement, contribution, body of work, milestone or recognised impact

STRUCTURE:
1. Identify the person clearly (name + role + origin if possible)
2. Include multiple factual details (NOT just one repeated point)
3. Add context around their stage, body of work or contribution
4. Explain why it matters now

STRICT RULES:
- Do NOT stay general
- Do NOT only repeat one achievement
- Do NOT describe personality, aura, energy or attitude
- This is a factual tribute, not a character observation
- Be informative first, reflective second

- Keep the body between 320 and 420 characters
- 4 to 6 sentences
- End with a complete thought
`;
  } else if (category === "Wisdom Wednesday") {
    extraCategoryRule = `
- Tone should be reflective, pattern-based and awareness-driven
- Focus on how life really works beneath the surface
- The post must contain 3 layers:
  1. an observation
  2. what that observation actually means
  3. why that matters in real life
- Keep the body between 260 and 360 characters
- 3 to 5 sentences maximum
- End with a complete thought
`;
  } else if (category === "Masters of Yesterday") {
    extraCategoryRule = `
- Tone should be respectful, factual, grounded and biographical
- Focus on historical people, cultures, groups, waka, or places

MANDATORY DETAILS (must include at least 3 of these):
- what or who the subject is
- where it is from or tied to
- what it is known for
- what it carried, built, represented or contributed
- at least one clear historical, cultural or legacy detail

STRUCTURE:
1. Identify the subject clearly
2. Include multiple factual details
3. Add context around its historical or cultural significance
4. Explain why it still matters today

STRICT RULES:
- Do NOT stay general
- Do NOT only repeat one point
- Do NOT sound like a textbook
- This is a factual tribute, not an artistic reflection
- Be informative first, reflective second

- Keep the body between 320 and 420 characters
- 4 to 6 sentences
- End with a complete thought
`;
  } else if (category === "Friday Recap") {
    extraCategoryRule = `
- Tone should be reflective, summarising and grounded
- Use the weekly posts provided as the source material
- Identify the shared pattern, lesson or theme across the week
- Do not simply repeat each day one by one
- Turn the week into one clear recap with depth
- Keep the body between 320 and 420 characters
- 4 to 6 sentences maximum
- End with a complete thought
`;
  } else if (category === "Friday Freestyle") {
    extraCategoryRule = `
- Tone should be lighter, more relaxed, human and slightly playful
- Still keep it grounded and real
- Keep the body between 260 and 340 characters
- 3 to 5 sentences maximum
- End with a complete thought
`;
  }

  try {
    const prompt = `
Create exactly 3 X post bodies.

Category: ${category}
Idea: ${idea}

WEEKLY SOURCE MATERIAL:
${weeklyPosts || "No weekly posts provided."}

VOICE:
- grounded
- blue collar
- calm
- direct
- simple wording
- real, not polished
- observational more than inspirational
- sounds like someone noticing how life really works
- not corporate
- not poetic
- not trying to sound smart
- not cheesy
- not like a motivational speaker

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
- do NOT include "${greeting}"
- do NOT include any sign-off
- write ONLY the body text
- start immediately with the message
- include 3 relevant hashtags at the end of the body
- MUST end with a complete sentence
- separate each post with --- only

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

    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const rawText = response.choices?.[0]?.message?.content || "";

    let posts = rawText
      .split("---")
      .map((p) => p.trim())
      .filter(Boolean);

    if (posts.length !== 3) {
      posts = rawText
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
        .slice(0, 3);
    }

    if (category === "Masters of Today" || category === "Masters of Yesterday") {
      const filteredHistory = posts.filter((p) => !soundsLikeHistoryLesson(p));
      if (filteredHistory.length === 3) {
        posts = filteredHistory;
      }
    }

    const filteredGeneric = posts.filter((p) => !soundsTooGeneric(p));
    if (filteredGeneric.length === 3) {
      posts = filteredGeneric;
    }

    const finalPosts = posts.map(cleanPost);

    res.json({ text: finalPosts.join("\n\n\n") });
  } catch (err) {
    console.error("SERVER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});