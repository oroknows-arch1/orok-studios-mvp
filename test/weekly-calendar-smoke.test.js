"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  morningForWeekday,
  generatorCategoryFor,
  COFFEE_BREAK,
} = require("../src/publishing/schedule/weekly");

/**
 * Smoke: every scheduled category resolves to the correct existing generator
 * mapping and review workflow stream.
 */
test("weekly smoke — every day resolves to generator + review stream", () => {
  const days = [
    {
      weekday: 1,
      label: "Motivation Monday",
      generator: "Motivation Monday",
      stream: "orok-morning",
      review: true,
    },
    {
      weekday: 2,
      label: "Masters of Today",
      generator: "Masters of Today",
      stream: "orok-morning",
      manualTributeImage: true,
    },
    {
      weekday: 3,
      label: "Words of Wisdom",
      generator: "Wisdom Wednesday",
      stream: "orok-morning",
    },
    {
      weekday: 4,
      label: "Masters of Yesterday",
      generator: "Masters of Yesterday",
      stream: "orok-morning",
      thursdayLingo: true,
      culturalSeries: true,
    },
    {
      weekday: 5,
      label: "Weekly Reflection",
      generator: "Friday Recap",
      stream: "orok-morning",
      fridayRecap: true,
    },
    {
      weekday: 6,
      label: "Saturday Mixed",
      generator: "Friday Freestyle",
      stream: "saturday-mixed",
    },
    {
      weekday: 7,
      label: "The Long Game",
      generator: "Sunday Long Game",
      stream: "sunday-long-game",
    },
  ];

  for (const d of days) {
    const plan = morningForWeekday(d.weekday);
    assert.ok(plan, "missing plan for " + d.weekday);
    assert.equal(plan.label, d.label);
    assert.equal(plan.stream, d.stream);
    assert.equal(generatorCategoryFor(plan.label), d.generator);
    if (d.manualTributeImage) assert.equal(plan.tributeManualImage, true);
    if (d.thursdayLingo) assert.equal(plan.includeCookIslandsMaori, true);
    if (d.culturalSeries) assert.equal(plan.culturalSeries, true);
    if (d.fridayRecap) assert.equal(plan.fridayRecap, true);
  }

  assert.equal(COFFEE_BREAK.stream, "coffee-break-build");
  assert.equal(COFFEE_BREAK.label, "Coffee Break Build");
});
