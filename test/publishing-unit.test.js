"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { collectItemErrors, ValidationError } = require("../src/publishing/validation");
const { canTransition, assertTransition, TransitionError } = require("../src/publishing/transitions");
const { nextCoffeeBreakNumber, highestPublishedNumber } = require("../src/publishing/numbering");
const { checkDuplicates } = require("../src/publishing/similarity");
const { createItem } = require("../src/publishing/model");

function baseItem(overrides = {}) {
  return createItem(
    Object.assign(
      {
        stream: "orok-morning",
        plannedDate: "2026-07-16",
        topic: "consistency",
        text: "Show up even when it is boring.",
        status: "draft",
        imageRequired: false,
      },
      overrides
    )
  );
}

/* 1. Publishing-item validation */
test("valid item passes validation", () => {
  assert.deepEqual(collectItemErrors(baseItem()), []);
});

test("invalid item collects field errors", () => {
  const errors = collectItemErrors({
    stream: "not-a-stream",
    status: "bogus",
    topic: "",
    plannedDate: "not-a-date",
    version: 0,
    text: 123,
    imageRequired: "yes",
  });
  assert.ok(errors.length >= 5, "expected multiple errors, got: " + errors.join("|"));
  assert.ok(errors.some((e) => e.includes("stream")));
  assert.ok(errors.some((e) => e.includes("status")));
  assert.ok(errors.some((e) => e.includes("topic")));
});

test("rejected item without reason is invalid", () => {
  const item = baseItem({ status: "rejected" });
  const errors = collectItemErrors(item);
  assert.ok(errors.some((e) => e.includes("rejectionReason")));
});

test("published item requires publishedAt", () => {
  const item = baseItem({ status: "published", publishedAt: undefined });
  const errors = collectItemErrors(item);
  assert.ok(errors.some((e) => e.includes("publishedAt")));
});

/* 2. Legal and illegal status transitions */
test("legal transitions follow the canonical workflow", () => {
  assert.ok(canTransition("idea", "draft"));
  assert.ok(canTransition("draft", "review"));
  assert.ok(canTransition("review", "approved"));
  assert.ok(canTransition("approved", "published"));
  assert.ok(canTransition("published", "archived"));
  assert.ok(canTransition("draft", "rejected"));
  assert.ok(canTransition("review", "rejected"));
});

test("illegal transitions are rejected", () => {
  assert.equal(canTransition("draft", "published"), false);
  assert.equal(canTransition("idea", "approved"), false);
  assert.equal(canTransition("published", "draft"), false);
  assert.equal(canTransition("rejected", "draft"), false);
  assert.equal(canTransition("archived", "published"), false);
  assert.throws(() => assertTransition("draft", "published"), TransitionError);
});

/* 3. Coffee Break Build next-number calculation */
test("next number is 1 when nothing published", () => {
  assert.equal(nextCoffeeBreakNumber([]), 1);
});

test("next number advances only past published entries", () => {
  const items = [
    baseItem({ stream: "coffee-break-build", status: "published", seriesNumber: 1, publishedAt: "2026-07-15" }),
  ];
  assert.equal(highestPublishedNumber(items), 1);
  assert.equal(nextCoffeeBreakNumber(items), 2);
});

test("active reservation skips forward", () => {
  const items = [
    baseItem({ stream: "coffee-break-build", status: "published", seriesNumber: 1, publishedAt: "2026-07-15" }),
    baseItem({ stream: "coffee-break-build", status: "draft", seriesNumber: 2 }),
  ];
  assert.equal(nextCoffeeBreakNumber(items), 3);
});

/* 4. Rejected drafts do not consume a public number */
test("rejected draft releases its reserved number", () => {
  const items = [
    baseItem({ stream: "coffee-break-build", status: "published", seriesNumber: 1, publishedAt: "2026-07-15" }),
    baseItem({ stream: "coffee-break-build", status: "rejected", seriesNumber: 2, rejectionReason: "off topic" }),
  ];
  assert.equal(nextCoffeeBreakNumber(items), 2);
});

test("archived-without-publish draft releases its number", () => {
  const items = [
    baseItem({ stream: "coffee-break-build", status: "published", seriesNumber: 1, publishedAt: "2026-07-15" }),
    baseItem({ stream: "coffee-break-build", status: "archived", seriesNumber: 2 }),
  ];
  assert.equal(nextCoffeeBreakNumber(items), 2);
});

/* 5. Published entries retain their number */
test("published numbers are not renumbered by later published items", () => {
  const items = [
    baseItem({ stream: "coffee-break-build", status: "published", seriesNumber: 1, publishedAt: "2026-07-15" }),
    baseItem({ stream: "coffee-break-build", status: "published", seriesNumber: 2, publishedAt: "2026-07-16" }),
  ];
  assert.equal(highestPublishedNumber(items), 2);
  assert.equal(nextCoffeeBreakNumber(items), 3);
});

/* 10. Duplicate advisory logic */
test("duplicate advisory flags when >= 3 dimensions match", () => {
  const existing = baseItem({
    topic: "staying consistent",
    text: "Consistency beats motivation every time.",
    similarityKeys: {
      opening: "Consistency beats motivation every time",
      centralLesson: "show up daily",
      example: "training for a marathon",
      imageConcept: "runner at dawn",
    },
  });
  const candidate = baseItem({
    topic: "staying consistent",
    text: "Consistency beats motivation every time.",
    similarityKeys: {
      opening: "Consistency beats motivation every time",
      centralLesson: "show up daily",
      example: "training for a marathon",
      imageConcept: "cyclist at night",
    },
  });
  const res = checkDuplicates(candidate, [existing]);
  assert.ok(res.flagged);
  assert.ok(res.matches[0].matchedDimensions.length >= 3);
});

test("duplicate advisory does not flag distinct items", () => {
  const existing = baseItem({
    topic: "safety on site",
    similarityKeys: { opening: "wear your gear", centralLesson: "protect yourself", example: "scaffolding", imageConcept: "hard hat" },
  });
  const candidate = baseItem({
    topic: "creativity and play",
    similarityKeys: { opening: "make something today", centralLesson: "play is work", example: "painting", imageConcept: "studio" },
  });
  const res = checkDuplicates(candidate, [existing]);
  assert.equal(res.flagged, false);
});

test("empty similarity dimensions cannot inflate a match", () => {
  const existing = baseItem({ topic: "", text: "", similarityKeys: {} });
  const candidate = baseItem({ topic: "", text: "", similarityKeys: {} });
  const res = checkDuplicates(candidate, [existing]);
  assert.equal(res.flagged, false);
});
