'use strict';
// Isolated, opt-in, read-only research worker. No V3 publishing hooks.
const API = 'https://api.x.ai/v1/responses';
const SYSTEM = `You are EMRADAR's evidence-constrained X audience research assistant.
Use X Search when available. Find relevant, current, authentic X conversations and accounts.
Do not invent links, account names, quotes, engagement metrics or sources.
Distinguish observed evidence from inference and unknowns.
Seek original, helpful contributions; avoid repetitive promotion or engagement bait.
Never execute social actions. Return a structured report with conversation URLs,
account URLs, relevance reasons, and draft replies requiring human approval.`;

function validate(input) {
  if (!input || !/^\\d{1,25}$/.test(String(input.post_id || ''))) throw Error('GROK_POST_ID_REQUIRED');
  if (typeof input.body !== 'string' || !input.body.trim() || input.body.length > 15000) throw Error('GROK_POST_BODY_INVALID');
  if (!Array.isArray(input.evidence) || input.evidence.length > 30 ||
      input.evidence.some(x => typeof x !== 'string' || x.length > 2000)) throw Error('GROK_EVIDENCE_INVALID');
  return {post_id: String(input.post_id), body: input.body, evidence: input.evidence,
    post_url: 'https://x.com/i/web/status/' + input.post_id};
}
function createGrokAudiencePilot({fetcher = fetch, apiKey, model, enabled = false,
  timeoutMs = 30000, maxOutputTokens = 1800} = {}) {
  async function research(input) {
    if (!enabled) throw Error('GROK_PILOT_DISABLED');
    if (!apiKey || !model) throw Error('GROK_PILOT_CONFIG_REQUIRED');
    const post = validate(input);
    const controller = new AbortController();
    // The caller controls scheduling and persistence. No automatic publication.
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(API, {
        method: 'POST', signal: controller.signal,
        headers: {'authorization': 'Bearer ' + apiKey, 'content-type': 'application/json'},
        body: JSON.stringify({
          model, store: false,
          instructions: SYSTEM,
          input: JSON.stringify({post, task: 'Find up to 10 active X conversations, 10 relevant accounts, 5 ranked opportunities and 3 draft replies. Include verifiable URLs and uncertainty.'}),
          tools: [{type: 'x_search'}],
          max_output_tokens: maxOutputTokens
        })
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result || result.error) throw Error('GROK_PILOT_PROVIDER_ERROR_' + response.status);
      return {status: 'RESEARCH_ONLY', post_id: post.post_id, post_url: post.post_url,
        model, response_id: result.id || null, report: result, outbound_actions: 0};
    } finally {clearTimeout(timer);}
  }
  return {research};
}
module.exports = {createGrokAudiencePilot, validate};
