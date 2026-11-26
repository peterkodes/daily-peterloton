// Companion to Kodes managed setup. This runs only in Viva's admin page,
// never handles a private key, and never receives Kodes JWTs or passwords.
(() => {
  'use strict';
  const APP='https://app.kodes.com.br';
  const SITE='7554902f-4506-494e-8f69-50e4cef8e767';
  if(new URLSearchParams(location.search).get('kodes_connect')!=='1')return;
  const host=document.getElementById('dashboard');
  if(!host||!window.supabase?.createClient)return;
  const client=window.supabase.createClient('https://jyjrgdoeuzlvvpkymqsu.supabase.co',
    'sb_publishable_suBMv7WnrejReyIswL19jw_ipsMz5Gr');
  const box=document.createElement('section');box.className='card';box.setAttribute('aria-live','polite');
  const heading=document.createElement('h2');heading.textContent='Ativação automática do Kodes Connect';
  const explanation=document.createElement('p');
  explanation.textContent='Confirme a instalação apenas se você administra este portal e autorizou o Kodes. O servidor criará e protegerá as credenciais; não é necessário copiar chaves.';
  const status=document.createElement('p');status.setAttribute('role','status');
  status.textContent='Verificando sua conta administrativa…';
  const button=document.createElement('button');button.className='primary';button.type='button';
  button.textContent='Autorizar a conexão segura';button.disabled=true;
  box.append(heading,explanation,status,button);host.prepend(box);
  let installationToken='',eligible=false,completed=false,inProgress=false;
  const state=document.createElement('section');state.className='kodes-connect-status';
  state.setAttribute('aria-live','polite');
  const stateTitle=document.createElement('h3');stateTitle.textContent='Estado da conexão Kodes Connect';
  const stateBody=document.createElement('p');stateBody.textContent='Consultando o servidor Viva…';
  const refreshStatus=document.createElement('button');refreshStatus.type='button';
  refreshStatus.textContent='Verificar conexão agora';
  refreshStatus.onclick=()=>void checkConnectionStatus();
  state.append(stateTitle,stateBody,refreshStatus);
  box.append(state);
  async function checkConnectionStatus(){
    refreshStatus.disabled=true;
    try{
      const {data,error}=await client.functions.invoke('kodes-managed-install',{
        body:{action:'status',site:SITE}
      });
      if(error||!data||typeof data.active!=='boolean')throw Error('Status temporariamente indisponível');
      if(data.active===true&&data.key_id){
        completed=true;eligible=false;button.disabled=true;
        state.classList.add('is-active');
        stateBody.textContent='CONECTOR CRIPTOGRÁFICO ATIVO · Chave Kodes: '+data.key_id+
          ' · Ativado em '+new Date(data.activated_at).toLocaleString('pt-BR')+
          '. Comentários N2 e telemetria exigem homologação independente.';
        status.textContent='Conectado ao Kodes. Nenhuma nova instalação é necessária.';
        report('kodes:managed-complete');
      }else{
        state.classList.remove('is-active');
        stateBody.textContent=data.stage==='pending'
          ?'Instalação pendente de conclusão entre servidores. Não gere novas chaves.'
          :'Conector ainda não ativado. Inicie pelo Backoffice Kodes.';
      }
    }catch{
      stateBody.textContent='Não foi possível consultar o status. A conexão não foi confirmada nesta tela.';
    }finally{refreshStatus.disabled=false;}
  }
  const report=(type,message)=>{
    if(window.opener)window.opener.postMessage({type,site:SITE,...(message?{message}:{})},APP);
  };
  async function checkAdmin(){
    const {data,error}=await client.auth.getUser();
    if(error||!data.user||!data.user.email_confirmed_at){
      eligible=false;status.textContent='Entre na sua conta Viva Mídia e retorne ao painel administrativo.';
      return;
    }
    const role=await client.from('user_roles').select('role').eq('user_id',data.user.id).maybeSingle();
    eligible=!role.error&&role.data?.role==='admin';
    if(!eligible){status.textContent='Esta conta não possui permissão de administrador na Viva Mídia.';return}
    status.textContent='Verificando a instalação segura do conector no servidor…';
    const readiness=await client.functions.invoke('kodes-managed-install',{
      body:{action:'preflight',site:SITE}
    });
    if(readiness.error||readiness.data?.ready!==true){
      eligible=false;
      let detail=readiness.data?.error;
      if(!detail&&readiness.error?.context instanceof Response){
        try{
          const payload=await readiness.error.context.clone().json();
          if(typeof payload?.error==='string')detail=payload.error;
        }catch{/* The request failed before a JSON response. */}
      }
      const explanation=typeof detail==='string'&&detail.length<320
        ?detail:'Não foi possível validar o conector no servidor Viva Mídia.';
      status.textContent=explanation+' Nenhuma chave foi criada; tente novamente após a correção.';
      report('kodes:managed-error',explanation);
      return;
    }
    if(readiness.data?.activated===true){
      completed=true;eligible=false;
      status.textContent='Conexão de servidor já ativada. Não é necessário reinstalar.';
      void checkConnectionStatus();
      report('kodes:managed-complete');
      return;
    }
    status.textContent='Conta administrativa confirmada. Aguardando a autorização iniciada no Kodes.';
    report('kodes:managed-ready');
  }
  window.addEventListener('message',event=>{
    if(event.origin===APP&&event.source===window.opener&&eligible&&event.data?.type==='kodes:managed-ping'&&event.data?.site===SITE){
      report('kodes:managed-ready');return;
    }
    if(event.origin!==APP||event.source!==window.opener||!eligible||
      event.data?.type!=='kodes:managed-authorization'||event.data?.site!==SITE||
      typeof event.data.token!=='string'||!/^[a-f0-9]{64}$/.test(event.data.token))return;
    installationToken=event.data.token;
    button.disabled=false;
    status.textContent='Sua identidade de administrador foi validada. Confirme para instalar o conector no servidor do portal.';
  });
  button.addEventListener('click',async()=>{
    if(!eligible||!installationToken||inProgress||completed)return;
    inProgress=true;button.disabled=true;status.textContent='Configurando a conexão no servidor…';
    try{
      const {data,error}=await client.functions.invoke('kodes-managed-install',{
        body:{site:SITE,token:installationToken,confirm:true}
      });
      installationToken='';
      if(error||!data?.activated){
        let detail=data?.error;
        if(!detail&&error?.context instanceof Response){
          try{
            const payload=await error.context.clone().json();
            if(typeof payload?.error==='string')detail=payload.error;
          }catch{/* No response body was available. */}
        }
        throw Error(typeof detail==='string'&&detail.length<320
          ?detail:'A instalação não foi confirmada pelo servidor Viva Mídia.');
      }
      completed=true;status.textContent='Conexão de servidor ativada. Conferindo registro persistente…';void checkConnectionStatus();
      report('kodes:managed-complete');
    }catch(e){
      installationToken='';status.textContent=e instanceof Error?e.message:'Falha na instalação.';
      report('kodes:managed-error',status.textContent);
    }finally{inProgress=false;}
  });
  void checkAdmin();
  client.auth.onAuthStateChange(()=>{eligible=false;installationToken='';button.disabled=true;void checkAdmin()});
})();
