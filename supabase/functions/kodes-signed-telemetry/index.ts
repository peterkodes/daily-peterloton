// Viva Midia signed telemetry adapter for Kodes Connect. No private key in browser.
// Signing material is provisioned automatically via the Viva managed setup and
// read server-side from Vault. Environment secrets are legacy fallback only.
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.0';
const KODES='https://marwnbmablxzziyvhxof.supabase.co/functions/v1';
const VIVA=['https://www.vivamidia.com.br','https://vivamidia.com.br'];
const WEBSITE='d17585d3-c64d-46bd-bf9f-4d758b75ee1b';
const names=['article_views','new_readers','active_readers','comments_submitted','comments_approved','comments_pending','reactions'] as const;
const b64=(a:Uint8Array)=>btoa(String.fromCharCode(...a)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const bin=(v:string)=>Uint8Array.from(atob(v.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-v.length%4)%4)),c=>c.charCodeAt(0));
const hash=async(x:string)=>b64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(x))));
const response=(o:unknown,status=200,origin='')=>new Response(JSON.stringify(o),{status,headers:{
 'content-type':'application/json','cache-control':'no-store','vary':'Origin',
 ...(VIVA.includes(origin)?{'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS',
   'access-control-allow-headers':'authorization,apikey,content-type,x-client-info'}:{})}});
Deno.serve(async request=>{
 const origin=request.headers.get('origin')||'';
 if(request.method==='OPTIONS')return VIVA.includes(origin)?new Response(null,{status:204,headers:{
 'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS',
 'access-control-allow-headers':'authorization,apikey,content-type,x-client-info'}}):response({error:'Origin forbidden'},403);
 if(request.method!=='POST')return response({error:'POST only'},405);
 const base=Deno.env.get('SUPABASE_URL'),secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!base||!secret)return response({error:'Service unavailable'},503,origin);
 const db=createClient(base,secret,{auth:{persistSession:false,autoRefreshToken:false}});
 const token=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9._~-]+)$/i)?.[1];
 let authenticated=false;
 if(token&&VIVA.includes(origin)){
   const {data,error}=await db.auth.getUser(token);
   if(!error&&data.user&&!data.user.is_anonymous){
     const {data:admin}=await db.from('user_roles').select('role').eq('user_id',data.user.id).eq('role','admin').maybeSingle();
     authenticated=!!admin;
   }
 }
 const cron=Deno.env.get('KODES_REPORT_CRON_SECRET'),provided=request.headers.get('x-kodes-report-secret');
 const cronOk=!origin&&typeof cron==='string'&&cron.length>=32&&provided===cron;
 if(!authenticated&&!cronOk)return response({error:'Viva administrator or authorized scheduler required'},403,origin);
 let body:Record<string,unknown>;
 try{const raw=await request.text();if(raw.length>1000)return response({error:'Invalid request'},400,origin);
 body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw Error();}
 catch{return response({error:'Invalid body'},400,origin)}
 const date=typeof body.date==='string'?body.date:new Date(Date.now()-86400000).toISOString().slice(0,10);
 const start=Date.parse(date+'T00:00:00Z'),end=start+86400000;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(start)||
   new Date(start).toISOString().slice(0,10)!==date||start>Date.now()||start<Date.now()-365*86400000)
   return response({error:'Date must be past UTC day within the last year'},400,origin);
 const {data:managed,error:managedError}=await db.rpc('kodes_viva_get_managed_signer',{
   p_site_id:'7554902f-4506-494e-8f69-50e4cef8e767',
 });
 if(managedError)return response({error:'Unable to read managed connector state'},503,origin);
 const signer=Array.isArray(managed)?managed[0]:null;
 const keyId=signer?.signing_key_id||Deno.env.get('KODES_SIGNING_KEY_ID');
 const encoded=signer?.private_key_pkcs8||Deno.env.get('KODES_SIGNING_PRIVATE_KEY_PKCS8');
 if(!keyId||!encoded||!/^[0-9a-f-]{36}$/i.test(keyId))
   return response({error:'Automatic connector not activated; no metrics sent'},503,origin);
 let privateKey:CryptoKey;
 try{privateKey=await crypto.subtle.importKey('pkcs8',bin(encoded),{name:'Ed25519'},false,['sign'])}
 catch{return response({error:'Signer configuration invalid'},503,origin)}
 const startIso=new Date(start).toISOString(),endIso=new Date(end).toISOString();
 const count=async(table:'comments'|'reactions',status?:string)=>{
   let q=db.from(table).select('id',{head:true,count:'exact'}).gte('created_at',startIso).lt('created_at',endIso);
   if(status)q=q.eq('status',status);
   const {count,error}=await q;if(error)throw Error(table+' aggregate unavailable');return count||0;
 };
 let submitted:number,approved:number,pending:number,likes:number;
 try{[submitted,approved,pending,likes]=await Promise.all([
   count('comments'),count('comments','approved'),count('comments','pending'),count('reactions')]);}
 catch{return response({error:'Real aggregates unavailable; no partial zeros written'},503,origin)}
 const metrics:Record<string,number|null>={article_views:null,new_readers:null,active_readers:null,
   comments_submitted:submitted,comments_approved:approved,comments_pending:pending,reactions:likes};
 const issuedAt=new Date().toISOString(),nonce=b64(crypto.getRandomValues(new Uint8Array(32)));
 const msg=['kodes-partner-metrics-v1',WEBSITE,keyId,issuedAt,nonce,date,
   ...names.map(x=>metrics[x]===null?'-':String(metrics[x]))].join('\n');
 const signature=b64(new Uint8Array(await crypto.subtle.sign('Ed25519',privateKey,new TextEncoder().encode(msg))));
 const signed={website_id:WEBSITE,key_id:keyId,nonce,issued_at:issuedAt,metric_date:date,signature,metrics};
 let result:Response;
 try{result=await fetch(KODES+'/kodes-partner-metrics',{method:'POST',
   headers:{'content-type':'application/json'},body:JSON.stringify(signed)});}
 catch{return response({error:'Kodes endpoint unreachable; nothing confirmed'},503,origin)}
 if(!result.ok)return response({error:'Kodes rejected signed metrics',status:result.status},502,origin);
 return response({accepted:true,metric_date:date,metrics,
   data_quality:{article_views:'unavailable',new_readers:'unavailable',active_readers:'unavailable',
     comments:'observed from Viva SQL in UTC day',reactions:'observed from Viva SQL in UTC day'}},202,origin);
});
