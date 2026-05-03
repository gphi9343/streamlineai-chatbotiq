// frontend/chat.js
// V1.1 — adds session ID, parses V1.0-format SSE events.
//
// Session ID: UUID generated client-side, persisted in localStorage.
// Survives page reloads. Cleared via the "New conversation" button.
//
// SSE event format (matches V1.0 backend):
//   Each event is `data: {json}\n\n`. JSON has a `type` field:
//     - { type: "token", text: "..." }       — append to assistant message
//     - { type: "done", stop_reason, usage } — stream complete
//     - { type: "error", error: {...} }      — structured error

(() => {
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

  // --- SSE handler — fetch + ReadableStream (works with POST, unlike EventSource)
  async function streamChat(message, assistantDiv) {
    const sessionId = getSessionId();

    let response;
    try {
      response = await fetch(`${BACKEND_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, message }),
      });
    } catch (err) {
      appendStatus(`Network error: ${err.message}`);
      return;
    }

    if (!response.ok) {
      // Non-streaming error response (validation failures before stream starts)
      let errBody;
      try {
        errBody = await response.json();
      } catch {
        errBody = { message: await response.text() };
      }
      appendStatus(`Error ${response.status}: ${errBody.message || 'unknown'}`);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events: blocks separated by blank line
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop(); // last incomplete block goes back to buffer

      for (const block of blocks) {
        if (!block.trim()) continue;
        const data = parseSSEBlock(block);
        if (!data) continue;

        if (data.type === 'token') {
          assistantDiv.textContent += data.text;
          els.messages.scrollTop = els.messages.scrollHeight;
        } else if (data.type === 'error') {
          const err = data.error || {};
          appendStatus(
            `Error: ${err.message || 'unknown'}${
              err.suggestion ? ` — ${err.suggestion}` : ''
            }`
          );
        } else if (data.type === 'done') {
          // Optional: surface token usage in dev console
          console.log('[chatbotiq] done:', data);
        }
      }
    }
  }

  // V1.0 backend uses untyped SSE — only `data:` lines, JSON contains `type`
  function parseSSEBlock(block) {
    const lines = block.split('\n');
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) return null;
    try {
      return JSON.parse(dataLines.join('\n'));
    } catch {
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
  console.log('[chatbotiq] V1.1 client ready. Session:', getSessionId());
})();
