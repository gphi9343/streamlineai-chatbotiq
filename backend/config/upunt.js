// backend/config/upunt.js
// CONFIG for the UPunt (racing testbed) deployment.
//
// Pattern 5 — CONFIG vs CODE separation:
//   This file owns: voice profile, KB content, brand, system prompt template,
//   data sources, pass-through rules, hard guardrails.
//   No engine logic lives here. No API integration code. No state management.
//
// V1.0 minimal — only the fields used at V1.0. Voice profile arrives at V1.5,
// KB structure at V1.2, INTEL/FORM tagging at V1.4. The skeleton establishes
// the boundary now so later versions extend rather than refactor.
//
// To deploy this engine for a different client: clone this file as
// `config/<client>.js` and swap the values. Code never changes.

export const upuntConfig = {
  // Identity
  deployment_name: 'UPunt Racing Chatbot',
  domain: 'Australian thoroughbred horse racing',
  client_slug: 'upunt',

  // Brand (used by frontend at V1.0 — backend reads at V1.5+ for tone hints)
  brand: {
    primary_colour: '#080808',
    accent_colour: '#C9A84C',
    text_colour: '#F5F0E8',
    font: 'Barlow Condensed, system-ui, sans-serif',
  },

  // Voice profile placeholder — V1.5 fills this out
  voice_profile: {
    tone: [],
    style: '',
    signature_phrases: [],
    forbidden_words: [],
    forbidden_behaviours: [],
    example_messages: [],
  },

  // Hard guardrails (always on, even at V1.0)
  hard_guardrails: [
    'Do not provide gambling advice or specific betting recommendations.',
    'Do not make jokes at the expense of identifiable people.',
    'Do not share personal information about anyone.',
    'Do not swear unprompted.',
  ],

  // Data sources placeholder — V1.6 fills this out
  data_sources: {
    scheduled_ingestion: [],
    injection_channels: [],
  },

  // Pass-through rules placeholder — V1.4 fills this out (INTEL pattern)
  pass_through_rules: {
    intel_verbatim: true,
    intel_attribution: 'Expert tip',
  },
};
