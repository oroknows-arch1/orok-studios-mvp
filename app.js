const categorySelect = document.getElementById("category");
const weeklyPostsWrap = document.getElementById("weeklyPostsWrap");
const tributeUploadWrap = document.getElementById("tributeUploadWrap");
const categoryHint = document.getElementById("categoryHint");
const generateImageBtn = document.getElementById("generateImageBtn");
const saveToLedgerBtn = document.getElementById("saveToLedgerBtn");
const prepareLongGameBtn = document.getElementById("prepareLongGameBtn");
const imageStatus = document.getElementById("imageStatus");
const generatedImage = document.getElementById("generatedImage");
const selectedPostBox = document.getElementById("selectedPost");

const PUB_API = "/api/publishing";
const STREAM_LABELS = {
  "orok-morning": "Morning OROK",
  "coffee-break-build": "Coffee Break Build",
  "saturday-mixed": "Saturday Mixed",
  "sunday-long-game": "Sunday Long Game",
};

let selectedPost = "";
let selectedCategory = "";
let selectedIdea = "";
let selectedWeeklyPosts = "";
let selectedImagePrompt = "";
let voiceProfile = null;
let currentItem = null;
let tributeDataUrl = "";

/** Map UI categories to legacy /generate prompt categories. */
function generatorCategory(uiCategory) {
  if (uiCategory === "Words of Wisdom") return "Wisdom Wednesday";
  if (uiCategory === "Weekly Reflection") return "Friday Recap";
  if (uiCategory === "The Long Game") return "The Long Game";
  if (uiCategory === "Saturday Mixed") return "Friday Freestyle";
  if (uiCategory === "Coffee Break Build") return "Friday Freestyle";
  return uiCategory;
}

function updateCategoryUi() {
  const cat = categorySelect.value;
  const needsWeekly = cat === "Weekly Reflection";
  weeklyPostsWrap.classList.toggle("hidden-block", !needsWeekly);
  weeklyPostsWrap.style.display = needsWeekly ? "block" : "none";

  const manualTribute = cat === "Masters of Today";
  tributeUploadWrap.classList.toggle("hidden-block", !manualTribute);
  tributeUploadWrap.style.display = manualTribute ? "block" : "none";

  const isLongGame = cat === "The Long Game";
  prepareLongGameBtn.classList.toggle("hidden-block", !isLongGame);
  prepareLongGameBtn.style.display = isLongGame ? "inline-block" : "none";

  const hints = {
    "Motivation Monday": "Requires a user theme.",
    "Masters of Today":
      "Includes tribute + Dad Joke Tuesday. Upload the tribute image manually — likeness images are not auto-generated.",
    "Words of Wisdom": "Requires a user theme.",
    "Masters of Yesterday":
      "Historical/cultural feature plus one valid Learn Cook Islands Māori episode.",
    "Weekly Reflection":
      "Connect the week’s ideas into one lesson — not a simple day-by-day recap.",
    "Saturday Mixed": "Choose from established OROK categories; avoid recent repetition.",
    "The Long Game":
      "Weekly Intelligence Brief with macro signal, pattern, family lesson, and 2–5 clickable sources.",
    "Coffee Break Build": "Evening build — numbering continues; review before publish.",
    "Friday Freestyle": "Lighter end-of-week freestyle.",
  };
  categoryHint.textContent = hints[cat] || "";
}

categorySelect.addEventListener("change", updateCategoryUi);
updateCategoryUi();

document.getElementById("tributeImage")?.addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  const preview = document.getElementById("tributePreview");
  tributeDataUrl = "";
  if (!file) {
    preview.textContent = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    tributeDataUrl = String(reader.result || "");
    preview.textContent = "Tribute image attached (manual). It will be noted on the draft.";
  };
  reader.readAsDataURL(file);
});

async function generatePosts() {
  const idea = document.getElementById("idea").value;
  const category = document.getElementById("category").value;
  const weeklyPosts = document.getElementById("weeklyPosts")?.value || "";

  if (
    (category === "Motivation Monday" ||
      category === "Words of Wisdom" ||
      category === "Masters of Today" ||
      category === "Masters of Yesterday") &&
    !idea.trim()
  ) {
    document.getElementById("posts").innerHTML =
      "This category requires a theme / subject in the Idea field.";
    return;
  }

  if (category === "The Long Game") {
    document.getElementById("posts").innerHTML =
      "Use “Prepare Long Game Brief” for Sunday Long Game (sources included automatically).";
    return;
  }

  const postsDiv = document.getElementById("posts");
  postsDiv.innerHTML = "Loading...";

  selectedPost = "";
  selectedPostBox.innerText = "";
  generateImageBtn.style.display = "none";
  saveToLedgerBtn.style.display = "none";
  imageStatus.innerText = "";
  generatedImage.style.display = "none";
  generatedImage.src = "";
  document.getElementById("imagePrompt").innerText = "";

  try {
    const res = await fetch("/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idea,
        category: generatorCategory(category),
        weeklyPosts,
        voiceProfile,
      }),
    });

    const data = await res.json();

    if (!data.text) {
      postsDiv.innerHTML = "Server error: " + (data.error || "No posts returned.");
      return;
    }

    const posts = data.text.split("\n\n\n").filter(Boolean);
    postsDiv.innerHTML = "";

    posts.forEach((post) => {
      const div = document.createElement("div");
      div.className = "post";
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
        selectedImagePrompt = buildImagePrompt(
          post,
          generatorCategory(category),
          idea,
          weeklyPosts
        );

        selectedPostBox.innerText = post;
        document.getElementById("imagePrompt").innerText = selectedImagePrompt;

        // Masters of Today: manual tribute image only — do not push auto likeness generation.
        if (category === "Masters of Today") {
          generateImageBtn.style.display = "none";
          imageStatus.innerText =
            "Masters of Today uses manual tribute upload — automatic likeness generation is disabled.";
        } else {
          generateImageBtn.style.display = "inline-block";
          imageStatus.innerText = "";
        }
        saveToLedgerBtn.style.display = "inline-block";
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
    .replace(/\n?Enjoy the day love you all c u this arvo😘/i, "")
    .replace(/\n?#\w+(?:\s+#\w+)*/g, "")
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

The reflection post is:
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
      voiceResult.innerText =
        "Voice analysis failed: server returned HTML instead of JSON.";
      return;
    }

    const data = await res.json();
    if (!data.result) {
      voiceResult.innerText =
        "Voice analysis failed: " + (data.error || "No result returned.");
      return;
    }

    voiceProfile = data.profile;
    voiceResult.innerText = data.result;
  } catch (error) {
    console.error(error);
    voiceResult.innerText = "Error analyzing voice: " + error.message;
  }
}

generateImageBtn.addEventListener("click", async () => {
  if (!selectedPost) {
    imageStatus.innerText = "Please select a post first.";
    return;
  }
  if (selectedCategory === "Masters of Today") {
    imageStatus.innerText =
      "Masters of Today requires a manual tribute upload — automatic likeness generation is disabled.";
    return;
  }

  imageStatus.innerText = "Generating image...";
  generatedImage.style.display = "none";
  generatedImage.src = "";

  try {
    const res = await fetch("/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        post: selectedPost,
        category: selectedCategory,
        idea: selectedIdea,
        weeklyPosts: selectedWeeklyPosts,
        imagePrompt: selectedImagePrompt,
      }),
    });

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      imageStatus.innerText =
        "Image generation failed: server returned HTML instead of JSON.";
      return;
    }

    const data = await res.json();
    if (!data.imageUrl) {
      imageStatus.innerText =
        "Image generation failed: " + (data.error || "No image returned.");
      return;
    }

    generatedImage.src = data.imageUrl;
    generatedImage.style.display = "block";
    imageStatus.innerText = "Image ready.";
  } catch (error) {
    console.error(error);
    imageStatus.innerText = "Error generating image: " + error.message;
  }
});

saveToLedgerBtn.addEventListener("click", async () => {
  if (!selectedPost) return toast("Select a post first");
  try {
    const body = {
      category: selectedCategory,
      idea: selectedIdea,
      topic: selectedIdea || selectedCategory,
      text: selectedPost,
      imageRequired: selectedCategory === "Masters of Today",
      imageBrief:
        selectedCategory === "Masters of Today"
          ? tributeDataUrl
            ? "Manual tribute image attached by operator."
            : "Manual tribute image upload required — do not auto-generate likeness."
          : selectedImagePrompt.slice(0, 240),
      notes: "Saved from Create Post.",
    };
    const res = await pubApi("/save-from-generator", {
      method: "POST",
      body: JSON.stringify(body),
    });
    toast("Saved to drafts");
    currentItem = res.item;
    showPanel("today");
    loadToday();
  } catch (e) {
    toast(e.message, true);
  }
});

prepareLongGameBtn.addEventListener("click", async () => {
  const postsDiv = document.getElementById("posts");
  postsDiv.innerHTML = "Preparing Long Game brief…";
  try {
    const res = await pubApi("/long-game/generate", {
      method: "POST",
      body: JSON.stringify({
        plannedDate: new Date().toISOString().slice(0, 10),
        developments: [],
      }),
    });
    selectedPost = res.item.text;
    selectedCategory = "The Long Game";
    selectedPostBox.innerText = selectedPost;
    generateImageBtn.style.display = "none";
    saveToLedgerBtn.style.display = "none";
    postsDiv.innerHTML =
      '<div class="post" style="background:#e8f0fe;">' +
      esc(selectedPost) +
      "</div><p class=\"hint\">Saved to ledger with " +
      (res.item.sources || []).length +
      " sources. Open Today or Review to continue.</p>";
    currentItem = res.item;
    toast("Long Game draft ready");
  } catch (e) {
    postsDiv.innerHTML = "Long Game failed: " + esc(e.message);
  }
});

/* ---------- Navigation inside original app ---------- */
function showPanel(name) {
  document.querySelectorAll(".panel").forEach((p) => {
    p.hidden = p.id !== "panel-" + name;
    p.classList.toggle("active", p.id === "panel-" + name);
  });
  document.querySelectorAll(".nav-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.panel === name);
  });
  if (location.hash !== "#" + name) {
    history.replaceState(null, "", "#" + name);
  }
  if (name === "today") loadToday();
  if (name === "ledger") loadLedger();
  if (name === "review") renderReview();
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => showPanel(btn.dataset.panel));
});

window.addEventListener("hashchange", () => {
  const h = (location.hash || "#create").replace("#", "");
  if (["create", "today", "ledger", "review"].includes(h)) showPanel(h);
});

(function initPanelFromHash() {
  const h = (location.hash || "#create").replace("#", "");
  if (["create", "today", "ledger", "review"].includes(h)) showPanel(h);
  else showPanel("create");
})();

/* ---------- Publishing API helpers ---------- */
async function pubApi(path, opts = {}) {
  const res = await fetch(PUB_API + path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.errors?.join("; ") || res.statusText);
  }
  return data;
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toast(msg, isError) {
  const el = document.getElementById("toast");
  el.hidden = false;
  el.textContent = msg;
  el.style.background = isError ? "#7a2e2e" : "#1c3a4a";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, 2800);
}

function badge(status) {
  return '<span class="badge">' + esc(status) + "</span>";
}

/* ---------- Today ---------- */
async function loadToday() {
  const sub = document.getElementById("todaySub");
  const cards = document.getElementById("todayCards");
  const queue = document.getElementById("todayQueue");
  const status = document.getElementById("todayStatus");
  try {
    const dash = await pubApi("/dashboard?backfill=1");
    const weekly = dash.weekly || {};
    const today = weekly.today;
    sub.textContent =
      (dash.today || "") +
      " · " +
      (weekly.timeZone || "") +
      (today ? " · " + today.label : "") +
      " · next CBB #" +
      String(dash.nextCoffeeBreakNumber || "").padStart(3, "0");

    cards.innerHTML =
      card("Awaiting review", dash.awaitingReview) +
      card("Approved", dash.approved) +
      card("Published this week", dash.publishedThisWeek) +
      card(
        "Morning",
        dash.morningPost
          ? dash.morningPost.status + " — " + (dash.morningPost.topic || "")
          : "—"
      ) +
      card(
        "Coffee Break",
        dash.eveningPost
          ? "#" +
              String(dash.eveningPost.seriesNumber || "").padStart(3, "0") +
              " " +
              dash.eveningPost.status
          : "—"
      );

    if (dash.preparation) {
      status.textContent =
        "Prep: created " +
        dash.preparation.created +
        ", already present " +
        dash.preparation.existed;
    }

    const items = await pubApi("/items?date=" + encodeURIComponent(dash.today || ""));
    const list = items.items || [];
    if (!list.length) {
      queue.innerHTML = '<div class="empty">No drafts for today yet.</div>';
      return;
    }
    queue.innerHTML = list
      .map(
        (i) =>
          '<div class="queue-item"><strong>' +
          esc(i.topic) +
          "</strong> " +
          badge(i.status) +
          '<div class="hint">' +
          esc(STREAM_LABELS[i.stream] || i.stream) +
          (i.category ? " · " + esc(i.category) : "") +
          (i.seriesNumber
            ? " · #" + String(i.seriesNumber).padStart(3, "0")
            : "") +
          (Array.isArray(i.sources) && i.sources.length
            ? " · " + i.sources.length + " sources"
            : "") +
          '</div><button type="button" data-id="' +
          esc(i.id) +
          '">Open review</button></div>'
      )
      .join("");
    queue.querySelectorAll("button[data-id]").forEach((b) => {
      b.addEventListener("click", () => openReview(b.getAttribute("data-id")));
    });
  } catch (e) {
    sub.textContent = e.message;
    queue.innerHTML = '<div class="empty">' + esc(e.message) + "</div>";
  }
}

function card(label, value) {
  return (
    '<div class="stat-card"><div class="label">' +
    esc(label) +
    '</div><div class="value">' +
    esc(value) +
    "</div></div>"
  );
}

document.getElementById("backfillBtn")?.addEventListener("click", async () => {
  try {
    // Uses dashboard backfill (no cron secret). Scheduler + /prepare remain for automation.
    const dash = await pubApi("/dashboard?backfill=1");
    toast(
      "Prep: created " +
        (dash.preparation?.created || 0) +
        ", present " +
        (dash.preparation?.existed || 0)
    );
    loadToday();
  } catch (e) {
    toast(e.message, true);
  }
});

/* ---------- Ledger ---------- */
async function loadLedger() {
  const streamSel = document.getElementById("ledgerStream");
  if (streamSel && streamSel.options.length <= 1) {
    Object.entries(STREAM_LABELS).forEach(([k, v]) => {
      const o = document.createElement("option");
      o.value = k;
      o.textContent = v;
      streamSel.appendChild(o);
    });
  }
  const q = new URLSearchParams();
  const stream = document.getElementById("ledgerStream")?.value;
  const status = document.getElementById("ledgerStatus")?.value;
  const topic = document.getElementById("ledgerTopic")?.value;
  if (stream) q.set("stream", stream);
  if (status) q.set("status", status);
  if (topic) {
    q.set("topic", topic);
    q.set("pattern", topic);
    q.set("source", topic);
  }
  const target = document.getElementById("ledgerTable");
  try {
    const { items } = await pubApi("/items?" + q.toString());
    if (!items.length) {
      target.innerHTML = '<div class="empty">No matching items.</div>';
      return;
    }
    target.innerHTML =
      "<table><thead><tr><th>Date</th><th>Stream</th><th>Topic</th><th>Pattern</th><th>Sources</th><th>Status</th><th></th></tr></thead><tbody>" +
      items
        .map(
          (i) =>
            "<tr><td>" +
            esc((i.plannedDate || "").slice(0, 10)) +
            "</td><td>" +
            esc(STREAM_LABELS[i.stream] || i.stream) +
            "</td><td>" +
            esc(i.topic) +
            "</td><td>" +
            esc(i.dominantPattern || "—") +
            "</td><td>" +
            (Array.isArray(i.sources) && i.sources.length
              ? i.sources.length
              : "—") +
            "</td><td>" +
            badge(i.status) +
            '</td><td><button type="button" data-id="' +
            esc(i.id) +
            '">Review</button></td></tr>'
        )
        .join("") +
      "</tbody></table>";
    target.querySelectorAll("button[data-id]").forEach((b) => {
      b.addEventListener("click", () => openReview(b.getAttribute("data-id")));
    });
  } catch (e) {
    target.innerHTML = '<div class="empty">' + esc(e.message) + "</div>";
  }
}

document.getElementById("ledgerRefresh")?.addEventListener("click", loadLedger);
["ledgerStream", "ledgerStatus", "ledgerTopic"].forEach((id) => {
  document.getElementById(id)?.addEventListener("change", loadLedger);
  document.getElementById(id)?.addEventListener("input", loadLedger);
});

/* ---------- Review ---------- */
async function openReview(id) {
  try {
    const { item } = await pubApi("/items/" + id);
    currentItem = item;
    showPanel("review");
    renderReview();
  } catch (e) {
    toast(e.message, true);
  }
}

function renderReview() {
  const empty = document.getElementById("reviewEmpty");
  const body = document.getElementById("reviewBody");
  if (!currentItem) {
    empty.classList.remove("hidden-block");
    empty.style.display = "block";
    body.classList.add("hidden-block");
    body.style.display = "none";
    return;
  }
  empty.classList.add("hidden-block");
  empty.style.display = "none";
  body.classList.remove("hidden-block");
  body.style.display = "block";

  const item = currentItem;
  const sourcesHtml =
    Array.isArray(item.sources) && item.sources.length
      ? item.sources
          .map(
            (s) =>
              '<div><a href="' +
              esc(s.url) +
              '" target="_blank" rel="noopener">' +
              esc(s.title) +
              "</a>" +
              (s.publisher
                ? ' <span class="hint">(' + esc(s.publisher) + ")</span>"
                : "") +
              "</div>"
          )
          .join("")
      : "<span class=\"hint\">No sources (only Long Game requires them).</span>";

  document.getElementById("reviewMeta").innerHTML =
    kv("Stream", STREAM_LABELS[item.stream] || item.stream) +
    kv(
      "Series #",
      item.seriesNumber ? "#" + String(item.seriesNumber).padStart(3, "0") : "—"
    ) +
    kv("Topic", item.topic) +
    kv("Category", item.category || "—") +
    kv("Macro Signal", item.macroSignal || "—") +
    kv("Dominant Pattern", item.dominantPattern || "—") +
    kv("Family Lesson", item.familyLesson || "—") +
    kv("Status", item.status) +
    kv("Version", item.version);

  document.getElementById("reviewSources").innerHTML =
    "<strong>Sources</strong>" + sourcesHtml;
  document.getElementById("reviewText").value = item.text || "";
  document.getElementById("reviewImageBrief").value = item.imageBrief || "";
  document.getElementById("reviewCharCount").textContent =
    (item.text || "").length + " characters";
  setReviewButtons(item.status);
  document.getElementById("reviewMsg").textContent = "";
}

function kv(k, v) {
  return (
    '<div class="k">' + esc(k) + "</div><div>" + esc(v) + "</div>"
  );
}

function setReviewButtons(status) {
  const allow = {
    idea: { save: 1, submit: 1, approve: 0, reject: 1, publish: 0, archive: 1 },
    draft: { save: 1, submit: 1, approve: 0, reject: 1, publish: 0, archive: 1 },
    review: { save: 1, submit: 0, approve: 1, reject: 1, publish: 0, archive: 1 },
    approved: {
      save: 1,
      submit: 0,
      approve: 0,
      reject: 1,
      publish: 1,
      archive: 1,
    },
    published: {
      save: 0,
      submit: 0,
      approve: 0,
      reject: 0,
      publish: 0,
      archive: 1,
    },
    archived: {
      save: 0,
      submit: 0,
      approve: 0,
      reject: 0,
      publish: 0,
      archive: 0,
    },
    rejected: {
      save: 0,
      submit: 0,
      approve: 0,
      reject: 0,
      publish: 0,
      archive: 0,
    },
  }[status] || {};
  document.getElementById("btnSaveDraft").disabled = !allow.save;
  document.getElementById("btnSubmit").disabled = !allow.submit;
  document.getElementById("btnApprove").disabled = !allow.approve;
  document.getElementById("btnReject").disabled = !allow.reject;
  document.getElementById("btnPublish").disabled = !allow.publish;
  document.getElementById("btnArchive").disabled = !allow.archive;
}

document.getElementById("reviewText")?.addEventListener("input", () => {
  document.getElementById("reviewCharCount").textContent =
    document.getElementById("reviewText").value.length + " characters";
});

document.getElementById("btnSaveDraft")?.addEventListener("click", async () => {
  try {
    const { item } = await pubApi("/items/" + currentItem.id, {
      method: "PATCH",
      body: JSON.stringify({
        text: document.getElementById("reviewText").value,
        imageBrief: document.getElementById("reviewImageBrief").value || undefined,
      }),
    });
    currentItem = item;
    toast("Saved v" + item.version);
    renderReview();
  } catch (e) {
    toast(e.message, true);
  }
});

async function act(path) {
  try {
    await pubApi("/items/" + currentItem.id, {
      method: "PATCH",
      body: JSON.stringify({
        text: document.getElementById("reviewText").value,
        imageBrief: document.getElementById("reviewImageBrief").value || undefined,
      }),
    }).catch(() => {});
    const { item } = await pubApi("/items/" + currentItem.id + "/" + path, {
      method: "POST",
      body: "{}",
    });
    currentItem = item;
    toast(path + " · " + item.status);
    renderReview();
    loadToday();
  } catch (e) {
    toast(e.message, true);
  }
}

document.getElementById("btnSubmit")?.addEventListener("click", () => act("submit"));
document.getElementById("btnApprove")?.addEventListener("click", () => act("approve"));
document.getElementById("btnArchive")?.addEventListener("click", () => act("archive"));
document.getElementById("btnReject")?.addEventListener("click", async () => {
  const reason = prompt("Rejection reason (required):");
  if (reason === null) return;
  if (!reason.trim()) return toast("Reason required", true);
  try {
    const { item } = await pubApi("/items/" + currentItem.id + "/reject", {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    currentItem = item;
    toast("Rejected");
    renderReview();
  } catch (e) {
    toast(e.message, true);
  }
});
document.getElementById("btnPublish")?.addEventListener("click", async () => {
  if (!confirm("Mark as PUBLISHED? This is a manual record only — nothing is posted automatically."))
    return;
  try {
    const { item } = await pubApi("/items/" + currentItem.id + "/publish", {
      method: "POST",
      body: JSON.stringify({
        confirm: true,
        text: document.getElementById("reviewText").value,
      }),
    });
    currentItem = item;
    toast("Published (recorded)");
    renderReview();
  } catch (e) {
    toast(e.message, true);
  }
});
