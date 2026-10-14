import {createOpenAiPreparationProviders} from './openai-preparation-providers.js';
import {PostgresAdapter} from './adapters/postgres.js';
import {CampaignStore} from './state.js';
import {OutletDirectory} from './outlet-directory.js';
import {createDirectoryDiscovery} from './directory-discovery.js';
import {createReviewedEvidenceLinker} from './reviewed-evidence-links.js';
import {createAutonomousOutletDiscovery} from './autonomous-outlet-discovery.js';
import {createPreparationRun} from './preparation-run.js';
import {ReviewWorkflow} from './review-workflow.js';
import {createPublicationReviewHandoff} from './publication-review-handoff.js';

// Explicit assembly of existing V3 workers. Call only after provider and
// owner-notification transports have been configured and independently tested.
// Does not mount HTTP routes, deploy, distribute or trigger a campaign at import.
export async function createPreparationReviewService({
 pool,reviewOrigin,notify,researchEvidence,write,renderVisual,reviewedLinks,fetcher,discoverLinks,openai,autonomousDiscovery=false
}) {
 if(typeof pool?.query!=='function'||typeof notify!=='function'||
    typeof researchEvidence!=='function'||typeof write!=='function'||
    typeof renderVisual!=='function'||!Array.isArray(reviewedLinks))
  throw Error('V3_PREPARATION_SERVICE_DEPENDENCIES_REQUIRED');
 const adapter=new PostgresAdapter(pool);
 const directory=new OutletDirectory(pool);
 await adapter.initialize();
 await directory.initialize();
 const store=new CampaignStore(adapter);
 const discover=createDirectoryDiscovery({
  directory,linkEvidence:autonomousDiscovery?async({document})=>createAutonomousOutletDiscovery({openai,directory,fetcher})({document}):discoverLinks??createReviewedEvidenceLinker({reviewedLinks})
 });
 const prepare=createPreparationRun({store,researchEvidence,discover,write,renderVisual,fetcher});
 const workflow=new ReviewWorkflow({store,adapter,notify,baseUrl:reviewOrigin});
 return {store,directory,workflow,prepare,discover,prepareAndNotify:createPublicationReviewHandoff({prepare,workflow})};
}

// Convenience composition for the paid API's existing OpenAI connection.
// Caller still controls activation, review notification and all external effects.
export async function createOpenAiPreparationReviewService({openai,...options}) {
 const providers=createOpenAiPreparationProviders({openai});
 return createPreparationReviewService({...options,...providers,openai});
}
