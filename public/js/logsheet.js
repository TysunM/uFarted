import { KINDS, TRIGGERS, SMELL, DISCOMFORT, typeInfo } from './catalog.js';
import { el, sheet, toast, confirmSheet, segmented, pad } from './ui.js';
import { api, createLog } from './api.js';
import { recorderWidget, canRecord } from './recorder.js';
import { player, stopPlayback } from './player.js';
import { state } from './state.js';

const toLocalInput = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Opens the log sheet for a new entry (`kind`) or an existing one (`log`). Resolves true if anything changed. */
export function openLogSheet({ kind = 'fart', log = null } = {}) {
  const editing = Boolean(log);
  const draft = {
    kind: log?.kind ?? kind,
    type: log?.type ?? 'classic',
    occurredAt: log?.occurredAt ?? Date.now(),
    smell: log?.smell ?? null,
    discomfort: log?.discomfort ?? null,
    triggers: new Set(log?.triggers ?? []),
    note: log?.note ?? '',
  };
  let blob = null;            // new recording waiting to upload
  let removeAudio = false;    // user removed the existing clip
  let share = Boolean(log?.postId);
  let recorder = null;
  let pendingSave = false;    // Save tapped mid-recording: save as soon as the take is ready
  let createdId = log?.id ?? null; // after a partial failure, retries update instead of duplicating

  return sheet(editing ? 'Edit entry' : 'Log it', (close) => {
    const typeSelect = el('select', { class: 'input', id: 'type' });
    const typeDesc = el('p', { class: 'type-desc' });
    const healthNote = el('p', { class: 'health-note hidden' });
    const fillTypes = () => {
      typeSelect.replaceChildren(...KINDS[draft.kind].groups.map((g) => el('optgroup', { label: g.label },
        g.types.map((t) => el('option', { value: t.id }, `${t.emoji}  ${t.name}`)))));
      if (!typeInfo(draft.kind, draft.type) || ![...typeSelect.options].some((o) => o.value === draft.type)) draft.type = 'classic';
      typeSelect.value = draft.type;
      describe();
    };
    const describe = () => {
      const t = typeInfo(draft.kind, draft.type);
      typeDesc.textContent = t.desc;
      healthNote.textContent = t.health ? `🩺 ${t.health}` : '';
      healthNote.classList.toggle('hidden', !t.health);
    };
    typeSelect.addEventListener('change', () => { draft.type = typeSelect.value; describe(); });

    const kindSeg = segmented(Object.values(KINDS).map((k) => ({ id: k.id, label: `${k.emoji} ${k.name}` })), draft.kind,
      (id) => { draft.kind = id; fillTypes(); }, 'Fart or burp');

    const when = el('input', { class: 'input', type: 'datetime-local', id: 'when', value: toLocalInput(draft.occurredAt),
      max: toLocalInput(Date.now() + 60_000), min: toLocalInput(Date.now() - 29 * 86_400_000) });

    const pressGroup = (items, current, onPick, cls) => {
      const wrap = el('div', { class: cls, role: 'group' });
      items.forEach((item, i) => wrap.append(el('button', {
        type: 'button', 'aria-pressed': String(current === i),
        onclick: (e) => {
          const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
          wrap.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
          e.currentTarget.setAttribute('aria-pressed', String(on));
          onPick(on ? i : null);
        },
      }, item)));
      return wrap;
    };
    const smell = pressGroup(SMELL.map((s) => { const [e, ...w] = s.split(' '); return [el('span', { class: 'e' }, e), w.join(' ')]; }),
      draft.smell, (v) => { draft.smell = v; }, 'scale');
    const discomfort = pressGroup(DISCOMFORT.map((d, i) => (i === 0 ? '😌 None' : d)), draft.discomfort, (v) => { draft.discomfort = v; }, 'chips');
    for (const b of discomfort.children) b.classList.add('chip');

    const triggers = el('div', { class: 'chips' }, TRIGGERS.map((t) => el('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(draft.triggers.has(t.id)),
      onclick: (e) => {
        const on = !draft.triggers.has(t.id);
        on ? draft.triggers.add(t.id) : draft.triggers.delete(t.id);
        e.currentTarget.setAttribute('aria-pressed', String(on));
      },
    }, `${t.emoji} ${t.name}`)));

    const note = el('textarea', { class: 'input', id: 'note', maxlength: 280, placeholder: 'Private note — only you can see this', value: draft.note });

    // --- Recording ---
    const audioBox = el('div', { class: 'stack tight' });
    const shareToggle = el('input', { type: 'checkbox', role: 'switch', checked: share, onchange: (e) => { share = e.target.checked; } });
    const shareRow = el('label', { class: 'switch' }, el('span', {}, '🌍 Share clip to the community'), shareToggle);
    const shareHint = el('p', { class: 'tiny muted' });
    const hasClip = () => Boolean(blob || (log?.hasAudio && !removeAudio));
    const renderAudio = () => {
      stopPlayback();
      let content;
      if (recorder) {
        content = recorder.node;
      } else if (hasClip()) {
        const src = blob ? URL.createObjectURL(blob) : `/api/audio/${log.audioId}`;
        content = el('div', { class: 'recorder' },
          player({ src, peaks: blob ? null : log.peaks, durationMs: blob ? null : log.durationMs }),
          el('div', { class: 'row' },
            el('button', { type: 'button', class: 'btn sm grow', onclick: startRecording }, '🔁 Re-record'),
            el('button', { type: 'button', class: 'btn sm grow danger', onclick: () => { blob = null; if (log?.hasAudio) removeAudio = true; renderAudio(); } }, 'Remove')));
      } else if (canRecord()) {
        content = el('button', { type: 'button', class: 'btn block', onclick: startRecording }, '🎙️ Record it (optional)');
      } else {
        content = el('p', { class: 'tiny muted' }, 'Recording isn’t supported in this browser.');
      }
      const claimed = state.me && !state.me.isGuest;
      shareToggle.disabled = !hasClip() || !claimed || state.me?.banned;
      if (!hasClip()) shareToggle.checked = share = false;
      shareHint.textContent = !claimed ? 'Claim a username on the Me tab to share clips.'
        : state.me.banned ? 'Your community access is suspended.'
        : hasClip() ? 'Your username, the type and the clip go public. Notes, smell and triggers stay private.' : 'Record a clip to share it.';
      audioBox.replaceChildren(content, shareRow, shareHint);
    };
    function startRecording() {
      blob = null;
      recorder = recorderWidget({
        maxSeconds: state.config.maxClipSeconds || 15,
        onDone: (b) => { blob = b; recorder = null; renderAudio(); if (pendingSave) { pendingSave = false; saveBtn.click(); } },
        onError: (msg) => { recorder = null; pendingSave = false; toast(msg, { error: true, ms: 4500 }); renderAudio(); },
      });
      renderAudio();
    }
    renderAudio();

    // --- Save / delete ---
    const error = el('p', { class: 'error', role: 'alert' });
    const saveBtn = el('button', { type: 'button', class: 'btn primary block' }, editing ? 'Save changes' : 'Save');
    saveBtn.addEventListener('click', async () => {
      if (recorder) { pendingSave = true; saveBtn.textContent = 'Finishing recording…'; return recorder.stop(); }
      error.textContent = '';
      const occurredAt = when.value ? new Date(when.value).getTime() : Date.now();
      const payload = {
        kind: draft.kind, type: draft.type, occurredAt, tzOffset: new Date(occurredAt).getTimezoneOffset(),
        smell: draft.smell, discomfort: draft.discomfort, triggers: [...draft.triggers], note: note.value.trim(),
      };
      saveBtn.disabled = true;
      saveBtn.textContent = blob ? 'Uploading clip…' : 'Saving…';
      try {
        let saved = createdId ? await api(`/logs/${createdId}`, { method: 'PATCH', body: payload }) : await createLog(payload);
        if (saved.id) createdId = saved.id;
        if (saved.offline) {
          toast(blob ? 'Saved offline — the clip needs a connection 📶' : 'Saved offline — will sync when you’re back 📶');
          return close(true);
        }
        if (removeAudio && !blob && saved.hasAudio) saved = await api(`/logs/${saved.id}/audio`, { method: 'DELETE' });
        if (blob) {
          if (saved.postId) await api(`/posts/${saved.postId}`, { method: 'DELETE' });
          saved = await api(`/logs/${saved.id}/audio`, { method: 'PUT', raw: blob, headers: { 'Content-Type': blob.type || 'audio/webm' } });
          blob = null;
        }
        if (share && saved.hasAudio && !saved.postId) await api('/posts', { method: 'POST', body: { logId: saved.id } });
        if (!share && saved.postId) await api(`/posts/${saved.postId}`, { method: 'DELETE' });
        const t = typeInfo(draft.kind, draft.type);
        toast(editing ? 'Updated ✅' : `${t.emoji} ${t.name} logged!${share ? ' Shared 🌍' : ''}`);
        close(true);
      } catch (err) {
        error.textContent = err.message || 'Couldn’t save. Check your connection.';
        saveBtn.disabled = false;
        saveBtn.textContent = editing ? 'Save changes' : 'Save';
      }
    });
    const deleteBtn = editing && el('button', {
      type: 'button', class: 'btn ghost block danger',
      onclick: async () => {
        if (!(await confirmSheet('Delete this entry?', 'This also removes its clip and any community post.', { yes: 'Delete', danger: true }))) return;
        try { await api(`/logs/${log.id}`, { method: 'DELETE' }); toast('Deleted 🗑️'); close(true); }
        catch (err) { toast(err.message, { error: true }); }
      },
    }, 'Delete entry');

    fillTypes();
    const node = el('div', { class: 'stack' },
      kindSeg,
      el('label', { class: 'field', for: 'type' }, 'What kind?', typeSelect),
      typeDesc, healthNote,
      el('label', { class: 'field', for: 'when' }, 'When', when),
      el('div', { class: 'field stack tight' }, el('strong', {}, 'Smell'), smell),
      el('div', { class: 'field stack tight' }, el('strong', {}, 'Any discomfort?'), discomfort),
      el('details', { class: 'triggers', open: draft.triggers.size > 0 }, el('summary', { class: 'small' }, el('strong', {}, 'Possible triggers'), ' — helps spot patterns'), triggers),
      el('label', { class: 'field', for: 'note' }, 'Note', note),
      audioBox,
      el('div', { class: 'sheet-foot' }, error, saveBtn, deleteBtn));
    return node;
  }).then((changed) => { recorder?.stop(); stopPlayback(); return changed; });
}
