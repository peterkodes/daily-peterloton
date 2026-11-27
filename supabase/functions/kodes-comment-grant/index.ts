// Viva Mídia: exchange a short-lived Kodes-ID proof for a reader-scoped grant.
// Uses Viva Auth for identity; Kodes checks its own session/link on ticket issue.
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.0';
const KODES_API='https://marwnbmablxzziyvhxof.supabase.co/functions/v1/kodes-viva-comment-access';
const SITE='d17585d3-c64d-46bd-bf9f-4d758b75ee1b';
const ALLOWED=new Set(['https://www.vivamidia.com.br','https://vivamidia.com.br']);
const headers=(origin:string)=>({'content-type':'application/json; charset=utf-8','cache-control':'no-store','vary':'Origin',
  ...(ALLOWED.has(origin)?{'access-control-allow-origin':origin}:{}),
  'access-control-allow-methods':'POST, OPTIONS',
  'access-control-allow-headers':'authorization,apikey,content-type,x-client-info'});
const reply=(origin:string,data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:headers(origin)});
Deno.serve(async req=>{
  const origin=req.headers.get('origin')||'';
  if(req.method==='OPTIONS')return ALLOWED.has(origin)?new Response(null,{status:204,headers:headers(origin)}):reply(origin,{error:'Forbidden'},403);
  if(req.method!=='POST')return reply(origin,{error:'POST only'},405);
  if(origin&&!ALLOWED.has(origin))return reply(origin,{error:'Origin not allowed'},403);
  const url=Deno.env.get('SUPABASE_URL'),role=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!role)return reply(origin,{error:'Service unavailable'},503);
  const bearer=req.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9._~-]+)$/i)?.[1];
  if(!bearer)return reply(origin,{error:'Enter Viva Mídia account first'},401);
  const admin=createClient(url,role,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:identity,error:authError}=await admin.auth.getUser(bearer);
  if(authError||!identity.user||identity.user.is_anonymous)return reply(origin,{error:'Invalid Viva Mídia session'},401);
  let payload:Record<string,unknown>;
  try{
    const s=await req.text();if(s.length>1200)return reply(origin,{error:'Payload too large'},413);
    payload=JSON.parse(s);if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('invalid');
  }catch{return reply(origin,{error:'Malformed request'},400);}
  if(payload.action==='identity_status'||payload.action==='refresh_linked'){
    // Reader token is checked locally and relayed only server-to-server
    // to the fixed Kodes endpoint; never issue Kodes credentials here.
    const upstream=await fetch(KODES_API,{method:'POST',headers:{
      'content-type':'application/json','cache-control':'no-store'},
      body:JSON.stringify({action:'identity_status',website_id:SITE,viva_access_token:bearer}),
      signal:AbortSignal.timeout(9000)}).catch(()=>null);
    if(!upstream)return reply(origin,{error:'Kodes identity service unavailable'},503);
    if(!upstream.ok)return reply(origin,{error:'Unable to verify Kodes link',code:upstream.status},503);
    const value=await upstream.json().catch(()=>null);
    if(typeof value?.linked!=='boolean'||!Number.isInteger(value.level)||typeof value.can_comment!=='boolean')
      return reply(origin,{error:'Invalid Kodes identity response'},503);
    if(payload.action==='refresh_linked'){
      // Only a fresh, independently validated Viva Auth session plus a still-
      // active consented Kodes link can renew permission. No Kodes JWT, key,
      // account provisioning or browser-supplied level is trusted.
      if(!value.linked||!value.can_comment||value.level<2||value.level>5)
        return reply(origin,{error:'Kodes N2 and a verified account link required'},403);
      const now=Date.now(),expiresAt=new Date(now+120000).toISOString();
      const {error:saveError}=await admin.from('kodes_comment_grants').upsert({
        user_id:identity.user.id,level:value.level,issued_at:new Date(now).toISOString(),
        expires_at:expiresAt,source:'dual_session_kodes',
      },{onConflict:'user_id'});
      if(saveError)return reply(origin,{error:'Grant renewal unavailable'},503);
      return reply(origin,{authorized:true,level:value.level,expires_at:expiresAt},200);
    }
    return reply(origin,{linked:value.linked,level:value.level,can_comment:value.can_comment},200);
  }
  const ticket=payload.ticket;
  if(typeof ticket!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(ticket))return reply(origin,{error:'Invalid ticket'},400);
  // Forward Viva proof only to fixed, verified Kodes URL; no user-controlled URL.
  const kodes=await fetch(KODES_API,{method:'POST',headers:{'content-type':'application/json','cache-control':'no-store'},
    body:JSON.stringify({action:'redeem',website_id:SITE,viva_access_token:bearer,ticket}),
    signal:AbortSignal.timeout(9000)}).catch(()=>null);
  if(!kodes)return reply(origin,{error:'Identity validation unavailable'},503);
  if(!kodes.ok)return reply(origin,{error:'Kodes-ID validation failed or expired',code:kodes.status},403);
  const grant=await kodes.json().catch(()=>null);
  if(grant?.allowed!==true||!Number.isInteger(grant?.level)||grant.level<2||grant.level>5)
    return reply(origin,{error:'Insufficient Kodes-ID level'},403);
  const now=Date.now(),expiry=new Date(now+Math.min(Number(grant.expires_in_seconds||600),600)*1000).toISOString();
  const {error:saved}=await admin.from('kodes_comment_grants').upsert({user_id:identity.user.id,
    level:grant.level,issued_at:new Date(now).toISOString(),expires_at:expiry,source:'dual_session_kodes'},
    {onConflict:'user_id'});
  if(saved)return reply(origin,{error:'Unable to authorize comments'},503);
  return reply(origin,{authorized:true,level:grant.level,expires_at:expiry},200);
});
