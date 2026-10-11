import { el, sheet, toast } from '../ui.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { whatsNormal } from './today.js';

export async function startCheckout() {
  if (!state.me || state.me.isGuest) {
    toast('Claim a username first — Premium is tied to your account.');
    location.hash = '#/me';
    return;
  }
  try {
    const { url } = await api('/billing/checkout', { method: 'POST' });
    location.href = url;
  } catch (err) { toast(err.message, { error: true }); }
}

export function showRecoveryCode(code) {
  return sheet('Save your recovery code', (close) => el('div', { class: 'stack' },
    el('p', {}, 'This is the ONLY way back in if you forget your password. We don’t collect emails, so we can’t reset it for you.'),
    el('div', { class: 'code-box' }, code),
    el('button', { class: 'btn block', onclick: async () => { try { await navigator.clipboard.writeText(code); toast('Copied 📋'); } catch { toast('Select and copy the code manually.'); } } }, '📋 Copy code'),
    el('p', { class: 'small muted' }, 'Screenshot it or save it in your password manager.'),
    el('button', { class: 'btn primary block', onclick: () => close() }, 'I saved it')));
}

function form(fields, submitLabel, onSubmit) {
  const error = el('p', { class: 'error', role: 'alert' });
  const btn = el('button', { class: 'btn primary block', type: 'submit' }, submitLabel);
  const node = el('form', { class: 'stack', novalidate: true }, fields, error, btn);
  node.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    btn.disabled = true;
    try { await onSubmit(Object.fromEntries(new FormData(node))); }
    catch (err) { error.textContent = err.message; }
    finally { btn.disabled = false; }
  });
  return node;
}
const input = (name, label, attrs = {}) => el('label', { class: 'field' }, label, el('input', { class: 'input', name, required: true, ...attrs }));
const userField = () => input('username', 'Username', { autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: 20, placeholder: 'e.g. thunder_buns' });
const passField = (label = 'Password', autocomplete = 'new-password') => input('password', label, { type: 'password', autocomplete, minlength: 8, maxlength: 128 });

export function loginSheet(onDone) {
  return sheet('Log in', (close) => form([userField(), passField('Password', 'current-password'),
    el('button', { type: 'button', class: 'btn ghost sm', onclick: () => { close(); recoverSheet(onDone); } }, 'Forgot password?')],
  'Log in', async (data) => {
    await api('/auth/login', { method: 'POST', body: data });
    close(); toast('Welcome back 💨'); onDone();
  }));
}

function recoverSheet(onDone) {
  return sheet('Reset password', (close) => form([userField(),
    input('recoveryCode', 'Recovery code', { autocapitalize: 'characters', placeholder: 'XXXXX-XXXXX-XXXXX-XXXXX' }),
    passField('New password')],
  'Reset password', async (data) => {
    const { recoveryCode } = await api('/auth/recover', { method: 'POST', body: data });
    close(); await showRecoveryCode(recoveryCode); onDone();
  }));
}

export async function renderMe(root, { refresh, reboot }) {
  const me = state.me;
  const cfg = state.config;
  const { blocks } = await api('/blocks');
  const params = new URLSearchParams(location.hash.split('?')[1]);
  if (params.get('premium') === 'success') { toast('Thank you! Premium unlocks in a few seconds ⭐', { ms: 4000 }); history.replaceState(null, '', '#/me'); }

  const account = me.isGuest
    ? el('section', { class: 'card stack' },
      el('h2', {}, '🙋 Claim your username'),
      el('p', { class: 'small muted' }, 'You’re tracking as a guest on this device. Claim a username to share clips, use other devices, and keep your data safe if you clear your browser.'),
      form([userField(), passField()], 'Claim username', async (data) => {
        const { recoveryCode } = await api('/auth/claim', { method: 'POST', body: data });
        await showRecoveryCode(recoveryCode);
        toast(`You’re @${data.username} now 🎉`);
        reboot();
      }),
      el('div', { class: 'divider' }),
      el('button', { class: 'btn ghost sm', onclick: () => loginSheet(reboot) }, 'Already have an account? Log in (keeps today’s logs)'))
    : el('section', { class: 'card stack tight' },
      el('div', { class: 'row' }, el('h2', { class: 'grow' }, `@${me.username}`), me.isPremium && cfg.billingEnabled && el('span', { class: 'pill star' }, '⭐ Premium')),
      el('p', { class: 'small muted' }, `Member since ${new Date(me.createdAt).toLocaleDateString([], { month: 'long', year: 'numeric' })}`),
      me.banned && el('p', { class: 'small error' }, 'Your community access is suspended. Your private tracking still works.'),
      el('div', { class: 'row wrap' },
        el('button', { class: 'btn sm', onclick: () => sheet('Change password', (close) => form(
          [input('currentPassword', 'Current password', { type: 'password', autocomplete: 'current-password' }), passField('New password')],
          'Change password', async (data) => { await api('/auth/password', { method: 'POST', body: data }); close(); toast('Password changed 🔒'); })) }, '🔒 Change password'),
        el('button', { class: 'btn sm', onclick: async () => { await api('/auth/logout', { method: 'POST' }); reboot(); } }, 'Log out')));

  const premiumCard = cfg.billingEnabled && el('section', { class: `card ${me.isPremium ? 'soft' : 'brand'} stack tight` },
    me.isPremium
      ? [el('h2', {}, '⭐ You’re Premium'), el('p', { class: 'small muted' }, 'Full history, trigger insights and the doctor report are unlocked. Thank you for keeping the gas flowing!'),
        cfg.premiumMode === 'subscription' && el('button', { class: 'btn sm', onclick: async () => { try { location.href = (await api('/billing/portal', { method: 'POST' })).url; } catch (err) { toast(err.message, { error: true }); } } }, 'Manage subscription')]
      : [el('h2', {}, '⭐ Go Premium'),
        el('ul', { class: 'flags small' }, ['Trigger insights: which foods line up with your gas', '90-day & 1-year history', 'Printable doctor report', '⭐ Supporter badge in the community'].map((x) => el('li', {}, x))),
        el('button', { class: 'btn white', onclick: startCheckout }, `Unlock — ${cfg.premiumPrice}`)]);

  root.replaceChildren(el('div', { class: 'page' },
    el('div', { class: 'page-head' }, el('h1', {}, 'Me')),
    account,
    premiumCard,
    whatsNormal(),
    blocks.length > 0 && el('section', { class: 'card stack tight' }, el('h2', {}, '🚫 Blocked'),
      blocks.map((u) => el('div', { class: 'list-row' }, el('span', { class: 'grow' }, `@${u}`),
        el('button', { class: 'btn sm', onclick: async () => { await api(`/blocks/${encodeURIComponent(u)}`, { method: 'DELETE' }); refresh(); } }, 'Unblock')))),
    el('section', { class: 'card stack tight' }, el('h2', {}, '🗂️ Your data'),
      el('p', { class: 'small muted' }, 'Your logs are private. Only clips you choose to share are public.'),
      el('div', { class: 'row wrap' },
        el('a', { class: 'btn sm', href: '/api/export.csv', download: '' }, '⬇️ Export CSV'),
        el('button', { class: 'btn sm danger', onclick: () => deleteAccount(me, reboot) }, 'Delete account'))),
    el('section', { class: 'card soft stack tight small' },
      el('div', { class: 'row wrap' },
        el('a', { href: '/privacy', target: '_blank' }, 'Privacy'), '·', el('a', { href: '/terms', target: '_blank' }, 'Terms'),
        cfg.supportEmail && ['·', el('a', { href: `mailto:${cfg.supportEmail}` }, 'Contact support')]),
      el('p', { class: 'tiny muted' }, `${cfg.appName} is for fun and general wellness. It isn’t a medical device and doesn’t diagnose anything.`))));
}

async function deleteAccount(me, reboot) {
  const word = me.username || 'DELETE';
  const ok = await sheet('Delete account', (close) => form([
    el('p', { class: 'small' }, 'This permanently deletes your account, every log, every recording and every post. It can’t be undone.'),
    input('confirm', `Type ${word} to confirm`, { autocapitalize: 'none', autocomplete: 'off' })],
  'Delete everything', async ({ confirm }) => {
    await api('/me', { method: 'DELETE', body: { confirm } });
    close(true);
  }));
  if (ok) { toast('Account deleted. Bye 👋'); reboot(); }
}
