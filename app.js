const categorySelect = document.getElementById("category");
const weeklyPostsWrap = document.getElementById("weeklyPostsWrap");
const generateImageBtn = document.getElementById("generateImageBtn");
const imageStatus = document.getElementById("imageStatus");
const generatedImage = document.getElementById("generatedImage");
const selectedPostBox = document.getElementById("selectedPost");

let selectedPost = "";
let selectedCategory = "";
let selectedIdea = "";
let selectedWeeklyPosts = "";
let selectedImagePrompt = "";
let voiceProfile = null;

function toggleWeeklyPosts() {
  if (categorySelect.value === "Friday Recap") {
    weeklyPostsWrap.style.display = "block";
  } else {
    weeklyPostsWrap.style.display = "none";
  }
}

categorySelect.addEventListener("change", toggleWeeklyPosts);
toggleWeeklyPosts();

async function generatePosts() {
  const idea = document.getElementById("idea").value;
  const category = document.getElementById("category").value;
  const weeklyPosts = document.getElementById("weeklyPosts")?.value || "";

  const postsDiv = document.getElementById("posts");
  postsDiv.innerHTML = "Loading...";

  selectedPost = "";
  selectedPostBox.innerText = "";
  generateImageBtn.style.display = "none";
  imageStatus.innerText = "";
  generatedImage.style.display = "none";
  generatedImage.src = "";
  document.getElementById("imagePrompt").innerText = "";

  try {
    const res = await fetch("/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea, category, weeklyPosts, voiceProfile }),
    });

    const data = await res.json();

    if (!data.text) {
      postsDiv.innerHTML = "Server error: " + (data.error || "No posts returned.");
      console.log("Server returned:", data);
      return;
    }

    const posts = data.text.split("\n\n\n").filter(Boolean);

    postsDiv.innerHTML = "";

    posts.forEach((post) => {
      const div = document.createElement("div");
      div.className = "post";
      div.style.border = "1px solid #ccc";
      div.style.padding = "12px";
      div.style.marginTop = "10px";
      div.style.cursor = "pointer";
      div.style.whiteSpace = "pre-wrap";
      div.style.background = "white";
      div.innerText = post;

      const counter = document.createElement("div");
      counter.style.fontSize = "12px";
      counter.style.color = "#666";
      counter.style.marginTop = "8px";
      counter.innerText = `Characters: ${post.length}`;
      div.appendChild(counter);

      div.onclick = () => {
        document.querySelectorAll(".post").forEach((p) => {
          p.style.background = "white";
        });

        div.style.background = "#e8f0fe";

        selectedPost = post;
        selectedCategory = category;
        selectedIdea = idea;
        selectedWeeklyPosts = weeklyPosts;

        selectedImagePrompt = buildImagePrompt(post, category, idea, weeklyPosts);

        selectedPostBox.innerText = post;
        document.getElementById("imagePrompt").innerText = selectedImagePrompt;

        generateImageBtn.style.display = "block";
        imageStatus.innerText = "";
        generatedImage.style.display = "none";
        generatedImage.src = "";
      };

      postsDiv.appendChild(div);
    });
  } catch (error) {
    console.error(error);
    postsDiv.innerHTML = "Error connecting to server: " + error.message;
  }
}

function stripGreetingAndSignoff(post) {
  return post
    .replace(/^Morning everyone.*\n?/i, "")
    .replace(/Enjoy the day.*$/i, "")
    .trim();
}

function buildImagePrompt(post, category, idea, weeklyPosts) {
  const bodyOnly = stripGreetingAndSignoff(post);
  let prompt = "";

  if (category === "Motivation Monday") {
    prompt = `Create a realistic 4-panel family collage with warm natural lighting and no text.

STRUCTURE:
- Use a 5-member Polynesian / Pasifika family system:
  - two parents
  - 22-year-old
  - 18-year-old
  - 12–13-year-old daughter (dance-focused)

IDENTITY RULES:
- the family must look Polynesian / Pasifika
- realistic brown skin tones
- Polynesian facial features
- dark hair
- clear family resemblance across all panels
- do not default to white European-looking subjects

PANEL RULES (age-relevant activity required):
- Panel 1: 22-year-old doing structured effort (work, training, focused responsibility)
- Panel 2: 18-year-old doing a DIFFERENT skill activity (sport/study/practice)
- Panel 3: 12–13-year-old daughter doing a DIFFERENT focused activity (dance practice / repetition)
- Panel 4: parents actively guiding/teaching (not passive)

VISUAL VARIETY RULE:
- Each panel must show a different activity AND a different setting. No duplication.

MEANING:
The scenes must reflect this post:
"${bodyOnly}"

GLOBAL RULES:
- documentary realism only
- no text overlays
- no fantasy or cinematic exaggeration
- no uniforms or harsh institutional settings
- natural environments: home, park, beach, backyard, study space, everyday life
- emotion: calm, focused, steady effort
- avoid generic stock-photo feel`;
  } else if (category === "Masters of Today") {
    prompt = `Create a realistic 4-panel editorial-style collage with warm natural lighting and no text.

SUBJECT TYPE:
- a modern professional in entertainment or performance
- NOT any real person
- NOT a celebrity likeness
- NOT a recognizable public figure

SAFETY / LIKENESS RULES (MANDATORY):
- Do NOT depict any real living person or public figure
- Do NOT generate a direct likeness, portrait, or recognizable face
- Do NOT include any celebrity name in the image concept
- Do NOT recreate paparazzi, press, or red carpet photos of a real person
- If people appear, they must be generic, non-identifiable, and shown from a distance, from behind, in silhouette, or partially obscured

WHAT TO SHOW INSTEAD:
- editorial-style career context only
- film set atmosphere
- studio lighting rigs
- script pages on a table
- wardrobe and makeup station
- director chair and camera gear
- rehearsal spaces
- generic award/event atmosphere without faces
- behind-the-scenes entertainment industry environments

VISUAL GOAL:
- celebrate the field, craft, pressure, growth, and career environment
- no fan art
- no portrait
- no text overlays
- no fake labels
- grounded documentary/editorial realism only`;
  } else if (category === "Wisdom Wednesday") {
    prompt = `Create a realistic 4-panel family collage with warm natural lighting and no text.

STRUCTURE:
- Use a 5-member Polynesian / Pasifika family system:
  - two parents
  - 22-year-old
  - 18-year-old
  - 12–13-year-old daughter

IDENTITY RULES:
- the family must look Polynesian / Pasifika
- realistic brown skin tones
- Polynesian facial features
- dark hair
- clear family resemblance across all panels
- do not default to white European-looking subjects

PANEL RULES (age-relevant stillness/reflection):
- Panel 1: 22-year-old in quiet reflection (journaling, thinking, observing)
- Panel 2: 18-year-old paused in thought (sitting alone, looking out, quiet reset)
- Panel 3: 12–13-year-old in calm focus (dance practice, reading, drawing, concentration)
- Panel 4: parents in calm awareness (listening, present, quietly guiding)

VISUAL VARIETY RULE:
- Each panel must show a different activity AND a different setting. No duplication.

MEANING:
The visuals must reflect this Wisdom post:
"${bodyOnly}"

GLOBAL RULES:
- documentary realism only
- no text overlays
- no fantasy or surreal effects
- calm environments: home, nature, beach, yard, quiet room
- emotion: reflective, not dramatic
- avoid staged/stock-photo feel`;
  } else if (category === "Masters of Yesterday") {
    prompt = `Create a realistic 4-panel documentary collage with warm natural lighting and no text.

The tribute is:
"${bodyOnly}"

Subject:
${idea}

STRICT 4-PANEL RULES:
- Panel 1: culturally or historically grounded visual linked directly to the subject
- Panel 2: another historically or culturally relevant real-world visual linked to the subject
- Panel 3: a dedicated geographic context panel showing the real-world location tied to the subject
- Panel 4: a final panel showing living legacy, continuity, descendants, cultural continuation, tools, environment, or community relevance

MAP / LOCATION PANEL RULES:
- the map/location panel must be tied to the real subject location
- no fake labels, no gibberish, no invented cartography
- if labels are unreliable, remove them entirely rather than guessing
- no text overlays

GLOBAL RULES:
- factual, respectful, grounded
- no fantasy
- no cinematic exaggeration
- no costumes unrelated to the actual culture or time
- image should feel like real-world historical/cultural tribute`;
  } else if (category === "Friday Recap") {
    prompt = `Create a realistic 4-panel family collage with warm natural lighting and no text.

The recap post is:
"${bodyOnly}"

Weekly source material:
"${weeklyPosts}"

RULES:
- show reflection, completion, weekly learning, connection, continuity
- different panels should hint at different parts of the week without literal text
- documentary realism
- no fantasy
- no text overlays
- family-safe and emotionally believable`;
  } else if (category === "Friday Freestyle") {
    prompt = `Create a realistic 4-panel collage with warm natural lighting and no text.

The post is:
"${bodyOnly}"

RULES:
- lighter, relaxed, human feeling
- grounded and believable
- documentary realism
- no fantasy
- no text overlays
- everyday life, humour, ease, end-of-week release`;
  } else {
    prompt = `Create a realistic 4-panel collage with warm natural lighting and no text, aligned with this post:
"${bodyOnly}"`;
  }

  return prompt;
}
async function analyzeVoice() {
  const voiceInput = document.getElementById("voiceInput").value;
  const voiceResult = document.getElementById("voiceResult");

  if (!voiceInput.trim()) {
    voiceResult.innerText = "Please paste some business text first.";
    return;
  }

  voiceResult.innerText = "Analyzing voice...";

  try {
    const res = await fetch("/analyze-voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: voiceInput }),
    });

    const contentType = res.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      const text = await res.text();
      console.error("Non-JSON response from /analyze-voice:", text);
      voiceResult.innerText = "Voice analysis failed: server returned HTML instead of JSON.";
      return;
    }

    const data = await res.json();

    if (!data.result) {
      voiceResult.innerText =
        "Voice analysis failed: " + (data.error || "No result returned.");
      console.log("Voice route returned:", data);
      return;
    }

    voiceProfile = data.profile;
    voiceResult.innerText = data.result;
  } catch (error) {
    console.error(error);
    voiceResult.innerText = "Error analyzing voice: " + error.message;
  }
}