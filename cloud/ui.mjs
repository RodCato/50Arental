import { initializeCloud, cloudAuth } from './client.mjs';
import { checkFoundation } from './data.mjs';
const status = document.getElementById('cloudStatus');
const message = document.getElementById('cloudMessage');
const form = document.getElementById('cloudSignIn');
const email = document.getElementById('cloudEmail');
const code = document.getElementById('cloudCode');
const send = document.getElementById('cloudSend');
const verify = document.getElementById('cloudVerify');
const logout = document.getElementById('cloudSignOut');
const check = document.getElementById('cloudCheck');
let user = null, busy = false, pendingEmail = '';
function render() {
  status.textContent = user ? `Signed in as ${user.email || user.id}. Local storage is still authoritative.` : 'Supabase client ready · signed out. Local ledger remains available.';
  form.hidden = !!user;
  logout.hidden = check.hidden = !user;
  send.disabled = busy;
  verify.disabled = busy || !pendingEmail;
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
    const client = await initializeCloud();
    if (!client) { status.textContent = 'Supabase not configured. Local ledger remains available.'; return; }
    const auth = cloudAuth(client);
    auth.onChange(next => { user = next; message.textContent = ''; render(); });
    const current = await auth.getUser();
    user = current.data?.user || null;
    render();
    send.addEventListener('click', () => {
      if (!email.reportValidity()) return;
      action(async () => {
        const target = email.value.trim();
        const result = await auth.sendCode(target);
        if (result.error) throw result.error;
        pendingEmail = target;
        message.textContent = 'Check your email for a sign-in code. Enter it below. If you received only a link, configure the Supabase email template to include the code.';
      });
    });
    email.addEventListener('input', () => { pendingEmail = ''; render(); });
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!pendingEmail || !code.reportValidity()) return;
      action(async () => {
        const result = await auth.verifyCode(pendingEmail, code.value.trim());
        if (result.error) throw result.error;
        user = result.data.user; code.value = ''; pendingEmail = '';
        message.textContent = 'Signed in. No local records or images were uploaded.';
      });
    });
    logout.addEventListener('click', () => action(async () => {
      const result = await auth.signOut();
      if (result.error) throw result.error;
      user = null; message.textContent = 'Signed out on this browser tab. Local ledger is unchanged.';
    }));
    check.addEventListener('click', () => action(async () => { message.textContent = await checkFoundation(client); }));
  } catch { status.textContent = 'Cloud unavailable or offline. Local ledger remains available.'; }
}
start();
