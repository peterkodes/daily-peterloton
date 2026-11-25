// Viva Mídia managed Kodes activation: requires a verified Viva admin JWT.
// Generates private Ed25519 material exclusively in this server-side function,
// saves it encrypted in Vault, registers only the PUBLIC key with Kodes.
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.0';
const VIVA='https://www.vivamidia.com.br';
const SITE='7554902f-4506-494e-8f69-50e4cef8e767';
const KODES='https://marwnbmablxzziyvhxof.supabase.co/functions/v1/kodes-managed-activation';
const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store',
 'access-control-allow-origin':VIVA,'access-control-allow-methods':'POST, OPTIONS',
 'access-control-allow-headers':'authorization,apikey,content-type,x-client-info',
 'vary':'Origin'};
const reply=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers});
const b64=(input:Uint8Array)=>btoa(String.fromCharCode(...input))
 .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
Deno.serve(async req=>{
 if(req.headers.get('origin')!==VIVA)return reply({error:'Website origin required'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 const token=req.headers.get('authorization')?.match(/^Bearer ([a-z0-9._~-]+)$/i)?.[1];
 if(!token)return reply({error:'Sign in as a Viva Mídia administrator'},401);
 const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!url||!key)return reply({error:'Viva backend unavailable'},503);
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:session,error:sessionError}=await db.auth.getUser(token);
 if(sessionError||!session.user||session.user.is_anonymous||
   !session.user.email_confirmed_at)return reply({error:'Verified Viva session required'},401);
 const {data:roles,error:roleError}=await db.from('user_roles')
   .select('role').eq('user_id',session.user.id).maybeSingle();
 if(roleError||roles?.role!=='admin')return reply({error:'Viva administrator authorization required'},403);
 let payload:Record<string,unknown>;
 try{const str=await req.text();if(str.length>700)return reply({error:'Request too large'},413);
     payload=JSON.parse(str);if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error()}
 catch{return reply({error:'Invalid request'},400)}
 if(payload.site!==SITE||typeof payload.token!=='string'||
    !/^[a-f0-9]{64}$/.test(payload.token)||payload.confirm!==true)
    return reply({error:'Expired activation or missing explicit approval'},400);
 const {data:existing,error:oldError}=await db.from('kodes_managed_server_connectors')
   .select('activated_at').eq('public_site_id',SITE).maybeSingle();
 if(oldError)return reply({error:'Connector state unavailable'},503);
 if(existing)return reply({error:existing.activated_at?'This website is already connected':'Incomplete installation needs administrator review'},409);
 // generateKey requires extractable=true only long enough to store PKCS8 in Vault.
 // No key is ever returned to the browser or logged.
 let generated:CryptoKeyPair;
 try{generated=await crypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']) as CryptoKeyPair}
 catch{return reply({error:'Secure key generation unavailable'},503)}
 const rawPublic=new Uint8Array(await crypto.subtle.exportKey('raw',generated.publicKey));
 const rawPrivate=new Uint8Array(await crypto.subtle.exportKey('pkcs8',generated.privateKey));
 const publicKey=b64(rawPublic),privateKey=b64(rawPrivate);
 const cronSecret=[...crypto.getRandomValues(new Uint8Array(32))]
   .map(x=>x.toString(16).padStart(2,'0')).join('');
 const {error:stored}=await db.rpc('kodes_viva_store_managed_signing_key',{
    p_site_id:SITE,p_public_key:publicKey,p_private_key:privateKey,
    p_cron_secret:cronSecret,p_installed_by:session.user.id});
 if(stored)return reply({error:'Unable to store private key securely in Viva Vault'},503);
 let result:Response;
 try{result=await fetch(KODES,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({action:'complete',site:SITE,token:payload.token,public_key:publicKey})})}
 catch{return reply({error:'Kodes registration temporarily unreachable; key remains encrypted and inactive'},503)}
 let completion:Record<string,unknown>;
 try{completion=await result.json()}catch{return reply({error:'Kodes returned an invalid provisioning response'},503)}
 if(!result.ok||completion.activated!==true||typeof completion.key_id!=='string')
    return reply({error:'Kodes did not authorize this installation; no connection was activated'},409);
 const {error:finishError}=await db.rpc('kodes_viva_activate_managed_connector',{
   p_site_id:SITE,p_key_id:completion.key_id});
 if(finishError)return reply({error:'Kodes registered the key, but Viva activation needs recovery'},503);
 // Initial signed report is an optional health check; failure never
 // overwrites the successful, now persisted, key activation.
 let firstReport=false;
 try{
   const report=await fetch(url+'/functions/v1/kodes-signed-telemetry',{
     method:'POST',
     headers:{'content-type':'application/json','authorization':'Bearer '+token,
       'apikey':Deno.env.get('SUPABASE_ANON_KEY')||'','origin':VIVA},
     body:JSON.stringify({date:new Date(Date.now()-86400000).toISOString().slice(0,10)}),
   });
   firstReport=report.ok;
 }catch{/* scheduler retries independently */}
 return reply({activated:true,site:SITE,initial_report_accepted:firstReport,
   message:'Server credentials provisioned. Comment authorization requires separate end-to-end validation.'});
});
