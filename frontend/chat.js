// frontend/chat.js
// V1.0 — single-turn chat. No memory, no history persistence.
// Streams from backend's /chat endpoint via Server-Sent Events.

// BACKEND_URL is injected at build time by Netlify env var, or hard-coded here for local testing.
// Set this to your Railway backend URL after deployment.
const BACKEND_URL = window.BACKEND_URL || 'https://YOUR_RAILWAY_BACKEND_URL_HERE';

const messagesEl = document.getElementById('messages');
const formEl = document.getElementById('chat-form');
const inputEl = document.getElementById('chat-input');
const sendEl = document.getElementById('chat-send');
const statusEl = document.getElementById('status');

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = inputEl.value.trim();
  if (!message) return;

  inputEl.value = '';
  setBusy(true);
  appendMessage('user', message);

  const botMessageEl = appendMessage('bot', '', { streaming: true });

  try {
    await streamChat(message, (chunk) => {
      // Append each token to the bot message as it arrives
      const textEl = botMessageEl.querySelector('.message-text');
      textEl.textContent += chunk;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
    // Stream completed — remove cursor
    const cursor = botMessageEl.querySelector('.cursor');
    if (cursor) cursor.remove();
    statusEl.textContent = '';
  } catch (err) {
    // Replace partial bot message with error block
    botMessageEl.remove();
    appendError(err);
  } finally {
    setBusy(false);
    inputEl.focus();
  }
});

async function streamChat(message, onToken) {
  const response = await fetch(`${BACKEND_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });

  if (!response.ok) {
    // Non-streaming error response (validation failure, auth failure, etc.)
    let errorBody;
    try {
      errorBody = await response.json();
    } catch {
      errorBody = { type: 'downstream_unavailable', message: `HTTP ${response.status}`, recoverable: true };
    }
    throw errorBody;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE format: events separated by \n\n, each event has data: <json>
    const events = buffer.split('\n\n');
    buffer = events.pop(); // last partial event stays in buffer

    for (const event of events) {
      const dataLine = event.split('\n').find((l) => l.startsWith('data: '));
      if (!dataLine) continue;
      const json = dataLine.slice(6); // strip "data: "
      try {
        const parsed = JSON.parse(json);
        if (parsed.type === 'token') {
          onToken(parsed.text);
        } else if (parsed.type === 'error') {
          throw parsed.error;
        } else if (parsed.type === 'done') {
          // Stream complete, server-side stop_reason and usage available
          // V1.0 doesn't surface these to the user. V1.7 dashboard will.
        }
      } catch (parseErr) {
        if (parseErr.type) throw parseErr; // re-throw structured errors
        console.warn('[sse_parse_error]', parseErr, json);
      }
    }
  }
}

function appendMessage(role, text, { streaming = false } = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = `message message-${role}`;

  const label = document.createElement('span');
  label.className = 'message-label';
  label.textContent = role === 'user' ? 'You' : 'Bot';
  wrapper.appendChild(label);

  const textEl = document.createElement('span');
  textEl.className = 'message-text';
  textEl.textContent = text;
  wrapper.appendChild(textEl);

  if (streaming) {
    const cursor = document.createElement('span');
    cursor.className = 'cursor';
    wrapper.appendChild(cursor);
  }

  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return wrapper;
}

function appendError(err) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message message-error';

  const label = document.createElement('span');
  label.className = 'message-label';
  label.textContent = `Error — ${err?.type || 'unknown'}`;
  wrapper.appendChild(label);

  const textEl = document.createElement('span');
  textEl.className = 'message-text';
  textEl.textContent = err?.message || 'Something went wrong.';
  wrapper.appendChild(textEl);

  if (err?.suggestion) {
    const suggEl = document.createElement('div');
    suggEl.style.marginTop = '0.5rem';
    suggEl.style.fontSize = '0.85rem';
    suggEl.style.opacity = '0.8';
    suggEl.textContent = err.suggestion;
    wrapper.appendChild(suggEl);
  }

  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setBusy(busy) {
  inputEl.disabled = busy;
  sendEl.disabled = busy;
  statusEl.textContent = busy ? 'Thinking...' : '';
  statusEl.className = 'status';
}
