// client-conversations-frontend/config.js
//
// Per-deployment config for the client-facing Conversations viewer.
// COPY-AND-SWAP per client: duplicate this folder, edit the values below,
// deploy to that client's own Netlify site. The page only ever knows its own
// slug — the access token is supplied at view time via the ?token= URL param
// (the bookmarkable link), never stored here.
//
// Brand values below are the LIGHT theme taken from the approved live chat
// widget (macarthur-chat-frontend/style.css → macarthur-chat.netlify.app),
// NOT from backend/config/macarthur.js's brand block — that block is stale
// (near-black bg / warm-white text from an old LeadLock build) and is flagged
// for a separate CONFIG fix. app.js maps bg/accent/text onto CSS variables;
// the full light palette (black header block, cream/grey bubbles, borders)
// lives in style.css.
window.CLIENT_CONFIG = {
  slug: 'macarthur',
  businessName: 'Macarthur Marble & Granite',
  backendUrl: 'https://streamlineai-chatbotiq-production.up.railway.app',

  // Light theme (from the approved widget): stone-rose accent on a light-grey
  // ground with dark charcoal text.
  brand: {
    bg: '#f5f5f5',     // light grey ground   (widget --brand-bg)
    accent: '#CBA58F', // stone-rose          (widget --brand-accent)
    text: '#2c2c2c',   // dark charcoal        (widget --brand-text)
  },

  // Optional logo URL (leave '' to show the business name on the black header
  // block). To match the widget exactly, point this at the mmg logo asset.
  logoUrl: '',
};
