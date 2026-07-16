"use strict";

const crypto = require("crypto");
const { deriveOpening } = require("./similarity");

/**
 * @typedef {Object} SimilarityKeys
 * @property {string} [opening]
 * @property {string} [centralLesson]
 * @property {string} [example]
 * @property {string} [imageConcept]
 */

/**
 * @typedef {Object} PublishingItem
 * @property {string} id
 * @property {import("./constants").PublishingStream} stream
 * @property {number} [seriesNumber]
 * @property {string} plannedDate
 * @property {string} generatedAt
 * @property {string} updatedAt
 * @property {import("./constants").PublishingStatus} status
 * @property {string} [category]
 * @property {string} topic
 * @property {string} [dominantPattern]
 * @property {number} version
 * @property {string} text
 * @property {boolean} imageRequired
 * @property {string} [imageBrief]
 * @property {string} [publishedAt]
 * @property {string} [postUrl]
 * @property {string} [rejectionReason]
 * @property {string} [notes]
 * @property {SimilarityKeys} similarityKeys
 * @property {Array<{version:number,status:string,text:string,at:string}>} history
 */

/**
 * Build a fully-formed PublishingItem from partial input, applying defaults.
 * Does not validate — callers should validate afterwards.
 * @param {Partial<PublishingItem>} input
 * @returns {PublishingItem}
 */
function createItem(input = {}) {
  const now = new Date().toISOString();
  const text = typeof input.text === "string" ? input.text : "";
  const status = input.status || "draft";

  const similarityKeys = Object.assign(
    {
      opening: deriveOpening(text) || undefined,
      centralLesson: undefined,
      example: undefined,
      imageConcept: input.imageBrief || undefined,
    },
    input.similarityKeys || {}
  );

  return {
    id: input.id || crypto.randomUUID(),
    stream: input.stream,
    seriesNumber:
      input.seriesNumber === null ? undefined : input.seriesNumber,
    plannedDate: input.plannedDate,
    generatedAt: input.generatedAt || now,
    updatedAt: input.updatedAt || now,
    status,
    category: input.category,
    topic: input.topic,
    dominantPattern: input.dominantPattern,
    version: input.version || 1,
    text,
    imageRequired:
      typeof input.imageRequired === "boolean" ? input.imageRequired : false,
    imageBrief: input.imageBrief,
    publishedAt: input.publishedAt,
    postUrl: input.postUrl,
    rejectionReason: input.rejectionReason,
    notes: input.notes,
    similarityKeys,
    history: Array.isArray(input.history) ? input.history : [],
  };
}

/** Append an audit snapshot to an item's history (returns a new array). */
function withHistorySnapshot(item) {
  const snapshot = {
    version: item.version,
    status: item.status,
    text: item.text,
    at: item.updatedAt,
  };
  return [...(item.history || []), snapshot];
}

module.exports = { createItem, withHistorySnapshot };
