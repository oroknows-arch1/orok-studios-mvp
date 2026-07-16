"use strict";

/**
 * Map provider chat-completion responses into a neutral usage shape.
 * Prefer provider-reported token counts; never invent them.
 *
 * @param {object} response
 * @param {{ fallbackModel?: string, provider?: string }} [opts]
 */
function mapProviderChatUsage(response, opts = {}) {
  const usage = (response && response.usage) || {};
  const model =
    (typeof response?.model === "string" && response.model) ||
    opts.fallbackModel ||
    null;

  const inputTokens = firstToken(
    usage.prompt_tokens,
    usage.input_tokens,
    usage.inputTokens
  );
  const outputTokens = firstToken(
    usage.completion_tokens,
    usage.output_tokens,
    usage.outputTokens
  );
  const totalTokens = firstToken(
    usage.total_tokens,
    usage.totalTokens,
    inputTokens !== null && outputTokens !== null
      ? inputTokens + outputTokens
      : null
  );

  return {
    provider: opts.provider || "openai",
    model,
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

function firstToken(...values) {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      return Math.floor(v);
    }
  }
  return null;
}

module.exports = { mapProviderChatUsage };
