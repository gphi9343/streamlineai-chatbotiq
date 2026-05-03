// frontend/chat.js
//
// V1.1 — adds session ID and SSE event parsing.
//
// Session ID: UUID generated client-side, persisted in localStorage.
// Survives page reloads. Cleared via the "New conversation" button.

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
      const errText = await response.text();
      appendStatus(`Error ${response.status}: ${errText}`);
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
        const event = parseSSEBlock(block);
        if (!event) continue;

        if (event.event === 'token') {
          assistantDiv.textContent += event.data.text;
          els.messages.scrollTop = els.messages.scrollHeight;
        } else if (event.event === 'error') {
          appendStatus(
            `Error: ${event.data.message}${
              event.data.suggestion ? ` — ${event.data.suggestion}` : ''
            }`
          );
        } else if (event.event === 'stop_reason') {
          // Diagnostic only — non-end_turn cases
          console.warn('[chatbotiq] stop_reason:', event.data);
        } else if (event.event === 'done') {
          // Optional: surface token usage in dev console
          console.log('[chatbotiq] done:', event.data);
        }
      }
    }
  }

  function parseSSEBlock(block) {
    const lines = block.split('\n');
    let eventName = 'message';
    let dataLines = [];
    for (const line of lines) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) return null;
    try {
      return { event: eventName, data: JSON.parse(dataLines.join('\n')) };
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
