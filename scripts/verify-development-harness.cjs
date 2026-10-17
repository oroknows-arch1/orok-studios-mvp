'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const agentsPath = path.join(root, 'AGENTS.md');
const objectivePath = path.join(root, 'docs', 'development-objective.json');

function verifyDevelopmentHarness() {
  const agents = fs.readFileSync(agentsPath, 'utf8');
  const checkpoint = JSON.parse(fs.readFileSync(objectivePath, 'utf8'));
  const requiredRules = [
    'docs/development-objective.json',
    'Preserve the existing working EMRADAR scanner',
    'Reuse the existing repository, runtime, database, workers, and deployment infrastructure',
    'Never treat local tests',
    'Never declare the objective complete',
    'without separate explicit owner approval',
    'Do not start another campaign'
  ];
  const missingRules = requiredRules.filter(rule => !agents.includes(rule));
  if (missingRules.length) throw new Error(`HARNESS_RULES_MISSING:${missingRules.join('|')}`);
  if (checkpoint.schema_version !== 1) throw new Error('HARNESS_SCHEMA_UNSUPPORTED');
  if (checkpoint.campaign_id !== 'v3-df5b240c718018880410c03a4c392d64') throw new Error('HARNESS_CAMPAIGN_CHANGED');
  if (!['IN_PROGRESS', 'BLOCKED', 'COMPLETE'].includes(checkpoint.status)) throw new Error('HARNESS_STATUS_INVALID');
  if (!checkpoint.verified_checkpoint?.github_main_sha || !checkpoint.next_action) throw new Error('HARNESS_CHECKPOINT_INCOMPLETE');
  if (!Array.isArray(checkpoint.acceptance_conditions) || checkpoint.acceptance_conditions.length < 8) throw new Error('HARNESS_ACCEPTANCE_INCOMPLETE');
  const distribution = checkpoint.acceptance_conditions.find(item => item.id === 'external_distribution');
  if (distribution?.status !== 'PROHIBITED_PENDING_OWNER_APPROVAL') throw new Error('HARNESS_DISTRIBUTION_GUARD_MISSING');
  return {status: 'HARNESS_VERIFIED', objective_id: checkpoint.objective_id, campaign_id: checkpoint.campaign_id};
}

if (require.main === module) console.log(JSON.stringify(verifyDevelopmentHarness()));

module.exports = {verifyDevelopmentHarness};

