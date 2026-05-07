// streamlineai-chat-frontend/chat.js
//
// V1.4 — StreamlineAI public chat.
//
// Cloned from frontend/chat.js (UPunt's V1.2-shape SSE parser, which
// remains the production-tested shape).
//
// Backend contract — same SSE event shape as UPunt: token / error /
// stop_reason / done. The backend resolves which deployment this request
// belongs to via the Origin header (V1.4 multi-deployment dispatch in
// server.js). No client-side change needed beyond the URL and the
// SESSION_KEY namespace.
//
// Visible-failure-path discipline (Build Standard #4) preserved: every
// SSE event is logged; every error path writes a diagnostic into the
// assistant bubble; "stream ended with zero tokens" surfaces a visible
// fallback message.

(() => {
  const VERSION = 'V1.4';
  const BACKEND_URL = window.BACKEND_URL || 'https://streamlineai-chatbotiq-production.up.railway.app';
  // Namespaced session key so StreamlineAI and UPunt sessions don't collide
  // if they're loaded in the same browser.
  const SESSION_KEY = 'streamlineai_chat_session_id';

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
    appendStatus('New conversation started.');
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

    console.log(`[streamlineai] ${VERSION} sending message`, { sessionId, length: message.length });

    let response;
    try {
      response = await fetch(`${BACKEND_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, message }),
      });
    } catch (err) {
      console.error('[streamlineai] fetch failed', err);
      assistantDiv.textContent = `[Network error: ${err.message}]`;
      assistantDiv.classList.add('msg-error');
      return;
    }

    console.log('[streamlineai] response status', response.status, response.headers.get('content-type'));

    if (!response.ok) {
      const errText = await response.text();
      console.error('[streamlineai] non-OK response', response.status, errText);
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
            console.warn('[streamlineai] could not parse SSE block', block);
            continue;
          }

          console.log('[streamlineai] event', event.event, event.data);

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
            console.warn('[streamlineai] stop_reason', event.data);
          } else if (event.event === 'done') {
            doneReceived = true;
            console.log('[streamlineai] done', event.data);
          } else {
            console.warn('[streamlineai] unknown event', event.event, event.data);
          }
        }
      }
    } catch (err) {
      console.error('[streamlineai] stream read failed', err);
      if (!assistantDiv.textContent) {
        assistantDiv.textContent = `[Stream error: ${err.message}]`;
        assistantDiv.classList.add('msg-error');
      }
      return;
    }

    // Defensive: if the stream ended with no tokens and no error event,
    // surface a diagnostic so the user sees something rather than an empty bubble.
    if (tokenCount === 0 && !assistantDiv.textContent) {
      console.error('[streamlineai] stream ended with no tokens', { doneReceived });
      assistantDiv.textContent = doneReceived
        ? '[Empty response from server. Check Railway logs.]'
        : '[Stream ended unexpectedly. Check Network tab for SSE events.]';
      assistantDiv.classList.add('msg-error');
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
      console.warn('[streamlineai] JSON.parse failed on data', dataLines, err);
      return null;
    }
  }

  // --- Form submit
  els.form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const message = els.input.value.trim();
    if (!message) return;

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
  });

  // --- New conversation
  if (els.newConvBtn) {
    els.newConvBtn.addEventListener('click', resetSession);
  }

  // --- Boot
  els.input.focus();
  console.log(`[streamlineai] ${VERSION} client ready. Session:`, getSessionId());
})();
