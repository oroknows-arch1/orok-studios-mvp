require("dotenv").config();

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const path = require("path");
const { createPublishing, UI_FILE } = require("./src/publishing");
const { createGeneralHealthHandler } = require("./src/health");
const { createPostGenerator } = require("./src/generator");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
// Serve the static generator UI. `dotfiles: "ignore"` prevents a local .env (or
// any dotfile) from ever being served as a static asset.
app.use(express.static(__dirname, { dotfiles: "ignore" }));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Shared PostGenerator interface — used by both `/generate` and Publishing
// Draft Generation v0.4. Publishing never calls OpenAI directly.
const postGenerator = createPostGenerator(openai);

// Publishing System — review-first publishing workflow. Mounted alongside the
// existing generator; it does not alter generator routes. A configuration
// failure here (e.g. postgres selected without DATABASE_URL, or ephemeral
// storage in production) is fatal and reported clearly without secrets.
let publishing;
try {
  publishing = createPublishing({ postGenerator });
} catch (err) {
  console.error(
    "FATAL: cannot initialise publishing storage: " +
      (err && err.message ? err.message : "unknown error")
  );
  process.exit(1);
}
publishing.ready.catch((err) => {
  // A transient database problem must not take down the generator; it is
  // surfaced via the health endpoints instead. Log only the message (no stack,
  // no credentials).
  console.error(
    "PUBLISHING INIT WARNING: " + (err && err.message ? err.message : "init failed")
  );
});
app.use("/api/publishing", publishing.router);
app.get("/publishing", (req, res) => {
  res.sendFile(UI_FILE);
});

// General application health for the platform (Render) health check.
app.get("/health", createGeneralHealthHandler({ service: publishing.service }));

const voiceAgentPrompt = (input) => `
You are a Brand Voice Agent.

Analyse the writing sample and return ONLY valid JSON.

Use this exact structure:
{
  "tone": ["trait 1", "trait 2", "trait 3"],
  "style": ["pattern 1", "pattern 2", "pattern 3"],
  "vocabulary": ["pattern 1", "pattern 2", "pattern 3"],
  "positioning": "short brand positioning summary",
  "structure": "short explanation of how the content is structured",
  "voiceSummary": "short paragraph summary",
  "doRules": ["rule 1", "rule 2", "rule 3"],
  "dontRules": ["rule 1", "rule 2", "rule 3"]
}

Rules:
- Return JSON only
- No markdown
- No code fences
- Keep it human and grounded
- Do not exaggerate

INPUT:
"""
${input}
"""
`;

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.post("/analyze-voice", async (req, res) => {
  const { input } = req.body;

  try {
    const prompt = voiceAgentPrompt(input);

    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.choices?.[0]?.message?.content || "{}";
    const profile = JSON.parse(raw);

    res.json({
      profile,
      result: JSON.stringify(profile, null, 2),
    });
  } catch (err) {
    console.error("VOICE AGENT ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/generate", async (req, res) => {
  const { idea, category, weeklyPosts, voiceProfile } = req.body;

  try {
    // Existing generator UI path — same PostGenerator used by Publishing v0.4.
    const result = await postGenerator.generatePosts({
      idea,
      category,
      weeklyPosts,
      voiceProfile,
    });
    res.json({ text: result.text });
  } catch (err) {
    console.error("SERVER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/generate-image", async (req, res) => {
  const { imagePrompt } = req.body;

  try {
    console.log("GENERATE IMAGE HIT");
    console.log("IMAGE PROMPT PREVIEW:", (imagePrompt || "").slice(0, 300));

    const response = await openai.images.generate({
      model: "gpt-image-1",
      prompt: imagePrompt,
      size: "1024x1024",
    });

    const base64Image = response.data?.[0]?.b64_json;

    if (!base64Image) {
      console.log("NO IMAGE RETURNED FROM OPENAI");
      return res.status(500).json({
        error: "No image returned from OpenAI",
      });
    }

    console.log("IMAGE GENERATED SUCCESSFULLY");

    const imageUrl = `data:image/png;base64,${base64Image}`;
    res.json({ imageUrl });
  } catch (err) {
    console.error("IMAGE GENERATION ERROR FULL:", err);
    res.status(500).json({
      error:
        err?.response?.data?.error?.message ||
        err?.message ||
        "Unknown image generation error",
    });
  }
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  // Graceful shutdown: stop accepting connections, then close the publishing
  // storage (database pool) so deploys/restarts release resources cleanly.
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down gracefully...`);
    server.close(() => {
      Promise.resolve(publishing.close())
        .catch(() => {})
        .finally(() => {
          console.log("Shutdown complete.");
          process.exit(0);
        });
    });
    // Safety net: force exit if close hangs.
    setTimeout(() => process.exit(0), 10000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

module.exports = app;
