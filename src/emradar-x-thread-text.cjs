'use strict';
const {parseTweet,extractUrls}=require('twitter-text');
// Standard API limit; no Premium entitlement is inferred. Split drafts before
// review, never after approval. Each part retains its discovery identity.
function splitPost(text,maxWeight=280){
 if(typeof text!=='string'||!text.trim())throw Error('THREAD_TEXT_REQUIRED');
 const valid=value=>{const result=parseTweet(value);return result.valid&&result.weightedLength<=maxWeight;};
 const parts=[];let current='';
 for(const token of text.match(/\S+\s*/gu)??[]){
  if(valid((current+token).trim())){current+=token;continue;}
  if(current.trim()){parts.push(current.trim());current='';}
  if(valid(token.trim())){current=token;continue;}
  for(const {segment} of new Intl.Segmenter('en',{granularity:'grapheme'}).segment(token)){
   if(!valid((current+segment).trim())){if(!current.trim())throw Error('THREAD_UNSPLITTABLE_TEXT');parts.push(current.trim());current='';}
   current+=segment;
  }
 }
 if(current.trim())parts.push(current.trim());
 if(parts.some(part=>!parseTweet(part).valid))throw Error('THREAD_PLATFORM_TEXT_INVALID');
 return parts;
}
function expandSegments(logical){
 const segments=[];
 for(const s of logical){const parts=splitPost(s.text,180);for(let i=0;i<parts.length;i++){
  const text=(s.record_id?'Discovery '+(s.sequence-1)+' · '+s.record_id.slice(0,30):'Daily scan')+' · '+(i+1)+'/'+parts.length+'\n'+parts[i];
  if(!parseTweet(text).valid)throw Error('THREAD_PLATFORM_TEXT_INVALID');
  segments.push({...s,text,sequence:segments.length+1,parent_sequence:segments.length||null,discovery_part:i+1,discovery_parts:parts.length,source_links:extractUrls(text),media:i?null:s.media});
 }}
 return segments;
}
module.exports={splitPost,expandSegments,validText:text=>parseTweet(text).valid};
