// Pricing checked 26 November 2026 against the OpenAI GPT-4.1 mini and web search pricing pages.
// The upper bound charges input at full rate, tool blocks independently, and all output tokens.
export function modelCostUsd(inputTokens,outputTokens,searchCalls){
  return (inputTokens+8000*searchCalls)*0.4/1e6 +outputTokens*1.6/1e6 +0.01*searchCalls;
}
let currency;
export async function usdPerAud(){
  if(currency && Date.now()-currency.checked<6*3600000)return currency.rate;
  const response=await fetch('https://www.rba.gov.au/statistics/frequency/exchange-rates.html',{redirect:'error',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('AUD_CONVERSION_UNAVAILABLE');
  const html=await response.text(),row=html.match(/United States dollar[\s\S]{0,1000}?<\/tr>/i)?.[0];
  const values=row?.match(/>\s*(0\.\d{3,6})\s*</g);
  const rate=Number(values?.at(-1)?.match(/0\.\d+/)?.[0]);
  const dates=[...html.matchAll(/(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+20\d{2})/g)].map(x=>Date.parse(x[1]+' 00:00:00 GMT')).filter(Number.isFinite);
  if(!(rate>.2&&rate<2)||!dates.some(date=>Math.abs(Date.now()-date)<8*86400000))throw Error('AUD_CONVERSION_UNVERIFIED');
  currency={rate,checked:Date.now()};return rate;
}
export function spending(adapter,{exchange=usdPerAud,now=()=>new Date()}={}){
  async function change(key,fn){
    for(let i=0;i<10;i++){
      const current=await adapter.read(key),value=structuredClone(current?.value??{reservations:{}});
      fn(value);
      if(await adapter.compareAndSwap(key,current?.version??null,value))return;
    }
    throw Error('BUDGET_CONCURRENT_UPDATE');
  }
  return {
    async reserve(campaignId,requestKey,input,searchCalls,kind,scanDate){
      const date=now(),month=new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit'}).format(date);
      const rate=await exchange();
      const bound=modelCostUsd(Buffer.byteLength(input,'utf8')+4096,4000,searchCalls)/rate;
      const key='clean-marketing-spend', id=campaignId+':'+requestKey;
      await change(key,ledger=>{
        if(ledger.reservations[id]&&ledger.reservations[id].status!=='REJECTED')throw Error('COST_ALREADY_RESERVED');
        const records=Object.values(ledger.reservations);
        const total=records.filter(r=>r.month===month&&!r.build_verification).reduce((sum,r)=>sum+r.amount_aud,0);
        const campaign=records.filter(r=>r.campaign_id===campaignId&&!r.build_verification).reduce((sum,r)=>sum+r.amount_aud,0);
        // The preceding production system had already incurred November charges. A reconciled
        // remaining allowance can be set once in the durable ledger without changing later months.
        const remaining=month==='2026-11'?ledger.november_remaining_aud:50;
        // Only the repaired sealed scan and the three ordinary acceptance dates are covered
        // by the owner's separate build authority. Each scheduled run keeps its own normal cap.
        const firstVerification=campaignId==='v3-8f3ca7840b5c0f7394896419f3f8ab27';
        const scheduledVerification=['2026-11-27','2026-11-28','2026-11-29'].includes(scanDate);
        const build=month==='2026-11'&&(firstVerification||scheduledVerification);
        if(scheduledVerification&&records.filter(r=>r.campaign_id===campaignId)
          .reduce((sum,r)=>sum+r.amount_aud,0)+bound>5)throw Error('RESEARCH_BUDGET_USED');
        if(!build){
          if(!Number.isFinite(remaining)||remaining<0||remaining>50)throw Error('NOVEMBER_BALANCE_UNRECONCILED');
          if(total+bound>remaining||campaign+bound>5)throw Error('RESEARCH_BUDGET_USED');
        }
        ledger.reservations[id]={month,build_verification:build,campaign_id:campaignId,status:'RESERVED',amount_aud:bound,usd_per_aud:rate,at:date.toISOString()};
      });
      return {key,id,rate};
    },
    async rejected(campaignId,requestKey){
      await change('clean-marketing-spend',ledger=>{
        const row=ledger.reservations[campaignId+':'+requestKey];
        if(row?.status==='RESERVED'){row.status='REJECTED';row.amount_aud=0;}
      });
    },
    async settle({key,id,rate},usage,searchCalls){
      if(!Number.isSafeInteger(usage?.input_tokens)||!Number.isSafeInteger(usage?.output_tokens))return;
      await change(key,ledger=>{
        const row=ledger.reservations[id];
        row.status='USAGE_RECORDED';row.amount_aud=modelCostUsd(usage.input_tokens,usage.output_tokens,searchCalls)/rate;
      });
    }
  };
}
