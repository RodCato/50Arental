import {cutoverUI} from './cutover-ui.mjs';
import { initializeCloud, cloudAuth } from './client.mjs';
import { checkFoundation } from './data.mjs';
const status = document.getElementById('cloudStatus');
const message = document.getElementById('cloudMessage');
const form = document.getElementById('cloudSignIn');
const email = document.getElementById('cloudEmail');
const send = document.getElementById('cloudSend');
const logout = document.getElementById('cloudSignOut');
const check = document.getElementById('cloudCheck');
let user = null, busy = false;
function render() {
  status.textContent = user ? `Signed in as ${user.email || user.id}. Use Settings below to select this device’s data mode.` : 'Supabase client ready · signed out. Sign in to access an activated cloud ledger.';
  form.hidden = !!user;
  logout.hidden = check.hidden = !user;
  send.disabled = busy;
  email.disabled = busy;
  logout.disabled = check.disabled = busy;
}
async function action(work) {
  busy = true; message.textContent = ''; render();
  try { await work(); } catch (error) { message.textContent = error.message || 'Cloud request failed. Local ledger is unaffected.'; }
  finally { busy = false; render(); }
}
async function start() {
  try {
    const linkError = new URLSearchParams(location.hash.slice(1)).get('error_description');
    const client = await initializeCloud();
    if (!client) { status.textContent = 'Supabase not configured. Sign in to access an activated cloud ledger.'; return; }
    const auth = cloudAuth(client);
    await cutoverUI(client);
    auth.onChange(next => { user = next; message.textContent = ''; render(); });
    const current = await auth.getUser();
    user = current.data?.user || null;
    render();
    if (linkError) message.textContent = 'Sign-in link could not be verified. Request a new link and try again.';
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!email.reportValidity()) return;
      action(async () => {
        // Same application path, without tokens, query strings or fragments.
        const redirectTo = new URL(location.pathname, location.origin).href;
        const result = await auth.sendLink(email.value.trim(), redirectTo);
        if (result.error) throw result.error;
        message.textContent = 'Check your email and click the Sign in link. Return to Settings to verify your identity. No local data will be uploaded.';
      });
    });
    logout.addEventListener('click', () => action(async () => {
      const result = await auth.signOut();
      if (result.error) throw result.error;
      user = null; message.textContent = 'Signed out on this browser tab. Local ledger is unchanged.';
    }));
    check.addEventListener('click', () => action(async () => { message.textContent = await checkFoundation(client); }));
  } catch { status.textContent = 'Cloud unavailable or offline. Sign in to access an activated cloud ledger.'; }
}
start();
