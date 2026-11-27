'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const node = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
  const status = $('reader-state'), account = $('reader-account'), logout = $('reader-logout');
  const panels = [];
  let commentApprovalMode='manual';
  async function refreshApprovalMode(){
    const {data,error}=await db.from('kodes_comment_moderation_settings').select('approval_mode').eq('id',true).maybeSingle();
    if(!error&&['manual','automatic'].includes(data?.approval_mode))commentApprovalMode=data.approval_mode;
  }
  let user = null, profile = null, ready = false, authError = false, revision = 0;
  if (!window.supabase?.createClient) { status.textContent = 'Reader service unavailable. Reload to try again.'; return; }
  const db = window.supabase.createClient('https://jyjrgdoeuzlvvpkymqsu.supabase.co', 'sb_publishable_suBMv7WnrejReyIswL19jw_ipsMz5Gr');
  const liked = new Map();
  const saved = new Map();
  // Commenting needs a server-issued, short-lived N2 Kodes-ID grant.
  // Reading all historic comments remains free.
  let kodesGrant=null,kodesIdentity=null,kodesBusy=false,kodesPopup=null,kodesState='';
  const KODES_ORIGIN='https://app.kodes.com.br';
  const grantValid=()=>Boolean(kodesGrant&&kodesGrant.level>=2&&Date.parse(kodesGrant.expires_at)>Date.now()+5000);
  function repaintGrants(){updateHeader();for(const p of panels)updateForm(p);}
  async function refreshKodesGrant(v=revision){
    if(!user)return;
    try{
      const {data,error}=await db.from('kodes_comment_grants').select('level,expires_at').eq('user_id',user.id).maybeSingle();
      if(v!==revision)return;
      if(error)throw error;
      kodesGrant=data;
    }catch{if(v===revision)kodesGrant=null;}
    if(v===revision)repaintGrants();
  }
  async function refreshKodesIdentity(v=revision){
    if(!user||!profile)return;
    try{
      const {data,error}=await db.functions.invoke('kodes-comment-grant',{
        body:{action:'identity_status'}
      });
      if(v!==revision)return;
      if(error||typeof data?.linked!=='boolean'||!Number.isInteger(data.level))
        throw Error('Unable to verify Kodes identity');
      kodesIdentity={linked:data.linked,level:data.level,canComment:data.can_comment===true,
        nextStep:typeof data.next_step==='string'?data.next_step:'',
        interests:Array.isArray(data.self_declared_areas)?data.self_declared_areas.filter(x=>typeof x==='string').slice(0,9):[],
        publicProfileEnabled:data.public_profile_enabled===true,
        publicProfileUrl:typeof data.public_profile_url==='string'&&
          /^https:\/\/app\.kodes\.com\.br\/users\/[a-f0-9-]{36}$/i.test(data.public_profile_url)
          ?data.public_profile_url:null};
    }catch{if(v===revision)kodesIdentity=null;}
    if(v===revision)repaintGrants();
  }
  async function refreshLinkedKodesGrant(){
    if(!ready||authError||!user||!profile||kodesBusy)return;
    if(!kodesIdentity?.linked||!kodesIdentity.canComment){
      kodesIdentityDialog(false);return;
    }
    kodesBusy=true;
    for(const p of panels)if(p.details.open)p.hint.textContent='Conferindo a associação Kodes-ID no servidor…';
    const authRevision=revision;
    try{
      const {data,error}=await db.functions.invoke('kodes-comment-grant',{
        body:{action:'refresh_linked'},
      });
      if(authRevision!==revision)return;
      if(error||data?.authorized!==true||!Number.isInteger(data.level)||
         data.level<2||data.level>5||!data.expires_at)throw Error('No valid grant');
      kodesGrant={level:data.level,expires_at:data.expires_at};
      repaintGrants();
      const active=panels.find(p=>p.details.open);
      if(active)active.input.focus();
    }catch{
      if(authRevision===revision){
        kodesGrant=null;
        kodesIdentity=null;
        repaintGrants();
        for(const p of panels)if(p.details.open)
          p.hint.textContent='Não foi possível renovar a credencial. Confira seu vínculo Kodes-ID.';
      }
    }finally{kodesBusy=false;}
  }
  function kodesIdentityDialog(recognized=false){
    const old=document.querySelector('.viva-kodes-auth-backdrop');
    if(old)old.remove();
    const backdrop=node('div',undefined,'viva-kodes-auth-backdrop');
    const panel=node('section',undefined,'viva-kodes-auth-panel');
    panel.setAttribute('role','dialog');
    panel.setAttribute('aria-modal','true');
    const title=node('h2',recognized?'Credencial reconhecida.':'Para comentar na Viva Mídia');
    title.id='viva-kodes-dialog-title';
    panel.setAttribute('aria-labelledby',title.id);
    const logo=node('div','K · KODES-ID   |   VIVA MÍDIA','viva-kodes-auth-brand');
    const step=node('small',recognized?'CREDENCIAL VALIDADA':'PASSO 1 DE 2 · SUA IDENTIDADE','viva-kodes-auth-step');
    const intro=node('p',recognized
      ?'O servidor reconheceu sua autorização para participar das discussões deste portal.'
      :'Os comentários são assinados por nome e nível. Entre na Viva Mídia e confirme seu Kodes-ID, sem criar contas duplicadas.');
    const actions=node('div',undefined,'viva-kodes-auth-actions');
    const close=node('button','Fechar');
    close.type='button';close.className='viva-kodes-auth-close';
    let alive=true;
    const key=e=>{if(e.key==='Escape')dismiss();};
    function dismiss(){
      if(!alive)return;alive=false;backdrop.remove();document.removeEventListener('keydown',key);
    }
    close.onclick=dismiss;backdrop.onclick=e=>{if(e.target===backdrop)dismiss();};
    panel.append(logo,step,title,intro);
    if(recognized&&grantValid()){
      const card=node('div',undefined,'viva-kodes-auth-credential');
      card.append(node('small','KODES-ID · AUTORIZAÇÃO DE COMENTÁRIOS'),
        node('strong','N'+kodesGrant.level),
        node('p','Comentarista · Acesso autorizado neste portal'),
        node('small','Ativa nesta sessão de autorização. Não comprova identidade civil, profissão ou especialidade.'));
      panel.append(card);
      const action=node('button','Voltar ao artigo e comentar');
      action.type='button';action.className='viva-kodes-auth-primary';
      action.onclick=()=>{
        dismiss();
        const visible=panels.find(p=>p.details.open);
        if(visible)visible.input.focus();
      };
      actions.append(action);
    }else{
      const action=node('button',user&&profile?'Continuar com Kodes-ID':'Entrar na Viva Mídia');
      action.type='button';action.className='viva-kodes-auth-primary';
      action.onclick=()=>{
        dismiss();
        if(!user||!profile)location.assign('/account');
        else authorizeKodes();
      };
      actions.append(action);
      panel.append(node('small',user&&profile
       ?'Sua conta Viva Mídia está autenticada. O Kodes verificará sua credencial no próximo passo.'
       :'Leitura livre. Para comentar, primeiro confirme sua conta no portal.'));
    }
    actions.append(close);panel.append(actions);backdrop.append(panel);
    document.body.append(backdrop);document.addEventListener('keydown',key);close.focus();
  }
  function authorizeKodes(){
    if(!ready||authError||!user||!profile||kodesBusy)return;
    if(!['https://vivamidia.com.br','https://www.vivamidia.com.br'].includes(location.origin))return;
    if(kodesPopup&&!kodesPopup.closed){kodesPopup.focus();return;}
    kodesState=Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,'0')).join('');
    const params=new URLSearchParams({state:kodesState,origin:location.origin});
    kodesPopup=window.open(KODES_ORIGIN+'/autorizar-comentario-viva?'+params,'viva-kodes-comments','width=650,height=760');
    if(!kodesPopup)for(const p of panels)if(p.details.open)p.hint.textContent='Permita a janela Kodes-ID no navegador e tente novamente.';
  }
  window.addEventListener('message',async event=>{
    if(event.origin!==KODES_ORIGIN||event.source!==kodesPopup||
      event.data?.type!=='kodes:viva:comment-authorization'||
      event.data?.state!==kodesState||
      typeof event.data?.ticket!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(event.data.ticket)||
      !user||kodesBusy)return;
    kodesState='';kodesBusy=true;
    const authRevision=revision;
    for(const p of panels)if(p.details.open)p.hint.textContent='Conferindo seu Kodes-ID com o servidor…';
    try{
      const {data,error}=await db.functions.invoke('kodes-comment-grant',{body:{ticket:event.data.ticket}});
      if(authRevision!==revision)return;
      if(error||data?.authorized!==true||!Number.isInteger(data.level)||data.level<2||!data.expires_at)
        throw Error('Authorization failed');
      kodesGrant={level:data.level,expires_at:data.expires_at};
      kodesPopup?.close();kodesPopup=null;
      await refreshKodesIdentity(authRevision);
      if(authRevision!==revision)return;
      repaintGrants();
      document.querySelector('.viva-kodes-auth-backdrop')?.remove();
      for(const p of panels)if(p.details.open){p.hint.textContent='Kodes-ID confirmado. Você já pode comentar.';p.input.focus();}
    }catch{
      if(authRevision!==revision)return;
      kodesGrant=null;repaintGrants();
      for(const p of panels)if(p.details.open)p.hint.textContent='Não foi possível validar seu Kodes-ID. Clique novamente em Ativar Kodes-ID.';
    }finally{kodesBusy=false;}
  });
  let likesReady = false, likesError = false, staff = false;
  const adminLink = node('a','Administration Center'); adminLink.href='/admin'; adminLink.hidden=true; account.after(adminLink);
  function paintLike(p){
    const reaction=liked.get(p.slug)?.type;
    p.like.textContent=reaction==='like'?'👍 Relevante · desfazer':'👍 Relevante';
    p.disagree.textContent=reaction==='disagree'?'👎 Discordo · desfazer':'👎 Discordo';
    p.like.setAttribute('aria-pressed',String(reaction==='like'));
    p.disagree.setAttribute('aria-pressed',String(reaction==='disagree'));
    const blocked=!ready||authError||p.likeBusy||Boolean(user&&(!profile||!likesReady||likesError));
    p.like.disabled=blocked;p.disagree.disabled=blocked;
    p.save.textContent=saved.has(p.slug)?'🔖 Salvo · remover':'🔖 Salvar';
    p.save.setAttribute('aria-pressed',String(saved.has(p.slug)));
    p.save.disabled=!ready||authError||p.saveBusy||Boolean(user&&!profile);
  }
  async function loadLikes(v){
    try{
      for(let offset=0;;offset+=200){
        const r=await db.from('reactions').select('article_id,reaction_type,articles(slug)')
          .eq('user_id',user.id).order('article_id').range(offset,offset+199);
        if(v!==revision)return;if(r.error)throw r.error;
        for(const item of r.data||[])if(item.articles?.slug)
          liked.set(item.articles.slug,{id:item.article_id,type:item.reaction_type});
        if((r.data||[]).length<200)break;
      }
      likesReady=true;
    }catch{if(v!==revision)return;likesError=true;}
    if(v===revision)for(const p of panels){
      paintLike(p);if(likesError)p.likeMessage.textContent='Não foi possível consultar suas reações.';
    }
  }
  async function toggleLike(p,kind){
    if(!['like','disagree'].includes(kind)||!ready||authError||p.likeBusy)return;
    if(!user||!profile){location.assign('/account');return;}
    if(!likesReady||likesError)return;
    const v=revision,uid=user.id; p.likeBusy=true;paintLike(p);
    p.likeMessage.textContent='Salvando reação…';
    try{
      const old=liked.get(p.slug);
      if(old?.type===kind){
        const r=await db.from('reactions').delete().eq('article_id',old.id)
          .eq('user_id',uid).select('id');
        if(v!==revision)return;if(r.error||!r.data?.length)throw Error();
        liked.delete(p.slug);p.likeMessage.textContent='Reação removida.';
      }else if(old){
        const r=await db.from('reactions').update({reaction_type:kind})
          .eq('article_id',old.id).eq('user_id',uid).select('id');
        if(v!==revision)return;if(r.error||!r.data?.length)throw Error();
        liked.set(p.slug,{id:old.id,type:kind});p.likeMessage.textContent='Reação atualizada.';
      }else{
        const a=await db.from('articles').select('id').eq('slug',p.slug).maybeSingle();
        if(v!==revision)return;if(a.error||!a.data)throw Error();
        const r=await db.from('reactions').insert({article_id:a.data.id,user_id:uid,reaction_type:kind});
        if(v!==revision)return;if(r.error)throw r.error;
        liked.set(p.slug,{id:a.data.id,type:kind});p.likeMessage.textContent='Reação registrada.';
      }
    }catch{if(v===revision)p.likeMessage.textContent='Não foi possível salvar sua reação.';}
    finally{p.likeBusy=false;paintLike(p);}
  }
  async function loadSaved(v){
    if(!user)return;
    try{
      for(let offset=0;;offset+=200){
        const r=await db.from('kodes_saved_articles').select('article_id,articles(slug)')
          .eq('user_id',user.id).order('article_id').range(offset,offset+199);
        if(v!==revision)return;if(r.error)throw r.error;
        for(const x of r.data||[])if(x.articles?.slug)saved.set(x.articles.slug,x.article_id);
        if((r.data||[]).length<200)break;
      }
      if(v===revision)for(const p of panels)paintLike(p);
    }catch{if(v===revision)for(const p of panels)
      p.likeMessage.textContent='Artigos salvos indisponíveis no momento.';}
  }
  async function toggleSave(p){
    if(p.saveBusy||!ready||authError)return;
    if(!user||!profile){location.assign('/account');return;}
    const v=revision;p.saveBusy=true;paintLike(p);
    try{
      const existing=saved.get(p.slug);
      if(existing){
        const r=await db.from('kodes_saved_articles').delete()
          .eq('article_id',existing).eq('user_id',user.id).select('article_id');
        if(v!==revision)return;if(r.error||!r.data?.length)throw Error();
        saved.delete(p.slug);p.likeMessage.textContent='Artigo removido dos salvos.';
      }else{
        const a=await db.from('articles').select('id').eq('slug',p.slug).maybeSingle();
        if(v!==revision)return;if(a.error||!a.data)throw Error();
        const r=await db.from('kodes_saved_articles').insert({article_id:a.data.id,user_id:user.id});
        if(v!==revision)return;if(r.error)throw r.error;
        saved.set(p.slug,a.data.id);p.likeMessage.textContent='Artigo salvo.';
      }
    }catch{if(v===revision)p.likeMessage.textContent='Não foi possível salvar este artigo.';}
    finally{p.saveBusy=false;paintLike(p);}
  }
  async function shareArticle(p){
    const target=[...document.querySelectorAll('article[data-article-slug]')]
      .find(x=>x.dataset.articleSlug===p.slug);
    if(!target?.id)return;
    const url=new URL(location.href);url.hash=target.id;
    try{
      if(navigator.share)await navigator.share({url:url.href,title:target.querySelector('h3')?.textContent||document.title});
      else if(navigator.clipboard?.writeText){
        await navigator.clipboard.writeText(url.href);
        p.likeMessage.textContent='Link copiado.';
      }else p.likeMessage.textContent='Compartilhe: '+url.href;
    }catch{/* Sharing cancelled by the visitor. */}
  }
  function accountLink(label) { const a = node('a',label); a.href='/account'; return a; }
  function updateHeader() {
    status.textContent = !ready ? 'Checking reader session…' : authError ? 'Unable to verify your account.' : user ? (profile ? 'Signed in as ' + profile.display_name : 'Signed in — complete your reader profile') : 'You are browsing as a guest.';
    account.textContent = user ? 'Minha conta Viva' : 'Entrar na Viva'; logout.hidden = !user; adminLink.hidden = !staff || !ready || authError;
    const identityStatus=$('kodes-reader-status');
    if(identityStatus){
      const linked=Boolean(kodesIdentity?.linked);
      const level=linked?kodesIdentity.level:grantValid()?kodesGrant.level:0;
      identityStatus.textContent=linked
        ?'Kodes-ID · N'+level+' · identidade vinculada'+(grantValid()?' · autorizado para comentar':'')
        :grantValid()?'Kodes-ID · N'+kodesGrant.level+' autorizado para comentar'
        :'Kodes-ID · Ativar identidade';
      identityStatus.classList.toggle('is-verified',linked||grantValid());
      identityStatus.setAttribute('aria-label',identityStatus.textContent);
      if(linked){
        identityStatus.setAttribute('aria-haspopup','dialog');
        identityStatus.onclick=event=>{event.preventDefault();openKodesJourney();};
      }else{
        identityStatus.removeAttribute('aria-haspopup');
        identityStatus.onclick=null;
      }
    }
  }
  function openKodesJourney(){
    if(!user||!kodesIdentity?.linked)return;
    const previousFocus=document.activeElement;
    const backdrop=node('div',undefined,'reader-kodes-profile-backdrop');
    const dialog=node('section',undefined,'reader-kodes-profile-panel');
    dialog.setAttribute('role','dialog');
    dialog.setAttribute('aria-modal','true');
    const heading=node('h3','Minha identidade Kodes-ID');
    heading.id='kodes-own-journey-title';
    dialog.setAttribute('aria-labelledby',heading.id);
    const level=kodesIdentity.level;
    const close=node('button','Fechar');
    close.type='button';
    const dismiss=()=>{
      backdrop.remove();
      document.removeEventListener('keydown',keyboard);
      if(previousFocus?.isConnected&&typeof previousFocus.focus==='function')previousFocus.focus();
    };
    const keyboard=event=>{if(event.key==='Escape')dismiss();};
    close.onclick=dismiss;
    backdrop.onclick=event=>{if(event.target===backdrop)dismiss();};
    const credential=node('div',undefined,'reader-kodes-credential-summary');
    credential.append(node('small','KODES-ID · VIVA MÍDIA · VÍNCULO CONFIRMADO'),
      node('strong',profile?.display_name||'Leitor Viva Mídia'),
      node('p','N'+level+' · '+(['','Leitor','Comentarista','Colaborador','Autor','Editor'][level]||'Participante')),
      node('small','Seu nível é consultado no servidor Kodes. Autorias e especialidades são aprovadas por site.'));
    dialog.append(heading,credential);
    if(kodesIdentity.interests?.length)
      dialog.append(node('p','Áreas declaradas: '+kodesIdentity.interests.join(' · ')));
    const progression=node('ol');
    const descriptions=[
      'Conta pessoal com e-mail confirmado',
      'Credencial N2 e declaração de responsabilidade',
      'Texto aprovado ou coassinado pela redação',
      '100 Créditos Kodes auditáveis e aprovação editorial',
      'Designação editorial explícita'
    ];
    ['Leitor','Comentarista','Colaborador','Autor','Editor'].forEach((label,index)=>{
      const item=node('li',(index+1<=level?'✓ ':'○ ')+'N'+(index+1)+' · '+label+' — '+descriptions[index]);
      item.style.margin='8px 0';progression.append(item);
    });
    dialog.append(node('h4','Sua trajetória'),progression);
    if(kodesIdentity.nextStep)dialog.append(node('p',kodesIdentity.nextStep));
    if(kodesIdentity.publicProfileEnabled&&kodesIdentity.publicProfileUrl){
      const publicLink=node('a','Ver meu perfil público Kodes-ID');
      publicLink.href=kodesIdentity.publicProfileUrl;
      publicLink.target='_blank';publicLink.rel='noopener noreferrer';
      dialog.append(publicLink);
    }else{
      dialog.append(node('p','Seu perfil público está privado. A publicação exige uma autorização específica no painel Kodes.'));
    }
    const options=node('div',undefined,'reader-kodes-journey-actions');
    const routes=[
      ['/dashboard/comments','Minhas participações'],
      ['/dashboard/kodes-id','Minha credencial e progressão'],
      ['/contas-conectadas','Configurar perfil público'],
    ];
    for(const [path,label] of routes){
      const link=node('a',label);
      link.href=KODES_ORIGIN+path;link.target='_blank';link.rel='noopener noreferrer';
      options.append(link);
    }
    dialog.append(options,close);
    backdrop.append(dialog);
    document.body.append(backdrop);
    document.addEventListener('keydown',keyboard);
    close.focus();
  }
  function updateForm(p) {
    const canComment=ready&&user&&profile&&p.article?.comments_enabled&&!authError;
    p.form.hidden=!(canComment&&grantValid());
    p.gateButton.hidden=!(p.article?.comments_enabled&&!grantValid()&&ready&&!authError);
    p.gateButton.textContent=!user?'Entrar para comentar':!profile?'Completar cadastro da Viva':'Continuar com Kodes-ID · N2';
    p.gateButton.disabled=kodesBusy;
    p.hint.replaceChildren();
    if (!ready) p.hint.textContent='Checking reader session…';
    else if (authError) p.hint.append('Unable to verify your account. ',accountLink('Open your account'));
    else if (!p.article) p.hint.textContent='Comments are currently unavailable for this article.';
    else if (!p.article.comments_enabled) p.hint.textContent='Comments are closed for this article.';
    else if (!user) p.hint.append('Comentários assinados por nome e nível. ',accountLink('Entre com sua conta Viva Mídia'),' e confirme seu Kodes-ID para participar.');
    else if (!profile) p.hint.append(accountLink('Complete your reader profile'),' before commenting.');
    else if(!grantValid()&&kodesIdentity?.linked&&kodesIdentity.canComment)
      p.hint.textContent='Seu Kodes-ID está vinculado e reconhecido. Clique para comentar: a autorização será renovada pelo servidor, sem novo cadastro.';
    else if(!grantValid())p.hint.textContent='Para comentar ou responder, vincule seu Kodes-ID e confirme o nível N2. Seus comentários anteriores permanecem visíveis.';
    else p.hint.textContent='Kodes-ID N2 confirmado. Comentando como '+profile.display_name+'. '+(commentApprovalMode==='automatic'?'Publicação automática habilitada pela redação.':'Sujeito à aprovação editorial.');
    // Preserve drafts and reply targets during Kodes-ID authorization.
    if(!canComment)clearReply(p);
  }
  function clearReply(p) { p.parent=null; p.replyInfo.hidden=true; p.replyText.textContent=''; restoreCommentForm(p); }
  // A reply is a child of its parent, not another top-level comment.
  // Existing parent_id values remain untouched; only the presentation changes.
  const threadedStyle=document.createElement('style');
  threadedStyle.textContent=[
    '.reader-comment{min-width:0}',
    '.reader-comment-thread{margin:8px 0 14px}',
    '.reader-thread-children{margin:8px 0 0 17px;padding:0 0 0 12px;border-left:2px solid var(--accent,#ff6204)}',
    '.reader-thread-children>.reader-comment-thread{margin:8px 0}',
    '.reader-comment-depth{font:600 11px/1.3 system-ui,sans-serif;color:var(--mute,#777)}',
    '.reader-comment-actions{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 3px}',
    '.reader-comment-author{cursor:pointer;background:transparent;border:none;padding:0;color:inherit;text-decoration:underline;text-underline-offset:3px;font:inherit;font-weight:700}',
    '.reader-kodes-verified{display:inline-flex;gap:5px;align-items:center;padding:3px 7px;border:1px solid #b7d89f;background:#eff8e8;color:#234c1e;border-radius:6px;font:700 11px/1.3 system-ui,sans-serif;cursor:pointer}',
    '.reader-kodes-verified:focus-visible{outline:2px solid #236f39;outline-offset:2px}',
    '.reader-kodes-verified .kodes-kmark{display:inline-grid;place-items:center;width:19px;height:19px;border-radius:4px;background:#19325c;color:#fff;font-weight:900;font-size:13px}',
    '.reader-kodes-verified{border-radius:8px;background:#f4f8fd;border-color:#c5d5ea;color:#18345e;font-weight:800}',
    '.reader-reply-compose{margin:9px 0 10px;padding:12px;border-radius:10px;border:1px solid var(--line,#ddd);background:var(--card,#fff)}',
    '.reader-kodes-profile-backdrop{position:fixed;z-index:2147482500;inset:0;display:grid;place-items:center;background:#17221dcc;padding:14px}',
    '.reader-kodes-profile-panel{width:min(400px,100%);max-height:85vh;overflow:auto;background:var(--card,#fff);color:var(--ink,#111);border:1px solid var(--line,#ddd);border-radius:16px;padding:24px;box-shadow:0 24px 60px #0003;font:14px/1.6 system-ui,sans-serif}',
    '.reader-kodes-profile-panel h3{margin:0 0 8px;font-size:22px;line-height:1.25}',
    '.reader-kodes-credential-summary{border:1px solid #b8d0ed;background:#f3f7fc;border-radius:12px;padding:13px 15px;color:#142e55;margin:12px 0}',
    '.reader-kodes-credential-summary p{margin:6px 0;font-size:12px}',
    '.reader-kodes-credential-summary small{font-size:11px;color:#4c5b70}',
    '.reader-kodes-profile-panel button{margin-top:10px;border:1px solid var(--line,#ddd);background:transparent;padding:8px 15px;border-radius:8px;cursor:pointer}',
    '.reader-kodes-journey-actions{display:flex;flex-wrap:wrap;gap:8px;margin:15px 0}',
    '.reader-kodes-journey-actions a{display:inline-flex;align-items:center;padding:9px 12px;border-radius:8px;background:#14264c;color:#fff;font:700 12px/1.4 system-ui,sans-serif;text-decoration:none}',
    '.viva-kodes-auth-backdrop{position:fixed;z-index:2147483000;inset:0;background:rgba(12,18,34,.65);display:grid;place-items:center;padding:16px}',
    '.viva-kodes-auth-panel{background:#fff;color:#161b21;width:min(490px,100%);max-height:85vh;overflow:auto;border-radius:17px;border-top:4px solid #ff6204;padding:25px;box-shadow:0 25px 70px #0004;font:14px/1.6 system-ui,sans-serif}',
    '.viva-kodes-auth-brand{font-weight:850;letter-spacing:.05em;color:#14264c;border-bottom:1px solid #e4e4e4;padding-bottom:14px;margin-bottom:19px}',
    '.viva-kodes-auth-step{color:#e85d0a;font-weight:900;letter-spacing:.09em}',
    '.viva-kodes-auth-panel h2{font-size:23px;line-height:1.2;margin:11px 0}',
    '.viva-kodes-auth-panel p{color:#57616d}',
    '.viva-kodes-auth-credential{background:#141414;color:#fff;border-radius:16px;margin:18px 0;padding:20px;display:flex;flex-direction:column;gap:6px}',
    '.viva-kodes-auth-credential strong{font:800 58px/1 Georgia,serif;color:#ff6204}',
    '.viva-kodes-auth-credential p{color:#f4f4f4;margin:0}',
    '.viva-kodes-auth-credential small{color:#bcbcbc}',
    '.viva-kodes-auth-actions{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-top:20px}',
    '.viva-kodes-auth-actions button{padding:11px 15px;border-radius:9px;cursor:pointer}',
    '.viva-kodes-auth-primary{background:#111!important;color:#fff!important;border:1px solid #111!important;font-weight:800}',
    '.viva-kodes-auth-close{background:#fff!important;border:1px solid #ccc!important}',
    '@media(max-width:480px){.reader-thread-children{margin-left:7px;padding-left:9px}}'
  ].join('');
  document.head.append(threadedStyle);

  const KODES_PROFILE_API='https://marwnbmablxzziyvhxof.supabase.co/functions/v1/kodes-public-participant';
  const KODES_SITE='7554902f-4506-494e-8f69-50e4cef8e767';
  const publicCards=new Map();
  const consentedCard=userId=>{
    if(typeof userId!=='string'||!/^[0-9a-f-]{36}$/i.test(userId))return Promise.resolve(null);
    if(!publicCards.has(userId)){
      const url=new URL(KODES_PROFILE_API);
      url.searchParams.set('site',KODES_SITE);url.searchParams.set('user',userId);
      const query=fetch(url,{method:'GET',mode:'cors',credentials:'omit',cache:'no-store'})
        .then(r=>{if(!r.ok)throw Error('Profile lookup unavailable');return r.json()})
        .then(info=>info?.published===true&&info?.identity_type==='consented_kodes_account'&&
           typeof info.display_name==='string'&&Number.isInteger(info.level)&&
           info.level>=1&&info.level<=5?info:null)
        .catch(()=>null);
      publicCards.set(userId,query);
    }
    return publicCards.get(userId);
  };
  function openParticipantProfile(name,visibleCount,userId,signature=null){
    const existing=document.querySelector('.reader-kodes-profile-backdrop');
    if(existing)existing.remove();
    const previousFocus=document.activeElement;
    const backdrop=node('div',undefined,'reader-kodes-profile-backdrop');
    const dialog=node('section',undefined,'reader-kodes-profile-panel');
    dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
    const title=node('h3',name);title.id='reader-profile-title-'+Math.random().toString(36).slice(2);
    dialog.setAttribute('aria-labelledby',title.id);
    const close=node('button','Fechar');close.type='button';
    let active=true;
    const stop=e=>{if(e.key==='Escape')dismiss();};
    const dismiss=()=>{
      active=false;backdrop.remove();document.removeEventListener('keydown',stop);
      if(previousFocus?.isConnected&&typeof previousFocus.focus==='function')previousFocus.focus();
    };
    close.onclick=dismiss;backdrop.onclick=e=>{if(e.target===backdrop)dismiss()};
    const proof=node('div',undefined,'reader-kodes-credential-summary');
    if(signature&&Number.isInteger(signature.level)&&signature.level>=2){
      proof.append(node('strong','Kodes-ID · N'+signature.level+' · '+
        (['','Leitor','Comentarista','Colaborador','Autor','Editor'][signature.level]||'Participante')),
        node('p','Concedido por: Kodes-ID · verificação de participação no momento da publicação.'),
        node('small','Esta credencial não comprova identidade civil, profissão ou especialidade.'));
    }
    const publicInfo=node('div','Consultando autorização do perfil Kodes…','reader-comment-meta');
    publicInfo.setAttribute('role','status');
    dialog.append(title,
      node('p','Perfil do comentarista neste portal','reader-comment-meta'),
      node('p',visibleCount+' comentário(s) aprovado(s) nesta discussão carregada.'),
      proof,publicInfo,close);
    backdrop.append(dialog);document.body.append(backdrop);
    document.addEventListener('keydown',stop);close.focus();
    void consentedCard(userId).then(info=>{
      if(!active)return;
      publicInfo.replaceChildren();
      if(!info){
        publicInfo.append(node('p','Perfil Kodes-ID não disponibilizado publicamente por este participante ou temporariamente indisponível.'));
        return;
      }
      publicInfo.append(
        node('p','Identidade pública consentida no Kodes: '+info.display_name),
        node('p','Participação Kodes-ID N'+info.level+' · '+(
          ['','Leitor','Comentarista','Colaborador','Autor','Editor'][info.level]||'Participante')+
          (info.level>=3?' · credencial editorial verificada neste site':' · autodeclaração de interesses')),
      );
      if(info.headline)publicInfo.append(node('p',info.headline));
      if(Array.isArray(info.self_declared_areas)&&info.self_declared_areas.length){
        publicInfo.append(node('p','Áreas de interesse declaradas: '+info.self_declared_areas.filter(x=>typeof x==='string').join(' · ')));
      }
      if(typeof info.public_profile_url==='string'){
        try{
          const url=new URL(info.public_profile_url);
          if(url.origin===KODES_ORIGIN&&/^\/users\/[a-f0-9-]{36}$/i.test(url.pathname)){
            const link=node('a','Ver perfil público no Kodes-ID');link.href=url.href;
            link.target='_blank';link.rel='noopener noreferrer';
            publicInfo.append(link);
          }
        }catch{/* Invalid public profile URL is ignored. */}
      }
      publicInfo.append(node('small','N2 confirma e-mail e declaração de responsabilidade, não identidade civil, profissão ou especialidade.'));
    });
  }
  function showComments(p, rows) {
    p.list.replaceChildren();
    p.commentCards=new Map();
    if(!rows.length) {
      p.list.append(node('p','Ainda não há comentários. Inicie a discussão.'));
      restoreCommentForm(p);
      return;
    }
    const index=new Map(rows.map(c=>[c.id,{comment:c,children:[]}]));
    const roots=[];
    for(const c of rows){
      const entry=index.get(c.id);
      const parent=c.parent_id&&index.get(c.parent_id);
      // Missing parents can occur with a paginated result or a moderated
      // hidden parent. Never discard the reply or invent the missing content.
      if(parent&&parent!==entry)parent.children.push(entry);
      else roots.push(entry);
    }
    roots.sort((a,b)=>b.comment.created_at.localeCompare(a.comment.created_at));
    for(const record of index.values())
      record.children.sort((a,b)=>a.comment.created_at.localeCompare(b.comment.created_at));
    const visited=new Set();
    const render=(entry,depth=0)=>{
      if(visited.has(entry.comment.id))return null; // handles inconsistent cycles
      visited.add(entry.comment.id);
      const c=entry.comment;
      const holder=node('div',undefined,'reader-comment-thread');
      const card=node('div',undefined,'reader-comment');
      card.dataset.commentId=c.id;
      const name=c.profiles?.display_name||'Leitor';
      const byline=node('div',undefined,'reader-comment-byline');
      const identity=node('button',name,'reader-comment-author');
      identity.type='button';
      identity.setAttribute('aria-label','Abrir perfil do participante '+name);
      // Only show verified N-level if the server captured an actual grant at publication.
      const stamped=Array.isArray(c.kodes_comment_signatures)
        ?c.kodes_comment_signatures[0]:c.kodes_comment_signatures;
      const viewProfile=()=>openParticipantProfile(name,rows.filter(x=>x.user_id===c.user_id&&x.status==='approved').length,c.user_id,stamped);
      identity.onclick=viewProfile;
      byline.append(identity);
      if(stamped&&Number.isInteger(stamped.level)&&stamped.level>=2){
        const badge=node('button',undefined,'reader-kodes-verified');
        badge.type='button';
        badge.setAttribute('aria-label','Ver credencial Kodes-ID N'+stamped.level+' deste comentário');
        const mark=node('span','K','kodes-kmark');
        const title=['','Leitor','Comentarista','Colaborador','Autor','Editor'][stamped.level]||'Participante';
        badge.append(mark,node('span','N'+stamped.level+' · '+title));
        badge.onclick=viewProfile;
        byline.append(badge);
      }
      byline.append(node('span',' · '+new Date(c.created_at).toLocaleString('pt-BR'),'reader-comment-meta'));
      card.append(byline);
      if(c.parent_id&&!index.has(c.parent_id))
        card.append(node('small','Resposta a um comentário não disponível nesta lista','reader-comment-depth'));
      if(c.status!=='approved')
        card.append(node('small',c.status==='pending'
          ?'Aguardando moderação — visível apenas para você e administradores'
          :'Não publicado ('+c.status+')','reader-comment-meta'));
      card.append(node('p',c.content,'reader-comment-content'));
      if(user&&profile&&p.article.comments_enabled&&c.status==='approved'&&!authError){
        const actions=node('div',undefined,'reader-comment-actions');
        const reply=node('button','Responder');reply.type='button';
        reply.onclick=()=>{
          p.parent=c.id;
          p.replyInfo.hidden=false;
          p.replyText.textContent='Respondendo a '+name;
          p.form.classList.add('reader-reply-compose');
          holder.append(p.form);
          if(!grantValid()&&kodesIdentity?.linked&&kodesIdentity.canComment)void refreshLinkedKodesGrant();
          else if(!grantValid())authorizeKodes();
          else p.input.focus();
        };
        actions.append(reply);card.append(actions);
      }
      holder.append(card);
      p.commentCards.set(c.id,holder);
      if(entry.children.length){
        const replies=node('div',undefined,'reader-thread-children');
        for(const child of entry.children){const element=render(child,depth+1);if(element)replies.append(element)}
        if(replies.childNodes.length)holder.append(replies);
      }
      return holder;
    };
    for(const root of roots){const element=render(root);if(element)p.list.append(element)}
    // Defensive fallback for malformed cycles: keep historic comments visible.
    for(const entry of index.values())if(!visited.has(entry.comment.id)){
      const element=render(entry);if(element)p.list.append(element);
    }
    restoreCommentForm(p);
  }
  function restoreCommentForm(p){
    if(!p.formHome)return;
    const target=p.parent&&p.commentCards?.get(p.parent);
    if(target){p.form.classList.add('reader-reply-compose');target.append(p.form);}
    else{
      if(p.parent){p.parent=null;p.replyInfo.hidden=true;p.replyText.textContent='';}
      p.form.classList.remove('reader-reply-compose');
      p.formHome.append(p.form);
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
      p.article=article.data; await refreshApprovalMode(); updateForm(p);
      let q=db.from('comments').select('id,parent_id,user_id,content,status,created_at,profiles(display_name),kodes_comment_signatures(level,verified_at)').eq('article_id',p.article.id);
      q=user?q.or('status.eq.approved,user_id.eq.'+user.id):q.eq('status','approved');
      const {data,error}=await q.order('created_at',{ascending:false}).limit(300);
      if(request!==p.request || authRev!==revision) return;
      if(error) throw error;
      showComments(p,data || []);
      if(data?.length===300) p.list.append(node('small','Exibindo os 300 comentários visíveis mais recentes; algumas respostas antigas podem não aparecer.'));
    } catch(e) { if(request!==p.request || authRev!==revision)return; p.article=null;updateForm(p);p.list.replaceChildren(node('p','Unable to load comments. Use Refresh comments to try again.')); }
  }
  async function updateSession(session) {
    const v=++revision;user=null;profile=null;ready=false;authError=false;staff=false;liked.clear();saved.clear();likesReady=false;likesError=false;kodesGrant=null;kodesIdentity=null;updateHeader();
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
    if(user&&profile&&!authError){loadLikes(v);void loadSaved(v);void refreshKodesGrant(v);void refreshKodesIdentity(v);}
  }
  for(const article of document.querySelectorAll('article[data-article-slug]')) {
    const like=node('button','👍 Relevante');like.type='button';like.disabled=true;like.setAttribute('aria-pressed','false');
    const disagree=node('button','👎 Discordo');disagree.type='button';disagree.disabled=true;disagree.setAttribute('aria-pressed','false');
    const save=node('button','🔖 Salvar');save.type='button';save.disabled=true;save.setAttribute('aria-pressed','false');
    const share=node('button','↗ Compartilhar');share.type='button';
    const likeMessage=node('span','','reader-hint');likeMessage.setAttribute('role','status');
    const kodesPanel=node('section',undefined,'kodes-article-identity');
    kodesPanel.setAttribute('aria-label','Participação Kodes-ID neste artigo');
    const eyebrow=node('span','K · KODES-ID','kodes-article-eyebrow');
    const headline=node('strong','Sua identidade acompanha cada comentário.');
    const description=node('p','Comentários identificados por nível Kodes-ID. A moderação segue as regras da Viva Mídia.');
    const actions=node('div',undefined,'kodes-article-actions');
    const openDiscussion=node('button','Comentar com Kodes-ID');openDiscussion.type='button';
    openDiscussion.onclick=()=>{details.open=true;details.scrollIntoView({behavior:'smooth',block:'start'});};
    const learn=node('a','Entenda os níveis Kodes-ID');
    learn.href=KODES_ORIGIN+'/participar?site=7554902f-4506-494e-8f69-50e4cef8e767&intent=identity';
    learn.target='_blank';learn.rel='noopener noreferrer';
    actions.append(openDiscussion,learn);
    kodesPanel.append(eyebrow,headline,description,actions);
    article.append(kodesPanel);
    const likeRow=node('div',undefined,'reader-discussion kodes-reaction-actions');
    likeRow.append(like,disagree,save,share,likeMessage);article.append(likeRow);
    const details=node('details',undefined,'reader-discussion');
    const summary=node('summary','Comentários · Participe da discussão');
    const hint=node('p','Somente participantes com credencial Kodes-ID N2 ou superior podem comentar.','reader-hint');
    const list=node('div');const refresh=node('button','Atualizar comentários');refresh.type='button';
    const gateButton=node('button','Continuar com Kodes-ID','reader-primary');
    gateButton.type='button';gateButton.hidden=true;
    const formHome=node('div',undefined,'reader-compose-home');
    const form=node('form');form.hidden=true;
    const replyInfo=node('div');replyInfo.hidden=true;const replyText=node('span');const cancel=node('button','Cancel reply');cancel.type='button';replyInfo.append(replyText,cancel);
    const label=node('label','Seu comentário');const input=node('textarea');input.required=true;input.maxLength=3000;input.rows=4;input.placeholder='Share your thoughts…';label.append(input);
    const submit=node('button','Publicar comentário','reader-primary');submit.type='submit';
    const message=node('p',undefined,'reader-hint');message.setAttribute('role','status');message.setAttribute('aria-live','polite');
    form.append(replyInfo,label,submit);formHome.append(form);details.append(summary,hint,list,refresh,gateButton,formHome,message);article.append(details);
    const p={like,disagree,save,share,likeMessage,likeBusy:false,saveBusy:false,details,hint,list,form,gateButton,input,replyInfo,replyText,formHome,slug:article.dataset.articleSlug,article:null,parent:null,request:0,busy:false};
    panels.push(p);like.onclick=()=>toggleLike(p,'like');disagree.onclick=()=>toggleLike(p,'disagree');
    save.onclick=()=>toggleSave(p);share.onclick=()=>shareArticle(p);
    gateButton.onclick=()=>{
      if(kodesIdentity?.linked&&kodesIdentity.canComment)void refreshLinkedKodesGrant();
      else kodesIdentityDialog(false);
    };
    cancel.onclick=()=>clearReply(p);refresh.onclick=()=>load(p);details.addEventListener('toggle',()=>{if(details.open && ready)load(p);});
    form.addEventListener('submit',async e=>{
      e.preventDefault();
      if(!grantValid()){message.textContent='Confirme seu Kodes-ID N2 antes de comentar.';repaintGrants();return;}
      if(p.busy||!ready||!user||!profile||!p.article?.comments_enabled||authError)return;
      const content=input.value.trim();if(!content || content.length>3000){message.textContent='Write a comment between 1 and 3000 characters.';return;}
      p.busy=true;submit.disabled=true;message.textContent='Submitting comment…';const v=revision;
      try {
        const {error}=await db.from('comments').insert({article_id:p.article.id,user_id:user.id,parent_id:p.parent,content});
        if(v!==revision)return;if(error)throw error;
        input.value='';clearReply(p);
        await refreshApprovalMode();
        message.textContent=commentApprovalMode==='automatic'
          ?'Comentário enviado. A publicação automática será confirmada pelo servidor.'
          :'Comentário enviado para aprovação editorial.';
        await load(p);
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
