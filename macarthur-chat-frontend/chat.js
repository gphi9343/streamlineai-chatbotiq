// frontend/chat.js
//
// V1.2 — KB ingestion and retrieval.
//
// Changes from V1.1:
// - Version label bumped to V1.2
// - Defensive SSE parser: every event logged to console with name + data
// - Every error path surfaces visibly in chat (no more silent empty bubbles)
// - Pre-stream sanity check: if no token events arrive, surfaces a diagnostic
//   message rather than leaving an empty assistant bubble
// - Handles the V1.2 done event including the new kb_hits field
//
// Backend contract preserved — same SSE event shape from server.js.

(() => {
  const VERSION = 'V1.2';
  const BACKEND_URL = window.BACKEND_URL || 'https://streamlineai-chatbotiq-production.up.railway.app';
  const SESSION_KEY = 'chatbotiq_session_id';

  const els = {
    messages: document.getElementById('messages'),
    form: document.getElementById('chat-form'),
    input: document.getElementById('input'),
    sendBtn: document.getElementById('send'),
    newConvBtn: document.getElementById('new-conversation'),
  };

  // --- Session management
  function getSessionId() {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  }

  function resetSession() {
    localStorage.removeItem(SESSION_KEY);
    els.messages.innerHTML = '';
    renderWelcome();
  }

  // --- Welcome / empty state (frontend-only; not a bot response)
  // Static greeting + clickable example questions + direct link to the real
  // Macarthur quote request form. Renders on boot and on "New chat".
  // Cleared the moment the customer sends their first message.
  const QUOTE_URL = 'https://www.macarthurmarbleandgranite.com/quote-1';
  const EXAMPLE_QUESTIONS = [
    'What materials do you work with?',
    'How soon can you measure and install?',
    'What areas do you service?',
  ];

  function renderWelcome() {
    const wrap = document.createElement('div');
    wrap.className = 'welcome';
    wrap.id = 'welcome';

    wrap.innerHTML =
      '<h2 class="welcome-title">Hello — welcome to Macarthur Marble &amp; Granite.</h2>' +
      '<p class="welcome-body">I\u2019m here to answer quick questions about our materials, ' +
      'how our process works, and where we service.</p>' +
      '<p class="welcome-cta">Ready to get a quote? ' +
      '<a href="' + QUOTE_URL + '" target="_blank" rel="noopener">Head to our quote request form \u2192</a> ' +
      '\u2014 pop in your details and the team will take it from there.</p>' +
      '<p class="welcome-prompt">Or ask me something first:</p>';

    const chips = document.createElement('div');
    chips.className = 'chips';
    EXAMPLE_QUESTIONS.forEach(q => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = q;
      chip.addEventListener('click', () => sendMessage(q));
      chips.appendChild(chip);
    });
    wrap.appendChild(chips);

    els.messages.appendChild(wrap);
  }

  function clearWelcome() {
    const w = document.getElementById('welcome');
    if (w) w.remove();
  }

  // --- DOM helpers
  function appendMessage(role, text) {
    const div = document.createElement('div');
    div.className = `msg msg-${role}`;
    div.textContent = text;
    els.messages.appendChild(div);
    els.messages.scrollTop = els.messages.scrollHeight;
    return div;
  }

  function appendStatus(text) {
    const div = document.createElement('div');
    div.className = 'msg msg-status';
    div.textContent = text;
    els.messages.appendChild(div);
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function setBusy(busy) {
    els.sendBtn.disabled = busy;
    els.input.disabled = busy;
  }

  // --- SSE handler
  async function streamChat(message, assistantDiv) {
    const sessionId = getSessionId();
    let tokenCount = 0;
    let doneReceived = false;

    console.log(`[chatbotiq] ${VERSION} sending message`, { sessionId, length: message.length });

    let response;
    try {
      response = await fetch(`${BACKEND_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, message }),
      });
    } catch (err) {
      console.error('[chatbotiq] fetch failed', err);
      assistantDiv.textContent = `[Network error: ${err.message}]`;
      assistantDiv.classList.add('msg-error');
      return;
    }

    console.log('[chatbotiq] response status', response.status, response.headers.get('content-type'));

    if (!response.ok) {
      const errText = await response.text();
      console.error('[chatbotiq] non-OK response', response.status, errText);
      assistantDiv.textContent = `[Error ${response.status}: ${errText}]`;
      assistantDiv.classList.add('msg-error');
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE blocks separated by blank line
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop(); // last incomplete block goes back to buffer

        for (const block of blocks) {
          if (!block.trim()) continue;
          const event = parseSSEBlock(block);
          if (!event) {
            console.warn('[chatbotiq] could not parse SSE block', block);
            continue;
          }

          console.log('[chatbotiq] event', event.event, event.data);

          if (event.event === 'token') {
            tokenCount += 1;
            assistantDiv.textContent += event.data.text;
            els.messages.scrollTop = els.messages.scrollHeight;
          } else if (event.event === 'error') {
            const msg = event.data.message || 'unknown error';
            const sug = event.data.suggestion ? ` — ${event.data.suggestion}` : '';
            assistantDiv.textContent = `[Error: ${msg}${sug}]`;
            assistantDiv.classList.add('msg-error');
          } else if (event.event === 'stop_reason') {
            console.warn('[chatbotiq] stop_reason', event.data);
          } else if (event.event === 'done') {
            doneReceived = true;
            console.log('[chatbotiq] done', event.data);
          } else {
            console.warn('[chatbotiq] unknown event', event.event, event.data);
          }
        }
      }
    } catch (err) {
      console.error('[chatbotiq] stream read failed', err);
      if (!assistantDiv.textContent) {
        assistantDiv.textContent = `[Stream error: ${err.message}]`;
        assistantDiv.classList.add('msg-error');
      }
      return;
    }

    // Defensive: if the stream ended with no tokens and no error event,
    // surface a diagnostic so the user sees something rather than an empty bubble.
    if (tokenCount === 0 && !assistantDiv.textContent) {
      console.error('[chatbotiq] stream ended with no tokens', { doneReceived });
      assistantDiv.textContent = doneReceived
        ? '[Empty response from server. Check Railway logs.]'
        : '[Stream ended unexpectedly. Check Network tab for SSE events.]';
      assistantDiv.classList.add('msg-error');
    } else if (!assistantDiv.classList.contains('msg-error')) {
      // Stream finished cleanly — convert any URLs in the completed message
      // into real clickable links. Done once, post-stream (can't linkify
      // mid-stream: a URL arrives across many tokens). Plain-text content is
      // HTML-escaped first so bot output can never inject markup.
      linkify(assistantDiv);
    }
  }

  // Render a completed assistant message: escape (textContent source is safe,
  // but we build innerHTML), auto-link URLs, then apply a tiny markdown subset
  // (**bold** and "- " bullet lists). Run once, post-stream — a URL or **span**
  // can arrive split across many tokens, so it can't be done mid-stream.
  function linkify(el) {
    const raw = el.textContent;
    const escaped = raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    // Auto-link in one pass: match an email OR a URL/bare-domain. A single scan
    // consumes each address whole, so ruby@macarthurmarble.sydney is linked as
    // one mailto and its domain is never re-matched as a URL. The email
    // alternative is listed first so it wins when a dotted local-part (e.g.
    // first.last@x.com) lets both alternatives start at the same offset.
    const linkPattern = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b|\b(?:https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]*)?/gi;
    let html = escaped.replace(linkPattern, (match) => {
      // Email branch — the @ only the email alternative can produce.
      if (match.includes('@')) {
        return `<a href="mailto:${match}">${match}</a>`;
      }
      // Skip if it doesn't look like a real domain (avoid matching e.g. "e.g")
      if (!/\.[a-z]{2,}/i.test(match)) return match;
      // Strip trailing punctuation that shouldn't be part of the link
      // (e.g. "...quote-1," or "(quote-1)."), re-appending it after the anchor.
      let trail = '';
      const m = match.match(/[.,;:!?)\]]+$/);
      if (m) { trail = m[0]; match = match.slice(0, -trail.length); }
      const href = match.startsWith('http') ? match : `https://${match}`;
      return `<a href="${href}" target="_blank" rel="noopener">${match}</a>${trail}`;
    });

    // **bold** -> <strong> (non-greedy, within a single line)
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Group runs of "- item" lines into a single <ul>. Emit each list as one
    // tag-string with no internal newlines, and strip newlines touching the
    // <ul>/</ul> so white-space: pre-wrap doesn't add blank lines around it.
    const lines = html.split('\n');
    const out = [];
    let items = null;
    const flush = () => { if (items) { out.push(`<ul>${items.join('')}</ul>`); items = null; } };
    for (const line of lines) {
      const m = line.match(/^\s*-\s+(.*)$/);
      if (m) (items || (items = [])).push(`<li>${m[1]}</li>`);
      else { flush(); out.push(line); }
    }
    flush();
    html = out.join('\n').replace(/\n*(<ul>)/g, '$1').replace(/(<\/ul>)\n*/g, '$1');

    if (html !== escaped) {
      el.innerHTML = html;
    }
  }

  function parseSSEBlock(block) {
    const lines = block.split('\n');
    let eventName = 'message';
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) return null;
    try {
      return { event: eventName, data: JSON.parse(dataLines.join('\n')) };
    } catch (err) {
      console.warn('[chatbotiq] JSON.parse failed on data', dataLines, err);
      return null;
    }
  }

  // --- Shared send path (used by the form AND the welcome chips)
  async function sendMessage(message) {
    message = (message || '').trim();
    if (!message) return;
    if (els.sendBtn.disabled) return; // ignore taps while a response is streaming

    clearWelcome();
    appendMessage('user', message);
    els.input.value = '';
    const assistantDiv = appendMessage('assistant', '');
    setBusy(true);

    try {
      await streamChat(message, assistantDiv);
    } finally {
      setBusy(false);
      els.input.focus();
    }
  }

  // --- Form submit
  els.form.addEventListener('submit', ev => {
    ev.preventDefault();
    sendMessage(els.input.value);
  });

  // --- New conversation
  if (els.newConvBtn) {
    els.newConvBtn.addEventListener('click', resetSession);
  }

  // --- Boot
  renderWelcome();
  els.input.focus();
  console.log(`[chatbotiq] ${VERSION} client ready. Session:`, getSessionId());
})();
