// admin-frontend/admin.js
//
// V1.3.3 — Added inline edit + hard-delete affordances on recent entries.
// Each <li> in #recent-list now carries Edit/Delete buttons. Edit expands
// the <li> in place into a prefilled form panel (inline-expand UX, not
// modal). Delete confirms and DELETEs.
//
// Event delegation on #recent-list — buttons attach via container click
// listener so freshly-rendered list items work without per-render wiring.
//
// V1.3 baseline preserved: setup section, entry form, Ctrl/Cmd+Enter
// submit, localStorage token map, visible-failure status surface.

const LS_BACKEND = 'chatbotiq_admin_backend_url';
const LS_ACTIVE_SLUG = 'chatbotiq_admin_active_slug';
const LS_TOKENS = 'chatbotiq_admin_tokens';

// ----------------------------------------------------------------
// localStorage helpers
// ----------------------------------------------------------------
function getTokens() {
  try {
    const raw = localStorage.getItem(LS_TOKENS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setToken(slug, token) {
  const tokens = getTokens();
  tokens[slug] = token;
  localStorage.setItem(LS_TOKENS, JSON.stringify(tokens));
}

function getActiveToken() {
  const slug = localStorage.getItem(LS_ACTIVE_SLUG);
  if (!slug) return null;
  return getTokens()[slug] || null;
}

function getBackendUrl() {
  return localStorage.getItem(LS_BACKEND) || '';
}

function getActiveSlug() {
  return localStorage.getItem(LS_ACTIVE_SLUG) || '';
}

// ----------------------------------------------------------------
// Status surfaces (Build Standard #4 — visible failure paths)
// ----------------------------------------------------------------
function showStatus(elId, message, kind = 'info') {
  const el = document.getElementById(elId);
  if (!el) return;
  el.className = `status status-${kind}`;
  el.textContent = message;
}

function clearStatus(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.className = 'status';
  el.textContent = '';
}

// ----------------------------------------------------------------
// Setup section — credentials
// ----------------------------------------------------------------
function loadCredentialsIntoForm() {
  document.getElementById('backend-url').value = getBackendUrl();
  document.getElementById('deployment-slug').value = getActiveSlug();
  const token = getActiveToken();
  document.getElementById('admin-token').value = token || '';
}

function saveCredentials() {
  const url = document.getElementById('backend-url').value.trim();
  const slug = document.getElementById('deployment-slug').value.trim();
  const token = document.getElementById('admin-token').value.trim();

  if (!url || !slug || !token) {
    showStatus('setup-status', 'Backend URL, deployment slug, and token are all required.', 'error');
    return;
  }

  // Strip trailing slash for consistency
  const cleanUrl = url.replace(/\/+$/, '');

  localStorage.setItem(LS_BACKEND, cleanUrl);
  localStorage.setItem(LS_ACTIVE_SLUG, slug);
  setToken(slug, token);

  showStatus('setup-status', `Saved. Active deployment: ${slug}.`, 'success');
}

function clearCredentials() {
  if (!confirm('Clear all saved credentials and tokens? This affects all deployments.')) {
    return;
  }
  localStorage.removeItem(LS_BACKEND);
  localStorage.removeItem(LS_ACTIVE_SLUG);
  localStorage.removeItem(LS_TOKENS);
  loadCredentialsIntoForm();
  showStatus('setup-status', 'All credentials cleared.', 'info');
  document.getElementById('recent-list').innerHTML =
    '<p class="muted">Save credentials and test connection to see recent entries.</p>';
}

async function testConnection() {
  clearStatus('setup-status');
  const url = getBackendUrl();
  const token = getActiveToken();

  if (!url || !token) {
    showStatus('setup-status', 'Save credentials first.', 'error');
    return;
  }

  showStatus('setup-status', 'Testing…', 'info');
  try {
    const res = await fetch(`${url}/admin/deployments`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) {
      showStatus('setup-status', `Failed (${res.status}): ${data.message || 'unknown'}`, 'error');
      return;
    }
    const slugs = (data.deployments || []).map(d => d.slug).join(', ');
    showStatus(
      'setup-status',
      `Connected. Registered deployments: ${slugs || '(none)'}.`,
      'success'
    );
    // Auto-trigger a recent-entries load on success.
    loadRecent();
  } catch (err) {
    showStatus('setup-status', `Network error: ${err.message}`, 'error');
  }
}

// ----------------------------------------------------------------
// Entry form — submit + clear pattern
// ----------------------------------------------------------------
function getSelectedContentType() {
  const radios = document.querySelectorAll('input[name="content-type"]');
  for (const r of radios) {
    if (r.checked) return r.value;
  }
  return 'REFERENCE';
}

function toggleAttributionVisibility() {
  const ct = getSelectedContentType();
  const row = document.getElementById('attribution-row');
  row.style.display = ct === 'VERBATIM' ? 'flex' : 'none';
}

function updateCharCount(inputId, countId, max) {
  const input = document.getElementById(inputId);
  const count = document.getElementById(countId);
  if (!input || !count) return;
  count.textContent = `${input.value.length} / ${max}`;
}

function clearEntryForm() {
  // Keep content_type radio as-is (likely curating multiple of same type)
  document.getElementById('question').value = '';
  document.getElementById('body').value = '';
  document.getElementById('attribution').value = '';
  document.getElementById('tags').value = '';
  document.getElementById('source').value = '';
  updateCharCount('question', 'question-count', 500);
  updateCharCount('body', 'body-count', 10000);
  updateCharCount('attribution', 'attribution-count', 200);
  // Focus question for next entry
  document.getElementById('question').focus();
}

async function submitEntry() {
  clearStatus('entry-status');

  const url = getBackendUrl();
  const slug = getActiveSlug();
  const token = getActiveToken();

  if (!url || !slug || !token) {
    showStatus('entry-status', 'Save credentials and test connection first.', 'error');
    return;
  }

  const content_type = getSelectedContentType();
  const question = document.getElementById('question').value.trim();
  const body = document.getElementById('body').value.trim();
  const attribution = document.getElementById('attribution').value.trim();
  const tagsRaw = document.getElementById('tags').value.trim();
  const source = document.getElementById('source').value.trim();

  if (!question) {
    showStatus('entry-status', 'Question is required.', 'error');
    return;
  }
  if (!body) {
    showStatus('entry-status', 'Body is required.', 'error');
    return;
  }
  if (content_type === 'VERBATIM' && !attribution) {
    showStatus('entry-status', 'VERBATIM entries require an attribution.', 'error');
    return;
  }

  const tags = tagsRaw
    ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean)
    : [];

  const payload = {
    deployment_slug: slug,
    content_type,
    question,
    body,
  };
  if (content_type === 'VERBATIM') payload.attribution = attribution;
  if (tags.length) payload.tags = tags;
  if (source) payload.source = source;

  showStatus('entry-status', 'Saving…', 'info');

  try {
    const res = await fetch(`${url}/admin/kb`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      showStatus(
        'entry-status',
        `Failed (${res.status}): ${data.message || 'unknown'}`,
        'error'
      );
      return;
    }
    showStatus(
      'entry-status',
      `Saved ${data.entry?.content_type || ''} entry "${(data.entry?.question || '').slice(0, 60)}${(data.entry?.question || '').length > 60 ? '…' : ''}". Form cleared for next entry.`,
      'success'
    );
    clearEntryForm();
    // Refresh recent list async — don't block the form
    loadRecent();
  } catch (err) {
    showStatus('entry-status', `Network error: ${err.message}`, 'error');
  }
}

// ----------------------------------------------------------------
// Recent entries — list, edit (inline-expand), delete (V1.3.3)
// ----------------------------------------------------------------

// In-memory map of last-fetched entries by id, so the edit panel can
// prefill from already-loaded data without a re-fetch.
let recentEntriesById = {};

async function loadRecent() {
  const url = getBackendUrl();
  const slug = getActiveSlug();
  const token = getActiveToken();
  const list = document.getElementById('recent-list');

  if (!url || !slug || !token) {
    list.innerHTML =
      '<p class="muted">Save credentials and test connection to see recent entries.</p>';
    return;
  }

  list.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const res = await fetch(
      `${url}/admin/kb?deployment_slug=${encodeURIComponent(slug)}&limit=20`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    if (!res.ok) {
      list.innerHTML = `<p class="error">Failed (${res.status}): ${escapeHtml(data.message || 'unknown')}</p>`;
      return;
    }

    const entries = data.entries || [];
    recentEntriesById = {};
    entries.forEach(e => { recentEntriesById[e.id] = e; });

    if (entries.length === 0) {
      list.innerHTML = '<p class="muted">No entries yet for this deployment.</p>';
      return;
    }

    const total = data.total ?? entries.length;
    const html = [
      `<p class="muted">Showing ${entries.length} of ${total} entries.</p>`,
      '<ul class="entry-list">',
      ...entries.map(e => renderEntryLi(e)),
      '</ul>',
    ].join('');
    list.innerHTML = html;
  } catch (err) {
    list.innerHTML = `<p class="error">Network error: ${escapeHtml(err.message)}</p>`;
  }
}

// Render a single <li> for an entry. Used at initial load and after
// PATCH-success to replace just the one row.
function renderEntryLi(e) {
  const tagsDisplay = Array.isArray(e.tags) && e.tags.length > 0
    ? `<div class="entry-tags">${e.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>`
    : '';

  return `
    <li data-entry-id="${escapeHtml(e.id)}">
      <div class="entry-meta">
        <span class="badge badge-${e.content_type.toLowerCase()}">${e.content_type}</span>
        <span class="entry-date">${new Date(e.created_at).toLocaleString()}</span>
        <div class="entry-actions">
          <button type="button" class="secondary small" data-action="edit">Edit</button>
          <button type="button" class="secondary small danger" data-action="delete">Delete</button>
        </div>
      </div>
      <div class="entry-question">${escapeHtml(e.question)}</div>
      <div class="entry-body">${escapeHtml((e.body || '').slice(0, 200))}${e.body && e.body.length > 200 ? '…' : ''}</div>
      ${e.attribution ? `<div class="entry-attr">— ${escapeHtml(e.attribution)}</div>` : ''}
      ${tagsDisplay}
      <div class="edit-panel" hidden></div>
    </li>
  `;
}

// Build the edit form for an entry. Returned as an HTML string injected
// into the <li>'s .edit-panel container.
function renderEditPanel(e) {
  const isVerbatim = e.content_type === 'VERBATIM';
  const tagsCsv = Array.isArray(e.tags) ? e.tags.join(', ') : '';

  return `
    <div class="edit-form">
      <div class="form-row">
        <label>Content type</label>
        <div class="radio-row">
          <label class="radio-label">
            <input type="radio" name="edit-content-type-${escapeHtml(e.id)}" value="REFERENCE" ${!isVerbatim ? 'checked' : ''}>
            <span>REFERENCE</span>
          </label>
          <label class="radio-label">
            <input type="radio" name="edit-content-type-${escapeHtml(e.id)}" value="VERBATIM" ${isVerbatim ? 'checked' : ''}>
            <span>VERBATIM</span>
          </label>
        </div>
      </div>

      <div class="form-row">
        <label>Question</label>
        <input type="text" class="edit-question" maxlength="500" value="${escapeHtml(e.question || '')}">
      </div>

      <div class="form-row">
        <label>Body</label>
        <textarea class="edit-body" rows="6" maxlength="10000">${escapeHtml(e.body || '')}</textarea>
      </div>

      <div class="form-row edit-attribution-row" ${isVerbatim ? '' : 'style="display:none;"'}>
        <label>Attribution <span class="required">*required for VERBATIM</span></label>
        <input type="text" class="edit-attribution" maxlength="200" value="${escapeHtml(e.attribution || '')}">
      </div>

      <div class="form-row">
        <label>Tags <span class="hint">(comma-separated)</span></label>
        <input type="text" class="edit-tags" value="${escapeHtml(tagsCsv)}">
      </div>

      <div class="form-row button-row">
        <button type="button" class="primary" data-action="save">Save changes</button>
        <button type="button" class="secondary" data-action="cancel">Cancel</button>
      </div>

      <div class="status edit-status"></div>
    </div>
  `;
}

function findLi(el) {
  while (el && el !== document) {
    if (el.tagName === 'LI' && el.dataset.entryId) return el;
    el = el.parentNode;
  }
  return null;
}

function openEditPanel(li) {
  const id = li.dataset.entryId;
  const entry = recentEntriesById[id];
  if (!entry) return;

  const panel = li.querySelector('.edit-panel');
  panel.innerHTML = renderEditPanel(entry);
  panel.hidden = false;
  li.classList.add('expanded');

  // Wire content-type radio toggle for the attribution row
  const radios = panel.querySelectorAll(`input[name="edit-content-type-${id}"]`);
  const attrRow = panel.querySelector('.edit-attribution-row');
  radios.forEach(r => {
    r.addEventListener('change', () => {
      attrRow.style.display = r.value === 'VERBATIM' && r.checked ? 'flex' : 'none';
    });
  });
}

function closeEditPanel(li) {
  const panel = li.querySelector('.edit-panel');
  panel.innerHTML = '';
  panel.hidden = true;
  li.classList.remove('expanded');
}

async function saveEdit(li) {
  const id = li.dataset.entryId;
  const url = getBackendUrl();
  const slug = getActiveSlug();
  const token = getActiveToken();
  const panel = li.querySelector('.edit-panel');
  const statusEl = panel.querySelector('.edit-status');

  if (!url || !slug || !token) {
    statusEl.className = 'status edit-status status-error';
    statusEl.textContent = 'Save credentials first.';
    return;
  }

  const ctRadios = panel.querySelectorAll(`input[name="edit-content-type-${id}"]`);
  let content_type = 'REFERENCE';
  ctRadios.forEach(r => { if (r.checked) content_type = r.value; });

  const question = panel.querySelector('.edit-question').value.trim();
  const body = panel.querySelector('.edit-body').value.trim();
  const attribution = panel.querySelector('.edit-attribution').value.trim();
  const tagsRaw = panel.querySelector('.edit-tags').value.trim();
  const tags = tagsRaw
    ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean)
    : [];

  // Client-side guards mirror server validation — server is authoritative.
  if (!question) {
    statusEl.className = 'status edit-status status-error';
    statusEl.textContent = 'Question is required.';
    return;
  }
  if (!body) {
    statusEl.className = 'status edit-status status-error';
    statusEl.textContent = 'Body is required.';
    return;
  }
  if (content_type === 'VERBATIM' && !attribution) {
    statusEl.className = 'status edit-status status-error';
    statusEl.textContent = 'VERBATIM entries require an attribution.';
    return;
  }

  const payload = {
    deployment_slug: slug,
    content_type,
    question,
    body,
    tags,
  };
  // Always send attribution: explicit empty for REFERENCE so server knows
  // the field was considered. Server treats null per VERBATIM-only rule.
  payload.attribution = content_type === 'VERBATIM' ? attribution : null;

  statusEl.className = 'status edit-status status-info';
  statusEl.textContent = 'Saving…';

  try {
    const res = await fetch(`${url}/admin/kb/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      statusEl.className = 'status edit-status status-error';
      statusEl.textContent = `Failed (${res.status}): ${data.message || 'unknown'}`;
      return;
    }

    // Replace the <li> in place with the freshly-returned entry.
    const updated = data.entry;
    if (updated) {
      recentEntriesById[updated.id] = updated;
      const wrapper = document.createElement('div');
      wrapper.innerHTML = renderEntryLi(updated).trim();
      const newLi = wrapper.firstChild;
      li.replaceWith(newLi);
    } else {
      // No entry returned — refresh the whole list as a fallback.
      loadRecent();
    }
  } catch (err) {
    statusEl.className = 'status edit-status status-error';
    statusEl.textContent = `Network error: ${err.message}`;
  }
}

async function deleteEntry(li) {
  const id = li.dataset.entryId;
  const entry = recentEntriesById[id];
  const questionPreview = entry ? entry.question : id;

  if (!confirm(`Delete this entry?\n\n"${questionPreview}"\n\nThis cannot be undone.`)) {
    return;
  }

  const url = getBackendUrl();
  const slug = getActiveSlug();
  const token = getActiveToken();

  if (!url || !slug || !token) {
    alert('Save credentials first.');
    return;
  }

  try {
    const res = await fetch(`${url}/admin/kb/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ deployment_slug: slug }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(`Delete failed (${res.status}): ${data.message || 'unknown'}`);
      return;
    }
    // Remove the <li> from the DOM.
    delete recentEntriesById[id];
    li.remove();
  } catch (err) {
    alert(`Network error: ${err.message}`);
  }
}

// Single delegated click handler on #recent-list. Dispatches based on
// the button's data-action attribute.
function handleRecentListClick(ev) {
  const btn = ev.target.closest('button[data-action]');
  if (!btn) return;
  const li = findLi(btn);
  if (!li) return;
  const action = btn.dataset.action;

  if (action === 'edit') {
    if (li.classList.contains('expanded')) {
      closeEditPanel(li);
    } else {
      openEditPanel(li);
    }
  } else if (action === 'cancel') {
    closeEditPanel(li);
  } else if (action === 'save') {
    saveEdit(li);
  } else if (action === 'delete') {
    deleteEntry(li);
  }
}

function escapeHtml(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ----------------------------------------------------------------
// Wire up
// ----------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  loadCredentialsIntoForm();
  toggleAttributionVisibility();

  // Setup buttons
  document.getElementById('save-credentials').addEventListener('click', saveCredentials);
  document.getElementById('test-connection').addEventListener('click', testConnection);
  document.getElementById('clear-credentials').addEventListener('click', clearCredentials);

  // Content type radio toggle (entry form)
  document.querySelectorAll('input[name="content-type"]').forEach(r => {
    r.addEventListener('change', toggleAttributionVisibility);
  });

  // Char counts (entry form)
  document.getElementById('question').addEventListener('input', () =>
    updateCharCount('question', 'question-count', 500)
  );
  document.getElementById('body').addEventListener('input', () =>
    updateCharCount('body', 'body-count', 10000)
  );
  document.getElementById('attribution').addEventListener('input', () =>
    updateCharCount('attribution', 'attribution-count', 200)
  );

  // Submit + refresh
  document.getElementById('submit-entry').addEventListener('click', submitEntry);
  document.getElementById('refresh-recent').addEventListener('click', loadRecent);

  // Keyboard shortcut: Ctrl+Enter / Cmd+Enter to submit from anywhere in the form
  document.getElementById('entry-section').addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      submitEntry();
    }
  });

  // V1.3.3 — delegated click handler for edit/delete/save/cancel
  document.getElementById('recent-list').addEventListener('click', handleRecentListClick);

  // If credentials already saved, auto-load recent
  if (getBackendUrl() && getActiveSlug() && getActiveToken()) {
    loadRecent();
  }
});
