'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const node = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
  const status = $('reader-state'), account = $('reader-account'), logout = $('reader-logout');
  const panels = [];
  let user = null, profile = null, ready = false, authError = false, revision = 0;
  if (!window.supabase?.createClient) { status.textContent = 'Reader service unavailable. Reload to try again.'; return; }
  const db = window.supabase.createClient('https://jyjrgdoeuzlvvpkymqsu.supabase.co', 'sb_publishable_suBMv7WnrejReyIswL19jw_ipsMz5Gr');
  const liked = new Map();
  let likesReady = false, likesError = false, staff = false;
  const adminLink = node('a','Administration Center'); adminLink.href='/admin'; adminLink.hidden=true; account.after(adminLink);
  function paintLike(p) {
    const active = liked.has(p.slug);
    p.like.textContent = active ? '♥ Liked — remove' : '♡ Like article';
    p.like.setAttribute('aria-pressed', String(active));
    p.like.disabled = !ready || authError || p.likeBusy || Boolean(user && (!profile || !likesReady || likesError));
  }
  async function loadLikes(v) {
    try {
      for(let offset=0;;offset+=200) {
        const r=await db.from('reactions').select('article_id,articles(slug)').eq('user_id',user.id).order('article_id').range(offset,offset+199);
        if(v!==revision)return;
        if(r.error)throw r.error;
        for(const item of r.data||[]) if(item.articles?.slug) liked.set(item.articles.slug,item.article_id);
        if((r.data||[]).length<200)break;
      }
      likesReady=true;
    } catch(e) { if(v!==revision)return; likesError=true; }
    if(v===revision) for(const p of panels){paintLike(p); if(likesError)p.likeMessage.textContent='Could not load likes. Reload the page to retry.';}
  }
  async function toggleLike(p) {
    if(!ready||authError||p.likeBusy)return;
    if(!user){location.assign('/account');return;}
    if(!profile||!likesReady||likesError)return;
    const v=revision, uid=user.id;
    p.likeBusy=true; paintLike(p); p.likeMessage.textContent='Saving…';
    try {
      if(liked.has(p.slug)) {
        const r=await db.from('reactions').delete().eq('article_id',liked.get(p.slug)).eq('user_id',uid).select('id');
        if(v!==revision)return;if(r.error)throw r.error;
        if(!r.data?.length)throw new Error('Like not removed');
        liked.delete(p.slug);p.likeMessage.textContent='Like removed.';
      } else {
        const a=await db.from('articles').select('id').eq('slug',p.slug).maybeSingle();
        if(v!==revision)return;if(a.error||!a.data)throw new Error('Article unavailable');
        const r=await db.from('reactions').insert({article_id:a.data.id,user_id:uid});
        if(v!==revision)return;if(r.error&&r.error.code!=='23505')throw r.error;
        liked.set(p.slug,a.data.id);p.likeMessage.textContent='Article liked.';
      }
    } catch(e){if(v===revision)p.likeMessage.textContent='Unable to save like. Reload to retry.';}
    finally {p.likeBusy=false;paintLike(p);}
  }
  function accountLink(label) { const a = node('a',label); a.href='/account'; return a; }
  function updateHeader() {
    status.textContent = !ready ? 'Checking reader session…' : authError ? 'Unable to verify your account.' : user ? (profile ? 'Signed in as ' + profile.display_name : 'Signed in — complete your reader profile') : 'You are browsing as a guest.';
    account.textContent = user ? 'My account' : 'Sign in / Create account'; logout.hidden = !user; adminLink.hidden = !staff || !ready || authError;
  }
  function updateForm(p) {
    p.form.hidden = !(ready && user && profile && p.article?.comments_enabled && !authError);
    p.hint.replaceChildren();
    if (!ready) p.hint.textContent='Checking reader session…';
    else if (authError) p.hint.append('Unable to verify your account. ',accountLink('Open your account'));
    else if (!p.article) p.hint.textContent='Comments are currently unavailable for this article.';
    else if (!p.article.comments_enabled) p.hint.textContent='Comments are closed for this article.';
    else if (!user) p.hint.append(accountLink('Sign in or create a reader account'),' to join the discussion.');
    else if (!profile) p.hint.append(accountLink('Complete your reader profile'),' before commenting.');
    else p.hint.textContent='Commenting as '+profile.display_name+'. Comments are reviewed before publication.';
    if (p.form.hidden) clearReply(p);
  }
  function clearReply(p) { p.parent=null; p.replyInfo.hidden=true; p.replyText.textContent=''; }
  function showComments(p, rows) {
    p.list.replaceChildren();
    if (!rows.length) p.list.append(node('p','No comments yet. Be the first to join the discussion.'));
    for (const c of rows) {
      const card=node('div',undefined,'reader-comment');
      const name=c.profiles?.display_name || 'Reader';
      card.append(node('strong',name),node('span',' · '+new Date(c.created_at).toLocaleString(),'reader-comment-meta'));
      if (c.parent_id) card.append(node('small','Reply to another comment','reader-comment-meta'));
      if (c.status !== 'approved') card.append(node('small',c.status === 'pending' ? 'Awaiting moderation — visible only to you and administrators' : 'Not published ('+c.status+')','reader-comment-meta'));
      card.append(node('p',c.content,'reader-comment-content'));
      if (user && profile && p.article.comments_enabled && c.status==='approved' && !authError) {
        const b=node('button','Reply'); b.type='button'; b.onclick=()=>{p.parent=c.id;p.replyInfo.hidden=false;p.replyText.textContent='Replying to '+name;p.input.focus();}; card.append(b);
      }
      p.list.append(card);
    }
  }
  async function load(p) {
    const request=++p.request;
    const authRev=revision;
    p.list.replaceChildren(node('p','Loading comments…'));
    p.article=null; updateForm(p);
    try {
      const article = await db.from('articles').select('id,comments_enabled').eq('slug',p.slug).maybeSingle();
      if (request!==p.request || authRev!==revision) return;
      if(article.error || !article.data) throw new Error('article unavailable');
      p.article=article.data; updateForm(p);
      let q=db.from('comments').select('id,parent_id,user_id,content,status,created_at,profiles(display_name)').eq('article_id',p.article.id);
      q=user?q.or('status.eq.approved,user_id.eq.'+user.id):q.eq('status','approved');
      const {data,error}=await q.order('created_at',{ascending:false}).limit(100);
      if(request!==p.request || authRev!==revision) return;
      if(error) throw error;
      showComments(p,data || []);
      if(data?.length===100) p.list.append(node('small','Showing the latest 100 visible comments.'));
    } catch(e) { if(request!==p.request || authRev!==revision)return; p.article=null;updateForm(p);p.list.replaceChildren(node('p','Unable to load comments. Use Refresh comments to try again.')); }
  }
  async function updateSession(session) {
    const v=++revision; user=null; profile=null; ready=false; authError=false; staff=false; liked.clear(); likesReady=false; likesError=false;updateHeader();
    for(const p of panels){p.request++;p.list.replaceChildren();p.article=null;clearReply(p);p.input.value='';p.likeMessage.textContent='';paintLike(p);updateForm(p);}
    try {
      if(session) {
        const {data,error}=await db.auth.getUser(); if(v!==revision)return;
        if(error || !data.user) throw new Error('session');
        user=data.user;
        const result=await db.from('profiles').select('display_name').eq('id',user.id).maybeSingle(); if(v!==revision)return;
        if(result.error)throw result.error;
        profile=result.data;
        const role=await db.from('user_roles').select('role').eq('user_id',user.id).maybeSingle();
        if(v!==revision)return;
        staff=!role.error&&['admin','moderator'].includes(role.data?.role);
      }
    } catch(e){if(v!==revision)return;user=null;profile=null;authError=true;}
    if(v!==revision)return;ready=true;updateHeader();
    for(const p of panels){paintLike(p);updateForm(p);if(p.details.open) load(p);}
    if(user&&profile&&!authError)loadLikes(v);
  }
  for(const article of document.querySelectorAll('article[data-article-slug]')) {
    const like=node('button','♡ Like article');like.type='button';like.disabled=true;like.setAttribute('aria-pressed','false');
    const likeMessage=node('span','','reader-hint');likeMessage.setAttribute('role','status');
    const likeRow=node('div',undefined,'reader-discussion');likeRow.append(like,likeMessage);article.append(likeRow);
    const details=node('details',undefined,'reader-discussion');
    const summary=node('summary','Comments / Join the discussion');
    const hint=node('p','Open to view comments.','reader-hint');
    const list=node('div');const refresh=node('button','Refresh comments');refresh.type='button';
    const form=node('form');form.hidden=true;
    const replyInfo=node('div');replyInfo.hidden=true;const replyText=node('span');const cancel=node('button','Cancel reply');cancel.type='button';replyInfo.append(replyText,cancel);
    const label=node('label','Your comment');const input=node('textarea');input.required=true;input.maxLength=3000;input.rows=4;input.placeholder='Share your thoughts…';label.append(input);
    const submit=node('button','Submit comment','reader-primary');submit.type='submit';
    const message=node('p',undefined,'reader-hint');message.setAttribute('role','status');message.setAttribute('aria-live','polite');
    form.append(replyInfo,label,submit);details.append(summary,hint,list,refresh,form,message);article.append(details);
    const p={like,likeMessage,likeBusy:false,details,hint,list,form,input,replyInfo,replyText,slug:article.dataset.articleSlug,article:null,parent:null,request:0,busy:false};panels.push(p);like.onclick=()=>toggleLike(p);
    cancel.onclick=()=>clearReply(p);refresh.onclick=()=>load(p);details.addEventListener('toggle',()=>{if(details.open && ready)load(p);});
    form.addEventListener('submit',async e=>{
      e.preventDefault();if(p.busy || !ready || !user || !profile || !p.article?.comments_enabled || authError)return;
      const content=input.value.trim();if(!content || content.length>3000){message.textContent='Write a comment between 1 and 3000 characters.';return;}
      p.busy=true;submit.disabled=true;message.textContent='Submitting comment…';const v=revision;
      try {
        const {error}=await db.from('comments').insert({article_id:p.article.id,user_id:user.id,parent_id:p.parent,content});
        if(v!==revision)return;if(error)throw error;
        input.value='';clearReply(p);message.textContent='Comment submitted successfully. Awaiting moderation.';await load(p);
      } catch(e){if(v===revision)message.textContent='Your comment could not be submitted. Check your connection and try again.';}
      finally{p.busy=false;submit.disabled=false;}
    });
  }
  logout.addEventListener('click',async()=>{logout.disabled=true;try{const {error}=await db.auth.signOut();if(error)throw error;}catch(e){status.textContent='Unable to sign out. Please try again.';}finally{logout.disabled=false;}});
  function revealArticle(){
    const id=location.hash.slice(1);if(!id.startsWith('article-'))return;
    const target=document.getElementById(id);if(!target)return;
    for(let el=target.parentElement;el;el=el.parentElement)if(el.tagName==='DETAILS')el.open=true;
    target.scrollIntoView({block:'start'});
  }
  revealArticle();window.addEventListener('hashchange',revealArticle);
  updateHeader();
  db.auth.onAuthStateChange((event, session)=>{
    if(['INITIAL_SESSION','SIGNED_IN','SIGNED_OUT','USER_UPDATED'].includes(event)) setTimeout(()=>{
      if(event==='SIGNED_IN' && ready && !authError && user?.id===session?.user?.id) return;
      updateSession(session);
    },0);
  });
})();
