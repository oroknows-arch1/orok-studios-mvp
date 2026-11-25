// Only name actors identified in evidence for this specific formation.
export function attributeX(body, record, evidence) {
 if (!record) return body;
 const location = record.location?.trim();
 const facts = evidence.filter(item => item.record_id === record.id).map(item => item.fact ?? '').join(' ').toLowerCase();
 const companies = (record.causal_chain?.connected_companies_and_tickers ?? [])
  .filter(name => typeof name === 'string')
  .map(name => name.replace(/ *\([^)]*\)$/, '').trim())
  .filter(name => name && facts.includes(name.toLowerCase()) && !body.toLowerCase().includes(name.toLowerCase()));
 const context = [location && !body.includes(location) ? location : '', ...new Set(companies)].filter(Boolean);
 return context.length ? context.join(' · ') + '\n\n' + body : body;
}
