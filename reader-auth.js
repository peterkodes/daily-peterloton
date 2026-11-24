'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const status = message => { $('status').textContent = message; };
  if (!window.supabase?.createClient) { status('Unable to load the reader service. Please reload.'); return; }
  const redirectTo = location.origin + '/account';
  let recovering = new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery';
  const initialError = new URLSearchParams(location.hash.slice(1)).get('error') || new URLSearchParams(location.search).get('error');
  const client = window.supabase.createClient('https://jyjrgdoeuzlvvpkymqsu.supabase.co', 'sb_publishable_suBMv7WnrejReyIswL19jw_ipsMz5Gr');
  let mode = 'login', currentUser = null, busy = false, revision = 0;
  function show(panel) { ['guest','member','recovery'].forEach(id => { $(id).hidden = id !== panel; }); }
  function setMode(next) {
    mode = next;
    const signup = next === 'register', reset = next === 'reset';
    $('name-label').hidden = !signup; $('name').disabled = !signup; $('name').required = signup;
    $('password-label').hidden = reset; $('password').disabled = reset; $('password').required = !reset;
    $('password').autocomplete = signup ? 'new-password' : 'current-password';
    $('password').minLength = signup ? 10 : 1;
    $('password').value = '';
    $('signup-note').hidden = !signup;
    $('form-title').textContent = signup ? 'Create your account' : reset ? 'Reset your password' : 'Sign in';
    $('submit').textContent = signup ? 'Create account' : reset ? 'Send reset link' : 'Sign in';
  }
  function errorMessage(error) {
    const code = error?.code || '';
    if (code === 'email_address_not_authorized') return 'Email delivery is restricted during the pilot. Contact the site administrator.';
    if (code === 'email_not_confirmed') return 'Please confirm your email before signing in.';
    if (code === 'invalid_credentials') return 'Email or password is incorrect.';
    if (code === 'over_email_send_rate_limit' || error?.status === 429) return 'Too many requests. Please try again later.';
    if (code === 'weak_password') return 'Choose a stronger password.';
    return 'Unable to complete this request. Please try again or contact the site administrator.';
  }
  async function run(action) {
    if (busy) return;
    busy = true;
    const buttons = [...document.querySelectorAll('button')]; buttons.forEach(b => b.disabled = true);
    try { await action(); } catch (error) { status(errorMessage(error)); }
    finally { busy = false; buttons.forEach(b => b.disabled = false); }
  }
  async function loadProfile(user, version) {
    let result = await client.from('profiles').select('display_name').eq('id', user.id).maybeSingle();
    if (version !== revision) return;
    if (result.error) { status('Signed in, but your profile could not be loaded. Please try again.'); return; }
    const name = typeof user.user_metadata?.display_name === 'string' ? user.user_metadata.display_name.trim().slice(0,80) : '';
    if (!result.data && name.length >= 2) {
      const inserted = await client.from('profiles').insert({id:user.id,display_name:name});
      if (version !== revision) return;
      if (inserted.error && inserted.error.code !== '23505') { $('profile-name').value = name; status('Signed in. Please save your display name to finish your profile.'); return; }
      result = await client.from('profiles').select('display_name').eq('id',user.id).maybeSingle();
      if (version !== revision) return;
      if (result.error) { status('Signed in, but your profile could not be loaded.'); return; }
    }
    $('profile-name').value = result.data?.display_name || name;
    status(result.data ? 'Signed in. Your reader profile is ready.' : 'Signed in. Please save a public display name.');
  }
  async function renderSession(session) {
    const version = ++revision;
    if (!session) { currentUser = null; recovering = false; show('guest'); if (initialError) status('The email link is invalid or expired. Request a new link.'); return; }
    const {data,error} = await client.auth.getUser();
    if (version !== revision) return;
    if (error || !data.user) { currentUser = null; show('guest'); status('Could not verify your session. Please sign in again.'); return; }
    currentUser = data.user;
    if (recovering) { show('recovery'); status('Choose a new password.'); return; }
    $('member-email').textContent = currentUser.email || '';
    show('member'); await loadProfile(currentUser, version);
  }
  $('choose-login').onclick = () => { setMode('login'); status('Enter your email and password.'); };
  $('choose-register').onclick = () => { setMode('register'); status('Create an independent reader account.'); };
  $('choose-reset').onclick = () => { setMode('reset'); status('Enter the email associated with your account.'); };
  $('auth-form').onsubmit = event => {
    event.preventDefault();
    run(async () => {
      const email = $('email').value.trim(), password = $('password').value, name = $('name').value.trim();
      if (mode === 'register') {
        if (name.length < 2 || name.length > 80) { status('Choose a display name between 2 and 80 characters.'); return; }
        const {data,error} = await client.auth.signUp({email,password,options:{emailRedirectTo:redirectTo,data:{display_name:name}}});
        $('password').value = '';
        if (error) throw error;
        if (data.session) await renderSession(data.session); else { setMode('login'); status('Check your email for a confirmation link before signing in.'); }
      } else if (mode === 'reset') {
        const {error} = await client.auth.resetPasswordForEmail(email,{redirectTo});
        if (error) throw error;
        status('If an account exists and email delivery is available, a reset link will be sent.');
      } else {
        const {data,error} = await client.auth.signInWithPassword({email,password});
        $('password').value = '';
        if (error) throw error;
        await renderSession(data.session);
      }
    });
  };
  $('profile-form').onsubmit = event => { event.preventDefault(); run(async () => {
    if (!currentUser) return;
    const name = $('profile-name').value.trim();
    if (name.length < 2 || name.length > 80) {status('Choose a name between 2 and 80 characters.');return;}
    const id = currentUser.id;
    const found = await client.from('profiles').select('id').eq('id',id).maybeSingle();
    if (found.error) throw found.error;
    const result = found.data ? await client.from('profiles').update({display_name:name}).eq('id',id).select('id').single() : await client.from('profiles').insert({id,display_name:name});
    if (result.error) throw result.error;
    status('Profile saved.');
  }); };
  function logout() { run(async () => { const {error} = await client.auth.signOut(); if (error) throw error; currentUser=null; recovering=false; ++revision; setMode('login'); show('guest'); status('Signed out.'); }); }
  $('logout').onclick = logout; $('cancel-recovery').onclick = logout;
  $('recovery-form').onsubmit = event => { event.preventDefault(); run(async () => {
    if (!currentUser || !recovering) return;
    const {error} = await client.auth.updateUser({password:$('new-password').value});
    $('new-password').value=''; if (error) throw error;
    const signout = await client.auth.signOut(); if (signout.error) throw signout.error;
    recovering=false;currentUser=null;++revision;setMode('login');show('guest');status('Password updated. Sign in with your new password.');
  }); };
  setMode('login');
  client.auth.onAuthStateChange((event,session) => {
    if (event === 'PASSWORD_RECOVERY') recovering = true;
    if (event === 'SIGNED_OUT') recovering = false;
    // Avoid awaiting another Supabase call from inside the auth callback.
    if (['INITIAL_SESSION','SIGNED_IN','SIGNED_OUT','PASSWORD_RECOVERY'].includes(event)) setTimeout(() => {
      if (!session) { if (!busy && !initialError) status('Sign in or create an account.'); }
      renderSession(session).catch(() => status('Could not load your account. Please reload.'));
    },0);
  });
})();
