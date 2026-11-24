'use strict';
(() => {
 const $ = id => document.getElementById(id);
 const message = text => { $('status').textContent = text; };
 const clear = el => el.replaceChildren();
 const node = (tag,text,cls) => { const el=document.createElement(tag); if(text!==undefined) el.textContent=text; if(cls)el.className=cls; return el; };
 const gate = text => { $('dashboard').hidden=true; clear($('records')); clear($('metrics')); $('identity').textContent=''; $('gate').hidden=false; $('gate-message').textContent=text; message(text); };
 if(!window.supabase?.createClient){ gate('The reader service could not load. Reload and try again.'); return; }
 const db=window.supabase.createClient('https://jyjrgdoeuzlvvpkymqsu.supabase.co','sb_publishable_suBMv7WnrejReyIswL19jw_ipsMz5Gr');
 const staff=['admin','moderator']; const size=25;
 let tab='comments', page=0, version=0, busy=false, authorized=false;
 const date = val => val ? new Date(val).toLocaleString() : '—';
 const label = {comments:'Comments',articles:'Published articles',authors:'Editorial authors',readers:'Reader profiles',logs:'Moderation activity log'};
 function err(e){return e?.message || 'Request failed.';}
 async function access(){
   const {data,error}=await db.auth.getUser();
   if(error || !data.user){authorized=false;gate('Sign in with an authorized staff account.');return false;}
   const role=await db.from('user_roles').select('role').eq('user_id',data.user.id).maybeSingle();
   if(role.error || !staff.includes(role.data?.role)){authorized=false;gate(role.error?'Unable to verify your permissions.':'Your reader account does not have administration permissions.');return false;}
   authorized=true;$('gate').hidden=true;$('dashboard').hidden=false;$('identity').textContent='Signed in as '+(data.user.email||'staff')+' · '+role.data.role;return true;
 }
 async function count(table,filter){let q=db.from(table).select('id',{count:'exact',head:true}); if(filter)q=q.eq('status',filter);const r=await q;return r.error?'—':String(r.count??0);}
 async function metrics(v){
   const fields=[['Published articles','articles','published'],['Authors','authors'],['Categories','categories'],['Readers','profiles'],['Pending','comments','pending'],['Approved','comments','approved']];
   const values=await Promise.all(fields.map(f=>count(f[1],f[2])));if(v!==version||!authorized)return;
   clear($('metrics'));fields.forEach((f,i)=>{let d=node('div',undefined,'metric');d.append(node('span',f[0],'muted'),node('strong',values[i]));$('metrics').append(d);});
 }
 function record(r){const item=node('article');
   if(tab==='comments'){
     item.append(node('h3',r.profiles?.display_name||'Reader'),node('p',r.articles?.title||'Article '+r.article_id,'muted'),node('p',r.content,'text'),node('p',r.status,'tag '+r.status),node('p',date(r.created_at)+(r.parent_id?' · Reply':''),'muted'));
     const acts=node('div',undefined,'actions'); for(const [text,target] of [['Approve','approved'],['Reject','rejected'],['Hide','hidden'],['Return to pending','pending']]){const b=node('button',text);b.type='button';b.disabled=r.status===target;b.addEventListener('click',()=>moderate(r,target));acts.append(b);}item.append(acts);
   }else if(tab==='articles'){
     item.append(node('h3',r.title),node('p',(r.authors?.name||'Unknown author')+' · '+(r.categories?.name||'Uncategorized'),'muted'),node('p',date(r.published_at),'muted'));if(r.slug){let a=node('a','Open article');a.href='/#article-'+encodeURIComponent(r.slug);item.append(a);}
   }else if(tab==='authors'){item.append(node('h3',r.name),node('p',r.bio||'No biography','muted'));}
   else if(tab==='readers'){item.append(node('h3',r.display_name),node('p','Joined '+date(r.created_at),'muted'));}
   else{item.append(node('h3',r.action),node('p','Comment: '+(r.comment_id||'Removed'),'muted'),node('p','Actor: '+(r.moderator_id||'Database administration'),'muted'),node('p',r.reason||''),node('p',date(r.created_at),'muted'));}return item;
 }
 async function records(v){
   $('section-title').textContent=label[tab];$('filter-label').hidden=tab!=='comments';$('page').textContent='Page '+(page+1);
   clear($('records'));$('records').append(node('p','Loading…','muted'));$('prev').disabled=true;$('next').disabled=true;
   let q;
   if(tab==='comments'){q=db.from('comments').select('id,article_id,user_id,parent_id,content,status,created_at,profiles(display_name),articles(title)').order('created_at',{ascending:false}).order('id');if($('filter').value!=='all')q=q.eq('status',$('filter').value);}
   else if(tab==='articles')q=db.from('articles').select('id,title,slug,published_at,authors(name),categories(name)').eq('status','published').order('published_at',{ascending:false}).order('id');
   else if(tab==='authors')q=db.from('authors').select('id,name,bio').order('name').order('id');
   else if(tab==='readers')q=db.from('profiles').select('id,display_name,created_at').order('created_at',{ascending:false}).order('id');
   else q=db.from('moderation_logs').select('id,moderator_id,comment_id,action,reason,created_at').order('created_at',{ascending:false}).order('id');
   const result=await q.range(page*size,page*size+size);if(v!==version||!authorized)return;
   clear($('records'));if(result.error){$('records').append(node('p','Could not load records: '+err(result.error)));return;}
   const rows=result.data||[]; if(!rows.length)$('records').append(node('p','No records in this view.','muted'));else rows.slice(0,size).forEach(r=>$('records').append(record(r)));
   $('prev').disabled=page===0;$('next').disabled=rows.length<=size;
 }
 async function refresh(notice){const v=++version;message('Checking permissions and loading data…');try{if(!await access()||v!==version)return;await Promise.all([metrics(v),records(v)]);if(v===version&&authorized)message(notice||'Administration ready.');}catch(e){if(v===version)message('Unable to load: '+err(e));}}
 async function moderate(row,target){if(busy||!window.confirm('Change comment status from '+row.status+' to '+target+'?'))return;busy=true;const buttons=[...$('records').querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);try{if(!await access())return;const r=await db.from('comments').update({status:target}).eq('id',row.id).eq('status',row.status).select('id,status').maybeSingle();if(r.error)throw r.error;if(!r.data||r.data.status!==target){await refresh('Comment was not changed. Permissions or status may have changed.');return;}await refresh('Comment status updated to '+target+'.');}catch(e){message('Moderation failed: '+err(e));buttons.forEach(b=>b.disabled=false);}finally{busy=false;}}
 $('tabs').addEventListener('click',e=>{const b=e.target.closest('button[data-tab]');if(!b||busy)return;tab=b.dataset.tab;page=0;for(const t of $('tabs').querySelectorAll('button'))t.setAttribute('aria-current',String(t===b));refresh();});
 $('filter').onchange=()=>{page=0;refresh();};$('prev').onclick=()=>{if(page>0){page--;refresh();}};$('next').onclick=()=>{page++;refresh();};$('refresh').onclick=()=>refresh();
 db.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'){version++;authorized=false;gate('You have signed out. Sign in again to continue.');}else if(event==='SIGNED_IN'&&!authorized)setTimeout(()=>refresh(),0);});
 refresh();
})();
