// client-conversations-frontend/app.js
//
// Client-facing Conversations viewer. Static, no build, no login. Reads the
// deployment slug from CLIENT_CONFIG (config.js), overridable by ?slug=, and
// the access token from the ?token= URL param (the bookmarkable link). Calls
// GET {backendUrl}/admin/conversations/:slug?start=&end=&token=, which accepts
// the client token via query param (backend allowQueryToken). Rendering
// (escaping, collapse/expand) mirrors admin-frontend/admin.js, stripped of the
// KB/recent/credential surfaces — this page only ever shows one deployment.

(function () {
  const cfg = window.CLIENT_CONFIG || {};
  const params = new URLSearchParams(window.location.search);
  const slug = (params.get('slug') || cfg.slug || '').trim();
  const token = (params.get('token') || '').trim();
  const backendUrl = (cfg.backendUrl || '').replace(/\/+$/, '');

  function applyBranding() {
    const b = cfg.brand || {};
    const root = document.documentElement.style;
    if (b.bg) root.setProperty('--bg', b.bg);
    if (b.accent) root.setProperty('--accent', b.accent);
    if (b.text) root.setProperty('--text', b.text);

    const name = cfg.businessName || 'Conversations';
    document.getElementById('brand-name').textContent = name;
    document.title = `${name} — Conversations`;

    if (cfg.logoUrl) {
      const logo = document.getElementById('brand-logo');
      logo.src = cfg.logoUrl;
      logo.alt = name;
      logo.hidden = false;
    }
  }

  function showStatus(message, kind) {
    const el = document.getElementById('conversations-status');
    el.className = `status status-${kind || 'info'}`;
    el.textContent = message;
  }
  function clearStatus() {
    const el = document.getElementById('conversations-status');
    el.className = 'status';
    el.textContent = '';
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

  function toDateInputValue(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  function setPreset(days) {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    document.getElementById('conv-start').value = toDateInputValue(start);
    document.getElementById('conv-end').value = toDateInputValue(end);
  }

  async function loadConversations() {
    clearStatus();
    const listEl = document.getElementById('conversations-list');

    if (!token) {
      listEl.innerHTML = '';
      showStatus('This link is missing its access token. Ask for a fresh link.', 'error');
      return;
    }
    if (!slug || !backendUrl) {
      listEl.innerHTML = '';
      showStatus('This viewer is not configured correctly (missing slug or backend URL).', 'error');
      return;
    }

    const start = document.getElementById('conv-start').value;
    const end = document.getElementById('conv-end').value;
    if (!start || !end) {
      showStatus('Pick a start and end date.', 'error');
      return;
    }
    if (start > end) {
      showStatus('Start date must be on or before end date.', 'error');
      return;
    }

    listEl.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const url =
        `${backendUrl}/admin/conversations/${encodeURIComponent(slug)}` +
        `?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}` +
        `&token=${encodeURIComponent(token)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        listEl.innerHTML = '';
        const msg = res.status === 401
          ? 'This link is no longer valid. Ask for a fresh one.'
          : `Couldn't load conversations (${res.status}).`;
        showStatus(msg, 'error');
        return;
      }
      renderConversations(data.conversations || [], data);
    } catch (err) {
      listEl.innerHTML = '';
      showStatus(`Network error: ${err.message}`, 'error');
    }
  }

  function renderConversations(conversations, meta) {
    const listEl = document.getElementById('conversations-list');
    if (conversations.length === 0) {
      listEl.innerHTML = '<p class="muted">No conversations in this date range.</p>';
      return;
    }
    const truncNote = meta && meta.truncated
      ? ` (capped at ${conversations.length} — narrow the range for the rest)`
      : '';
    const header = `<p class="muted">${conversations.length} conversation${conversations.length === 1 ? '' : 's'}${truncNote}.</p>`;
    const items = conversations.map((c, i) => renderConversation(c, i)).join('');
    listEl.innerHTML = header + `<div class="conv-list">${items}</div>`;
  }

  function renderConversation(c, index) {
    const when = c.created_at ? new Date(c.created_at).toLocaleString() : '';
    const firstUser = (c.messages || []).find(m => m.role === 'user');
    const preview = firstUser ? firstUser.content : '(no message)';

    const msgs = (c.messages || []).map(m => {
      const roleClass = m.role === 'assistant' ? 'msg-assistant' : 'msg-user';
      const roleLabel = m.role === 'assistant' ? 'Bot' : 'Visitor';
      const time = m.created_at ? new Date(m.created_at).toLocaleTimeString() : '';
      return `
        <div class="msg ${roleClass}">
          <span class="msg-role">${escapeHtml(roleLabel)}<span class="msg-time">${escapeHtml(time)}</span></span>
          <div class="msg-content">${escapeHtml(m.content || '')}</div>
        </div>`;
    }).join('');

    return `
      <div class="conv" data-conv-index="${index}">
        <div class="conv-header">
          <span class="conv-toggle">▸</span>
          <span class="conv-when">${escapeHtml(when)}</span>
          <span class="conv-count">${c.message_count} msg</span>
          <span class="conv-preview">${escapeHtml(preview)}</span>
        </div>
        <div class="conv-body" hidden>${msgs}</div>
      </div>`;
  }

  function handleListClick(ev) {
    const headerEl = ev.target.closest('.conv-header');
    if (!headerEl) return;
    const conv = headerEl.closest('.conv');
    const body = conv.querySelector('.conv-body');
    const toggle = conv.querySelector('.conv-toggle');
    if (body.hasAttribute('hidden')) {
      body.removeAttribute('hidden');
      conv.classList.add('expanded');
      if (toggle) toggle.textContent = '▾';
    } else {
      body.setAttribute('hidden', '');
      conv.classList.remove('expanded');
      if (toggle) toggle.textContent = '▸';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    applyBranding();
    setPreset(7);
    document.getElementById('conv-load').addEventListener('click', loadConversations);
    document.getElementById('conv-preset-7').addEventListener('click', () => { setPreset(7); loadConversations(); });
    document.getElementById('conv-preset-30').addEventListener('click', () => { setPreset(30); loadConversations(); });
    document.getElementById('conversations-list').addEventListener('click', handleListClick);

    // Auto-load on open — this is a bookmarked link; show data immediately.
    loadConversations();
  });
})();
