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
 * Normalize sources JSON (array, string, or null) to an array of source objects.
 * @param {any} value
 * @returns {Array<object>}
 */
function normalizeSources(value) {
  if (Array.isArray(value)) return value.map(normalizeSourceRow);
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(normalizeSourceRow) : [];
    } catch (_e) {
      return [];
    }
  }
  return [];
}

function normalizeSourceRow(s) {
  if (!s || typeof s !== "object") return s;
  return {
    title: s.title,
    url: s.url,
    publisher: s.publisher == null ? undefined : s.publisher,
    publicationDate:
      s.publicationDate != null
        ? toDateOnly(s.publicationDate)
        : s.publication_date != null
          ? toDateOnly(s.publication_date)
          : undefined,
    accessDate:
      s.accessDate != null
        ? toDateOnly(s.accessDate)
        : s.access_date != null
          ? toDateOnly(s.access_date)
          : undefined,
    topic: s.topic == null ? undefined : s.topic,
    category: s.category == null ? undefined : s.category,
  };
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
    macroSignal: row.macro_signal == null ? undefined : row.macro_signal,
    familyLesson: row.family_lesson == null ? undefined : row.family_lesson,
    sources: normalizeSources(row.sources),
    version: Number(row.version),
    text: row.text == null ? "" : row.text,
    imageRequired: row.image_required === true,
    imageBrief: row.image_brief == null ? undefined : row.image_brief,
    publishedAt: row.published_at == null ? undefined : toIso(row.published_at),
    postUrl: row.post_url == null ? undefined : row.post_url,
    rejectionReason:
      row.rejection_reason == null ? undefined : row.rejection_reason,
    notes: row.notes == null ? undefined : row.notes,
    seriesMeta: normalizeSeriesMeta(row.series_meta),
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

function normalizeSeriesMeta(value) {
  if (value == null) return undefined;
  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value).length ? value : undefined;
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return Object.keys(parsed).length ? parsed : undefined;
      }
    } catch (_e) {
      return undefined;
    }
  }
  return undefined;
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
  "macro_signal",
  "family_lesson",
  "sources",
  "version",
  "text",
  "image_required",
  "image_brief",
  "published_at",
  "post_url",
  "rejection_reason",
  "notes",
  "series_meta",
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
  const sources = Array.isArray(item.sources) ? item.sources : [];
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
    nullable(item.macroSignal),
    nullable(item.familyLesson),
    JSON.stringify(sources),
    item.version,
    item.text == null ? "" : item.text,
    item.imageRequired === true,
    nullable(item.imageBrief),
    nullable(item.publishedAt),
    nullable(item.postUrl),
    nullable(item.rejectionReason),
    nullable(item.notes),
    JSON.stringify(
      item.seriesMeta && typeof item.seriesMeta === "object" ? item.seriesMeta : {}
    ),
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

/**
 * Build rows for publishing_long_game_sources from an item.
 * @param {object} item
 * @returns {Array<object>}
 */
function sourcesToRows(item) {
  const sources = Array.isArray(item.sources) ? item.sources : [];
  return sources.map((s, i) => ({
    id: `${item.id}:src:${i}`,
    item_id: item.id,
    title: s.title,
    url: s.url,
    publisher: s.publisher == null ? null : s.publisher,
    publication_date: s.publicationDate ? String(s.publicationDate).slice(0, 10) : null,
    access_date: s.accessDate
      ? String(s.accessDate).slice(0, 10)
      : new Date().toISOString().slice(0, 10),
    topic: s.topic == null ? null : s.topic,
    category: s.category == null ? null : s.category,
  }));
}

module.exports = {
  rowToModel,
  modelToValues,
  COLUMNS,
  normalizeSources,
  sourcesToRows,
  normalizeSeriesMeta,
};
