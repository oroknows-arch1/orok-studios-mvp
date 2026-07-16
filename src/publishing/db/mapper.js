"use strict";

/**
 * Translate between the PostgreSQL row shape (snake_case, SQL types) and the
 * application PublishingItem model (camelCase, ISO strings). This keeps all
 * PostgreSQL-specific naming and typing out of the service and route layers.
 */

/** Convert a value that may be a Date or ISO string into an ISO string (or null). */
function toIso(value) {
  if (value == null) return undefined;
  if (value instanceof Date) return value.toISOString();
  // already a string from pg or the caller
  return String(value);
}

/** Convert a planned date (Date or string) to a 'YYYY-MM-DD' string. */
function toDateOnly(value) {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/**
 * Map a database row to the application model.
 * @param {object} row
 * @returns {object} PublishingItem
 */
function rowToModel(row) {
  if (!row) return null;
  return {
    id: row.id,
    stream: row.stream,
    seriesNumber:
      row.series_number == null ? undefined : Number(row.series_number),
    plannedDate: toDateOnly(row.planned_date),
    generatedAt: toIso(row.generated_at),
    updatedAt: toIso(row.updated_at),
    status: row.status,
    category: row.category == null ? undefined : row.category,
    topic: row.topic,
    dominantPattern:
      row.dominant_pattern == null ? undefined : row.dominant_pattern,
    version: Number(row.version),
    text: row.text == null ? "" : row.text,
    imageRequired: row.image_required === true,
    imageBrief: row.image_brief == null ? undefined : row.image_brief,
    publishedAt: row.published_at == null ? undefined : toIso(row.published_at),
    postUrl: row.post_url == null ? undefined : row.post_url,
    rejectionReason:
      row.rejection_reason == null ? undefined : row.rejection_reason,
    notes: row.notes == null ? undefined : row.notes,
    similarityKeys: {
      opening: row.similarity_opening == null ? undefined : row.similarity_opening,
      centralLesson:
        row.similarity_central_lesson == null
          ? undefined
          : row.similarity_central_lesson,
      example: row.similarity_example == null ? undefined : row.similarity_example,
      imageConcept:
        row.similarity_image_concept == null
          ? undefined
          : row.similarity_image_concept,
    },
    history: normalizeHistory(row.history),
  };
}

function normalizeHistory(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_e) {
      return [];
    }
  }
  return [];
}

/**
 * Ordered column list used for INSERT/UPDATE statements.
 */
const COLUMNS = [
  "id",
  "stream",
  "series_number",
  "planned_date",
  "generated_at",
  "updated_at",
  "status",
  "category",
  "topic",
  "dominant_pattern",
  "version",
  "text",
  "image_required",
  "image_brief",
  "published_at",
  "post_url",
  "rejection_reason",
  "notes",
  "similarity_opening",
  "similarity_central_lesson",
  "similarity_example",
  "similarity_image_concept",
  "history",
];

/**
 * Map the application model to an ordered array of values matching COLUMNS.
 * @param {object} item PublishingItem
 * @returns {Array<any>}
 */
function modelToValues(item) {
  const sk = item.similarityKeys || {};
  return [
    item.id,
    item.stream,
    item.seriesNumber == null ? null : item.seriesNumber,
    item.plannedDate,
    item.generatedAt,
    item.updatedAt,
    item.status,
    nullable(item.category),
    item.topic,
    nullable(item.dominantPattern),
    item.version,
    item.text == null ? "" : item.text,
    item.imageRequired === true,
    nullable(item.imageBrief),
    nullable(item.publishedAt),
    nullable(item.postUrl),
    nullable(item.rejectionReason),
    nullable(item.notes),
    nullable(sk.opening),
    nullable(sk.centralLesson),
    nullable(sk.example),
    nullable(sk.imageConcept),
    JSON.stringify(Array.isArray(item.history) ? item.history : []),
  ];
}

/** Coerce undefined/null to SQL NULL, preserving empty strings and other values. */
function nullable(v) {
  return v == null ? null : v;
}

module.exports = { rowToModel, modelToValues, COLUMNS };
