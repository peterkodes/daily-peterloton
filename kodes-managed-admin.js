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
      status.textContent='O conector ainda não foi provisionado no servidor do portal. A ativação permanece indisponível até concluir a instalação protegida no banco.';
      return;
    }
    if(readiness.data?.activated===true){
      completed=true;eligible=false;
      status.textContent='Conexão de servidor já ativada. Não é necessário reinstalar.';
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
      if(error||!data?.activated)throw Error(data?.error||'Falha na ativação. O painel continua disponível.');
      completed=true;status.textContent='Conexão de servidor ativada com segurança. Os testes de comentários e telemetria serão verificados separadamente.';
      report('kodes:managed-complete');
    }catch(e){
      installationToken='';status.textContent=e instanceof Error?e.message:'Falha na instalação.';
      report('kodes:managed-error',status.textContent);
    }finally{inProgress=false;}
  });
  void checkAdmin();
  client.auth.onAuthStateChange(()=>{eligible=false;installationToken='';button.disabled=true;void checkAdmin()});
})();
