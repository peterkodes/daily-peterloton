// Viva's server-only, retry-safe outbox worker. No personal JWT crosses websites.
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.0';
const SITE='d17585d3-c64d-46bd-bf9f-4d758b75ee1b';
const TARGET='https://marwnbmablxzziyvhxof.supabase.co/functions/v1/kodes-partner-comment-event';
const ORIGINS=new Set(['https://www.vivamidia.com.br','https://vivamidia.com.br']);
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes))
 .replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const decode=(value:string)=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')+
 '='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));
const sha=async(value:string)=>Array.from(new Uint8Array(
 await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))))
 .map(v=>v.toString(16).padStart(2,'0')).join('');
const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
 status,headers:{'content-type':'application/json','cache-control':'no-store'}});
Deno.serve(async(req)=>{
 if(req.method!=='POST')return respond({error:'POST required'},405);
 const origin=req.headers.get('origin')||'';
 if(origin&&!ORIGINS.has(origin))return respond({error:'Origin not allowed'},403);
 const api=Deno.env.get('SUPABASE_URL'),secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!api||!secret)return respond({error:'Service unavailable'},503);
 const db=createClient(api,secret,{auth:{persistSession:false,autoRefreshToken:false}});
 let allowed=false;
 const token=req.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9._~-]+)$/i)?.[1];
 if(origin&&token){
  const {data}=await db.auth.getUser(token);
  if(data.user&&!data.user.is_anonymous){
   const {data:role}=await db.from('user_roles').select('role').eq('user_id',data.user.id)
    .eq('role','admin').maybeSingle();
   allowed=!!role;
  }
 }
 const scheduler=req.headers.get('x-kodes-report-secret')||'';
 if(!origin&&/^[a-f0-9]{64}$/.test(scheduler)){
  const {data,error}=await db.rpc('kodes_viva_verify_managed_scheduler',{p_secret:scheduler});
  allowed=!error&&data===true;
 }
 if(!allowed)return respond({error:'Viva administrator or scheduler required'},403);
 const {data:signers,error:signerError}=await db.rpc('kodes_viva_get_managed_signer',{
  p_site_id:'7554902f-4506-494e-8f69-50e4cef8e767'
 });
 const signer=Array.isArray(signers)?signers[0]:null;
 if(signerError||!signer?.private_key_pkcs8||!signer.signing_key_id)
   return respond({error:'Managed key unavailable'},503);
 let signingKey:CryptoKey;
 try{signingKey=await crypto.subtle.importKey('pkcs8',decode(signer.private_key_pkcs8),
  {name:'Ed25519'},false,['sign']);}
 catch{return respond({error:'Private key unusable'},503);}
 const {data:items,error:queueError}=await db.from('kodes_partner_comment_outbox')
 .select('event_id,comment_id,event_status,source_created_at,source_updated_at,attempts,comments!inner(user_id,parent_id,articles!inner(slug))')
 .is('delivered_at',null).lt('attempts',12).order('created_at',{ascending:true}).limit(20);
 if(queueError)return respond({error:'Outbox temporarily unavailable'},503);
 let delivered=0,blocked=0;
 for(const record of items||[]){
  const local=Array.isArray(record.comments)?record.comments[0]:record.comments;
  const article=Array.isArray(local?.articles)?local.articles[0]:local?.articles;
  const external=article?.slug;
  if(!external||!/^[A-Za-z0-9_.:@-]{1,200}$/.test(external)){
   blocked++;continue;
  }
  const issuedAt=new Date().toISOString();
  const hashSubject=await sha(SITE+':'+local.user_id);
  const fields=[SITE,signer.signing_key_id,record.event_id,hashSubject,record.comment_id,
    external,record.event_status,local.parent_id?'1':'0',
    new Date(record.source_created_at).toISOString(),new Date(record.source_updated_at).toISOString()];
  const payloadHash=await sha(fields.join('\n'));
  const message=['kodes-partner-comment-event-v1',SITE,signer.signing_key_id,issuedAt,payloadHash].join('\n');
  const signature=b64(new Uint8Array(await crypto.subtle.sign('Ed25519',signingKey,
    new TextEncoder().encode(message))));
  let response:Response|null=null;
  try{response=await fetch(TARGET,{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({
    website_id:SITE,key_id:signer.signing_key_id,event_id:record.event_id,
    external_subject_hash:hashSubject,external_comment_id:record.comment_id,
    external_article_id:external,status:record.event_status,is_reply:!!local.parent_id,
    source_created_at:fields[8],source_updated_at:fields[9],issued_at:issuedAt,signature
   }),signal:AbortSignal.timeout(9000)})}catch{}
  if(response?.ok){
   const {error:updated}=await db.from('kodes_partner_comment_outbox').update({
      delivered_at:new Date().toISOString(),last_error:null
    }).eq('event_id',record.event_id).is('delivered_at',null);
   if(!updated)delivered++;
  }else{
   blocked++;
   const reason=response?'upstream_'+response.status:'network_unavailable';
   await db.from('kodes_partner_comment_outbox').update({
    attempts:record.attempts+1,last_error:reason
   }).eq('event_id',record.event_id).is('delivered_at',null);
  }
 }
 return respond({processed:(items||[]).length,delivered,blocked},200);
});
