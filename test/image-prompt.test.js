"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { generateVerifiedImage, sourceFrom, createImageHandler } = require("../src/image-generation");

const input = {
  post: "Morning everyone 👋 Holding on feels safer, but it slows you down. Letting go makes room for a clearer head. Enjoy the day love you all c u this arvo😘 #LettingGo",
  category: "Motivation Monday", idea: "letting go",
  imagePrompt: "OVERRIDE: FOUR-PANEL COLLAGE",
};
const brief = { meaning: "Release pressure", observableAction: "Putting work away",
  emotionalDirection: "Quiet relief", scene: "A person putting tools away at the end of a shift." };
const pass = { singleScene: true, documentaryRealism: true, noTextOrWatermarks: true,
  meaningAligned: true, emotionalDirectionAligned: true, culturalRespect: true, reasons: [] };
function mockClient(reviews = [pass], customBrief = brief) {
  const calls = { chat: [], images: [] };
  const json = value => ({ choices: [{ message: { content: JSON.stringify(value) } }] });
  return { calls, chat: { completions: { create: async (request, options) => {
    calls.chat.push({ request, options });
    if (calls.chat.length === 1) return json(customBrief);
    const review = reviews[calls.chat.length - 2];
    if (review instanceof Error) throw review;
    return json(review);
  } } }, images: { generate: async (request, options) => {
    calls.images.push({ request, options });
    return { data: [{ b64_json: `image-${calls.images.length}` }] };
  } } };
}

test("single-line greetings do not swallow the actual selected post", () => {
  const source = sourceFrom(input);
  assert.match(source.post, /^Holding on/);
  assert.doesNotMatch(source.post, /Morning everyone|Enjoy the day|#LettingGo/);
  assert.equal(source.imagePrompt, undefined);
});

test("server uses selected post, ignores browser prompt and reviews actual image", async () => {
  const client = mockClient();
  const result = await generateVerifiedImage(client, input);
  assert.equal(result.imageReview.passed, true);
  assert.equal(result.imageReview.attempts, 1);
  assert.equal(result.imageUrl, "data:image/png;base64,image-1");
  assert.doesNotMatch(JSON.stringify(client.calls), /OVERRIDE/);
  assert.match(client.calls.chat[0].request.messages[1].content, /Holding on/);
  assert.equal(client.calls.chat[1].request.messages[1].content[1].image_url.url, result.imageUrl);
  assert.match(result.imagePrompt, /Exactly one coherent scene/);
  assert.deepEqual(result.imageBrief, brief);
});

test("collage rejected, concrete corrections sent once, only passing image returned", async () => {
  const client = mockClient([{ ...pass, singleScene: false, reasons: ["Remove the four-panel grid."] }, pass]);
  const result = await generateVerifiedImage(client, input);
  assert.equal(result.imageUrl, "data:image/png;base64,image-2");
  assert.equal(result.imageReview.attempts, 2);
  assert.match(client.calls.images[1].request.prompt, /Remove the four-panel grid/);
  assert.match(client.calls.images[1].request.prompt, /Release pressure/);
  assert.ok(client.calls.images.every(c => c.options.maxRetries === 0));
});

test("two emotionally wrong images fail closed with no third generation", async () => {
  const fail = { ...pass, emotionalDirectionAligned: false, reasons: ["Only distress is visible."] };
  const client = mockClient([fail, fail]);
  await assert.rejects(generateVerifiedImage(client, input), { status: 422 });
  assert.equal(client.calls.images.length, 2);
});

test("invalid and manual-tribute inputs never call the model", async () => {
  for (const body of [{ imagePrompt: "old browser prompt" }, { ...input, post: 42 },
    { ...input, category: "Masters of Today" }, { ...input, weeklyPosts: [] },
    { ...input, post: "x".repeat(8001) }]) {
    const client = mockClient();
    await assert.rejects(generateVerifiedImage(client, body), { status: 400 });
    assert.equal(client.calls.chat.length, 0);
  }
});

test("malformed brief never generates an image", async () => {
  const client = mockClient([pass], { meaning: "release" });
  await assert.rejects(generateVerifiedImage(client, input), { status: 502 });
  assert.equal(client.calls.images.length, 0);
});

test("malformed reviews and review outages never return an unreviewed image", async () => {
  for (const review of [{ ...pass, singleScene: "true" }, { passed: true }, new Error("provider secret")]) {
    const client = mockClient([review]);
    let status = 200, body;
    await createImageHandler(client)({ body: input }, {
      status(value) { status = value; return this; }, json(value) { body = value; },
    });
    assert.equal(status, 502);
    assert.equal(body.imageUrl, undefined);
    assert.doesNotMatch(body.error, /provider secret/);
    assert.equal(client.calls.images.length, 1);
  }
});

test("all checks must pass, including writing and cultural treatment", async () => {
  for (const field of Object.keys(pass).filter(k => k !== "reasons")) {
    const client = mockClient([{ ...pass, [field]: false }, { ...pass, [field]: false }]);
    await assert.rejects(generateVerifiedImage(client, input), { status: 422 });
  }
});

test("changing post while generating discards stale image and brief", async () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const source = fs.readFileSync(require("node:path").join(__dirname, "../app.js"), "utf8");
  const start = source.indexOf('generateImageBtn.addEventListener("click"');
  const end = source.indexOf('saveToLedgerBtn.addEventListener', start);
  let handler, resolveFetch;
  const promptElement = { innerText: "" };
  const context = { selectedPost: input.post, selectedCategory: input.category,
    selectedIdea: "letting go", selectedWeeklyPosts: "", selectedImagePrompt: "",
    imageSelectionVersion: 1, imageRequestPending: false,
    imageStatus: { innerText: "" }, generatedImage: { style: {}, src: "" },
    generateImageBtn: { addEventListener: (_event, fn) => { handler = fn; } },
    document: { getElementById: () => promptElement }, console,
    fetch: () => new Promise(resolve => { resolveFetch = resolve; }) };
  vm.runInNewContext(source.slice(start, end), context);
  const pending = handler();
  assert.equal(context.generateImageBtn.disabled, true);
  context.imageSelectionVersion++;
  context.selectedPost = "A different post";
  resolveFetch({ ok: true, headers: { get: () => "application/json" },
    json: async () => ({ imageUrl: "old-image", imagePrompt: "old-brief", imageReview: { passed: true } }) });
  await pending;
  assert.equal(context.generatedImage.src, "");
  assert.equal(context.selectedImagePrompt, "");
  assert.equal(context.generateImageBtn.disabled, false);
});
