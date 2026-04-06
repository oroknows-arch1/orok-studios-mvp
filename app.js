const categorySelect = document.getElementById("category");
const API_BASE_URL = "https://orok-studios-api.onrender.com";
const weeklyPostsWrap = document.getElementById("weeklyPostsWrap");

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

  try {
  const API_BASE_URL = "https://YOUR-RENDER-BACKEND-URL.onrender.com";

  const res = await fetch(`${API_BASE_URL}/generate`, {  
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ idea, category, weeklyPosts }),
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
        generateImagePrompt(post, category, idea, weeklyPosts);
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

function generateImagePrompt(post, category, idea, weeklyPosts) {
  const bodyOnly = stripGreetingAndSignoff(post);
  let prompt = "";

  if (category === "Motivation Monday") {
    prompt = `Create a realistic 4-panel family collage with warm natural lighting and no text.

STRUCTURE:
- Use a 5-member family system:
  - two parents
  - 22-year-old
  - 18-year-old
  - 12–13-year-old daughter (dance-focused)

PANEL RULES (age-relevant activity required):
- Panel 1: 22-year-old doing work, training, responsibility or focused effort
- Panel 2: 18-year-old in sport, study, or skill development
- Panel 3: 12–13-year-old daughter practicing dance or learning discipline
- Panel 4: parents guiding, supporting, or modelling structure (not passive)

MEANING:
The scenes must reflect this post:
"${bodyOnly}"

GLOBAL RULES:
- documentary realism only
- no text overlays
- no fantasy or cinematic exaggeration
- no uniforms or harsh institutional settings
- natural environments such as home, park, beach, backyard, study space or everyday life
- emotion is calm, focused, steady effort
- each panel must clearly connect to the meaning of the post
- avoid generic stock-photo feel`;
  } else if (category === "Masters of Today") {
    prompt = `Create a realistic 4-panel documentary-style collage with warm natural lighting and no text.

The tribute is:
"${bodyOnly}"

Subject:
${idea}

RULES:
- factual, profession-linked imagery
- no fake biography text in image
- no invented awards, signs, or labels
- show the subject's field, craft, setting, or achievement in a grounded way
- if the person is an athlete, show realistic sporting environments
- if the person is an actor, musician, public figure, or creator, show realistic work-related contexts
- 4 distinct panels
- no fantasy, no symbolic nonsense
- image should feel like informed visual tribute, not fan art`;
  } else if (category === "Wisdom Wednesday") {
    prompt = `Create a realistic 4-panel family collage with warm natural lighting and no text.

STRUCTURE:
- Use a 5-member family system:
  - two parents
  - 22-year-old
  - 18-year-old
  - 12–13-year-old daughter

PANEL RULES (age-relevant stillness/reflection):
- Panel 1: 22-year-old in quiet reflection such as sitting, journaling, observing, or thoughtful pause
- Panel 2: 18-year-old paused in thought such as looking out, sitting alone, or thinking quietly
- Panel 3: 12–13-year-old engaged in calm focused activity such as dance practice, reading, drawing, or still concentration
- Panel 4: parents in calm awareness such as listening, observing, sitting together, or being present

MEANING:
The visuals must reflect this Wisdom post:
"${bodyOnly}"

GLOBAL RULES:
- documentary realism only
- no text overlays
- no fantasy or surreal effects
- calm environments such as home, nature, beach, yard, quiet room, or everyday reflective spaces
- natural lighting
- emotion is reflective, not dramatic
- each panel must show a different angle of awareness, stillness, or pause
- avoid staged or stock-photo feel`;
  } else if (category === "Masters of Yesterday") {
    prompt = `Create a realistic 4-panel documentary collage with warm natural lighting and no text.

The tribute is:
"${bodyOnly}"

Subject:
${idea}

STRICT 4-PANEL RULES:
- Panel 1: culturally or historically grounded visual linked directly to the subject
- Panel 2: another historically or culturally relevant real-world visual linked to the subject
- Panel 3: a dedicated geographic context panel showing the real-world location, region, route, landing area, country, island group, or historical place tied to the subject
- Panel 4: a final panel showing living legacy, continuity, descendants, cultural continuation, gathering, tools, environment, or community relevance

MAP / LOCATION PANEL RULES:
- the map/location panel must be visually tied to the real subject location
- no fake labels
- no gibberish text
- no invented cartography
- if exact text labels are unreliable, use clean geographic visual context instead of fake writing
- do not place nonsense words on the map
- do not turn the map into fantasy art

GLOBAL RULES:
- factual, respectful, grounded
- no fantasy
- no cinematic exaggeration
- no costumes unrelated to the actual culture or time
- no text overlays anywhere
- image should feel like a real-world historical/cultural tribute, not a movie poster`;
  } else if (category === "Friday Recap") {
    prompt = `Create a realistic 4-panel family collage with warm natural lighting and no text.

The recap post is:
"${bodyOnly}"

Weekly source material:
"${weeklyPosts}"

RULES:
- show reflection, completion, weekly learning, connection, and continuity
- different panels should hint at different parts of the week without literally writing them
- grounded documentary realism
- no fantasy
- no text overlays
- family-safe and emotionally believable
- image should feel like a quiet end-of-week summary`;
  } else if (category === "Friday Freestyle") {
    prompt = `Create a realistic 4-panel collage with warm natural lighting and no text.

The post is:
"${bodyOnly}"

RULES:
- lighter, relaxed, human feeling
- still grounded and believable
- documentary realism
- no fantasy
- no text overlays
- show natural everyday life, humour, ease, or release at the end of the week`;
  } else {
    prompt = `Create a realistic 4-panel collage with warm natural lighting and no text, aligned with this post:
"${bodyOnly}"`;
  }

  document.getElementById("imagePrompt").innerText =
    "Image Prompt:\n" + prompt;
}