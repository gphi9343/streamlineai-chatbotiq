// admin-frontend/admin.js
//
// V1.3 — Admin frontend for ChatbotIQ KB curation.
//
// Single-page admin tool. Talks to the Railway backend's /admin/* endpoints.
// Stores per-deployment tokens in localStorage as a map.
//
// localStorage shape:
//   chatbotiq_admin_backend_url: "https://...railway.app"
//   chatbotiq_admin_active_slug: "upunt"
//   chatbotiq_admin_tokens: { "upunt": "ADMIN_TOKEN_UPUNT_value", ... }
//
// Failure paths surface visibly per Build Standard #4. No silent errors.

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
// Recent entries
// ----------------------------------------------------------------
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
      list.innerHTML = `<p class="error">Failed (${res.status}): ${data.message || 'unknown'}</p>`;
      return;
    }

    const entries = data.entries || [];
    if (entries.length === 0) {
      list.innerHTML = '<p class="muted">No entries yet for this deployment.</p>';
      return;
    }

    const total = data.total ?? entries.length;
    const html = [
      `<p class="muted">Showing ${entries.length} of ${total} entries.</p>`,
      '<ul class="entry-list">',
      ...entries.map(e => `
        <li>
          <div class="entry-meta">
            <span class="badge badge-${e.content_type.toLowerCase()}">${e.content_type}</span>
            <span class="entry-date">${new Date(e.created_at).toLocaleString()}</span>
          </div>
          <div class="entry-question">${escapeHtml(e.question)}</div>
          <div class="entry-body">${escapeHtml((e.body || '').slice(0, 200))}${e.body && e.body.length > 200 ? '…' : ''}</div>
          ${e.attribution ? `<div class="entry-attr">— ${escapeHtml(e.attribution)}</div>` : ''}
        </li>
      `),
      '</ul>',
    ].join('');
    list.innerHTML = html;
  } catch (err) {
    list.innerHTML = `<p class="error">Network error: ${escapeHtml(err.message)}</p>`;
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

  // Content type radio toggle
  document.querySelectorAll('input[name="content-type"]').forEach(r => {
    r.addEventListener('change', toggleAttributionVisibility);
  });

  // Char counts
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

  // If credentials already saved, auto-load recent
  if (getBackendUrl() && getActiveSlug() && getActiveToken()) {
    loadRecent();
  }
});
