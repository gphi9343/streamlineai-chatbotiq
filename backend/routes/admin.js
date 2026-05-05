// backend/routes/admin.js
//
// V1.3.3 — Added PATCH /admin/kb/:id and DELETE /admin/kb/:id.
// Validators extracted to a single internal helper used by both POST and
// PATCH. POST validates the full inbound body; PATCH merges the request
// body over the existing row and validates the merged final state.
//
// V1.3 baseline preserved: GET /admin/deployments, POST /admin/kb,
// GET /admin/kb. Auth shape unchanged. Structured error contract
// unchanged. Supabase client unchanged.
//
// Deferred to V1.4+:
//   - POST /admin/kb/bulk (CSV upload)
//   - POST /admin/ingest (API webhook for VERBATIM from third parties)
//
// Endpoints:
//   GET    /admin/deployments         — list registered deployments (for picker)
//   POST   /admin/kb                  — create a KB entry (REFERENCE or VERBATIM)
//   GET    /admin/kb                  — list KB entries for a deployment (read-back / pagination)
//   PATCH  /admin/kb/:id              — partial update (V1.3.3)
//   DELETE /admin/kb/:id              — hard delete (V1.3.3)
//
// All routes require Bearer token auth via lib/auth.js.

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { requireAdminAuth, listDeployments } from '../lib/auth.js';
import { makeError, sendError } from '../lib/errors.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error(
    '[admin] Missing Supabase env vars. Set SUPABASE_URL and SUPABASE_SECRET_KEY.'
  );
}

// Local Supabase client for admin routes — same credentials as lib/supabase.js,
// kept separate so admin operations are obviously distinct in logs.
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

export const adminRouter = Router();

// ----------------------------------------------------------------
// Internal: validate KB fields against the full final-state shape.
//
// Used by POST (validating inbound body as-is) and PATCH (validating the
// merged final state after request body is applied over the existing row).
//
// Returns { ok: true, normalised } on success, where `normalised` contains
// trimmed/cleaned values ready for insert/update.
// Returns { ok: false, error } on failure, where `error` is a structured
// error object ready to pass to sendError().
//
// Caller is responsible for choosing which fields to merge before calling.
// This helper does NOT distinguish between "field omitted" and "field
// present but empty" — both fail required-field checks the same way.
// PATCH's merge step decides which fields are required vs preserved.
// ----------------------------------------------------------------
function validateKbFields({ content_type, question, body, attribution, tags, source }) {
  // --- content_type
  if (content_type !== 'REFERENCE' && content_type !== 'VERBATIM') {
    return {
      ok: false,
      error: makeError({
        type: 'validation_error',
        message: 'content_type must be "REFERENCE" or "VERBATIM"',
        suggestion: 'Send content_type as one of the two enum values.',
        recoverable: false,
      }),
    };
  }

  // --- question
  if (typeof question !== 'string' || !question.trim()) {
    return {
      ok: false,
      error: makeError({
        type: 'validation_error',
        message: 'question is required',
        suggestion: 'Send a non-empty question string.',
        recoverable: false,
      }),
    };
  }
  if (question.length > 500) {
    return {
      ok: false,
      error: makeError({
        type: 'validation_error',
        message: 'question exceeds 500 character limit',
        suggestion: 'Shorten the question.',
        recoverable: false,
      }),
    };
  }

  // --- body
  if (typeof body !== 'string' || !body.trim()) {
    return {
      ok: false,
      error: makeError({
        type: 'validation_error',
        message: 'body is required',
        suggestion: 'Send a non-empty body string.',
        recoverable: false,
      }),
    };
  }
  if (body.length > 10000) {
    return {
      ok: false,
      error: makeError({
        type: 'validation_error',
        message: 'body exceeds 10000 character limit',
        suggestion: 'Shorten the body or split into multiple entries.',
        recoverable: false,
      }),
    };
  }

  // --- attribution (required iff VERBATIM)
  let attributionNorm = null;
  if (content_type === 'VERBATIM') {
    if (typeof attribution !== 'string' || !attribution.trim()) {
      return {
        ok: false,
        error: makeError({
          type: 'validation_error',
          message: 'VERBATIM entries require attribution',
          suggestion: 'Send a non-empty attribution string identifying the source.',
          recoverable: false,
        }),
      };
    }
    if (attribution.length > 200) {
      return {
        ok: false,
        error: makeError({
          type: 'validation_error',
          message: 'attribution exceeds 200 character limit',
          suggestion: 'Shorten the attribution.',
          recoverable: false,
        }),
      };
    }
    attributionNorm = attribution.trim();
  }

  // --- tags (optional, must be array of short strings if present)
  let tagsNorm = [];
  if (tags !== undefined && tags !== null) {
    if (!Array.isArray(tags)) {
      return {
        ok: false,
        error: makeError({
          type: 'validation_error',
          message: 'tags must be an array of strings',
          suggestion: 'Send tags as an array, or omit the field.',
          recoverable: false,
        }),
      };
    }
    if (!tags.every(t => typeof t === 'string' && t.length <= 50)) {
      return {
        ok: false,
        error: makeError({
          type: 'validation_error',
          message: 'each tag must be a string under 50 chars',
          suggestion: 'Trim tags before sending.',
          recoverable: false,
        }),
      };
    }
    tagsNorm = tags.map(t => t.trim()).filter(Boolean);
  }

  // --- source (optional, defaulted by caller)
  const sourceNorm =
    source && typeof source === 'string' ? source.trim() : '';

  return {
    ok: true,
    normalised: {
      content_type,
      question: question.trim(),
      body: body.trim(),
      attribution: attributionNorm,
      tags: tagsNorm,
      source: sourceNorm,
    },
  };
}

// ----------------------------------------------------------------
// GET /admin/deployments
// Lists registered deployments for the admin frontend picker.
// Auth: any valid token for any registered deployment.
// ----------------------------------------------------------------
adminRouter.get(
  '/deployments',
  requireAdminAuth({ requireDeployment: false }),
  (_req, res) => {
    res.json({ status: 'ok', deployments: listDeployments() });
  }
);

// ----------------------------------------------------------------
// POST /admin/kb
// Create a KB entry.
//
// Body:
//   {
//     deployment_slug: "upunt",      // required
//     content_type: "REFERENCE" | "VERBATIM",  // required
//     question: "...",               // required
//     body: "...",                   // required
//     attribution: "...",            // required iff content_type = VERBATIM
//     tags: ["..."],                 // optional
//     source: "..."                  // optional, defaults to 'admin-form-v1.3.3'
//   }
//
// Auth: Bearer token matching the deployment's admin_token_env_var.
// ----------------------------------------------------------------
adminRouter.post('/kb', requireAdminAuth(), async (req, res) => {
  const {
    deployment_slug,
    content_type,
    question,
    body,
    attribution,
    tags,
    source,
  } = req.body || {};

  const validation = validateKbFields({
    content_type,
    question,
    body,
    attribution,
    tags,
    source,
  });
  if (!validation.ok) {
    return sendError(res, 400, validation.error);
  }
  const n = validation.normalised;

  const row = {
    deployment_slug,
    content_type: n.content_type,
    question: n.question,
    body: n.body,
    attribution: n.content_type === 'VERBATIM' ? n.attribution : null,
    tags: n.tags,
    source: n.source || 'admin-form-v1.3.3',
  };

  const { data, error } = await supabase
    .from('kb_entries')
    .insert(row)
    .select('id, content_type, question, created_at')
    .single();

  if (error) {
    console.error('[admin/kb POST] insert failed:', error);
    return sendError(
      res,
      500,
      makeError({
        type: 'downstream_unavailable',
        message: `KB insert failed: ${error.message}`,
        suggestion: 'Retry; check Supabase status if persistent.',
        recoverable: true,
      })
    );
  }

  return res.status(201).json({
    status: 'ok',
    entry: data,
  });
});

// ----------------------------------------------------------------
// GET /admin/kb?deployment_slug=upunt&limit=50&offset=0
// List KB entries for a deployment. Read-back / pagination.
// Auth: Bearer token matching the deployment's admin_token_env_var.
// ----------------------------------------------------------------
adminRouter.get('/kb', requireAdminAuth(), async (req, res) => {
  const { deployment_slug } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const { data, error, count } = await supabase
    .from('kb_entries')
    .select('id, content_type, question, body, attribution, tags, source, created_at', {
      count: 'exact',
    })
    .eq('deployment_slug', deployment_slug)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error('[admin/kb GET] select failed:', error);
    return sendError(
      res,
      500,
      makeError({
        type: 'downstream_unavailable',
        message: `KB list failed: ${error.message}`,
        suggestion: 'Retry; check Supabase status if persistent.',
        recoverable: true,
      })
    );
  }

  return res.json({
    status: 'ok',
    entries: data || [],
    total: count || 0,
    limit,
    offset,
  });
});

// ----------------------------------------------------------------
// PATCH /admin/kb/:id  (V1.3.3)
// Partial-field update. Merges request body over the existing row,
// then validates the merged final state per validateKbFields().
//
// Body (all fields optional except deployment_slug for auth scoping):
//   {
//     deployment_slug: "upunt",      // required for auth + cross-tenant guard
//     content_type: "REFERENCE" | "VERBATIM",
//     question: "...",
//     body: "...",
//     attribution: "...",
//     tags: ["..."],
//     source: "..."
//   }
//
// Cross-tenant guard: the existing row's deployment_slug must match the
// auth-resolved deployment_slug. Editing across deployments is rejected.
//
// Auth: Bearer token matching the deployment's admin_token_env_var.
// ----------------------------------------------------------------
adminRouter.patch('/kb/:id', requireAdminAuth(), async (req, res) => {
  const { id } = req.params;
  const { deployment_slug } = req.body || {};

  if (!id || typeof id !== 'string' || !id.trim()) {
    return sendError(
      res,
      400,
      makeError({
        type: 'validation_error',
        message: 'Missing or invalid entry id',
        suggestion: 'Send a valid entry id in the path.',
        recoverable: false,
      })
    );
  }

  // --- Fetch existing row
  const { data: existing, error: fetchErr } = await supabase
    .from('kb_entries')
    .select('id, deployment_slug, content_type, question, body, attribution, tags, source, created_at')
    .eq('id', id)
    .single();

  if (fetchErr || !existing) {
    // PostgREST returns an error for "no rows" with .single(); treat both as 404.
    return sendError(
      res,
      404,
      makeError({
        type: 'validation_error',
        message: `KB entry ${id} not found`,
        suggestion: 'Refresh the recent-entries list and try again.',
        recoverable: false,
      })
    );
  }

  // --- Cross-tenant guard
  if (existing.deployment_slug !== deployment_slug) {
    return sendError(
      res,
      403,
      makeError({
        type: 'auth_failure',
        message: 'Entry belongs to a different deployment',
        suggestion: 'Switch to the correct deployment in the admin frontend.',
        recoverable: false,
      })
    );
  }

  // --- Merge request body over existing row.
  // Any field present in req.body overrides; anything absent preserves.
  const merged = {
    content_type:
      req.body.content_type !== undefined ? req.body.content_type : existing.content_type,
    question:
      req.body.question !== undefined ? req.body.question : existing.question,
    body:
      req.body.body !== undefined ? req.body.body : existing.body,
    attribution:
      req.body.attribution !== undefined ? req.body.attribution : existing.attribution,
    tags:
      req.body.tags !== undefined ? req.body.tags : existing.tags,
    source:
      req.body.source !== undefined ? req.body.source : existing.source,
  };

  // --- Validate merged final state
  const validation = validateKbFields(merged);
  if (!validation.ok) {
    return sendError(res, 400, validation.error);
  }
  const n = validation.normalised;

  // --- Build update patch.
  // Only write fields that actually changed vs the existing row, to keep
  // updated_at semantics meaningful and the audit trail tidy.
  const update = {};
  if (n.content_type !== existing.content_type) update.content_type = n.content_type;
  if (n.question !== existing.question) update.question = n.question;
  if (n.body !== existing.body) update.body = n.body;

  const newAttribution = n.content_type === 'VERBATIM' ? n.attribution : null;
  if (newAttribution !== existing.attribution) update.attribution = newAttribution;

  // tags: shallow-equal compare on stringified array
  if (JSON.stringify(n.tags) !== JSON.stringify(existing.tags || [])) {
    update.tags = n.tags;
  }

  // source: only update if explicitly provided in request body
  if (req.body.source !== undefined && n.source && n.source !== existing.source) {
    update.source = n.source;
  }

  if (Object.keys(update).length === 0) {
    // No-op update. Return existing row, signal explicitly.
    return res.json({
      status: 'ok',
      entry: existing,
      changed: false,
    });
  }

  const { data, error } = await supabase
    .from('kb_entries')
    .update(update)
    .eq('id', id)
    .select('id, content_type, question, body, attribution, tags, source, created_at')
    .single();

  if (error) {
    console.error('[admin/kb PATCH] update failed:', error);
    return sendError(
      res,
      500,
      makeError({
        type: 'downstream_unavailable',
        message: `KB update failed: ${error.message}`,
        suggestion: 'Retry; check Supabase status if persistent.',
        recoverable: true,
      })
    );
  }

  return res.json({
    status: 'ok',
    entry: data,
    changed: true,
  });
});

// ----------------------------------------------------------------
// DELETE /admin/kb/:id  (V1.3.3)
// Hard delete. Row is removed from kb_entries.
//
// Body:
//   {
//     deployment_slug: "upunt"  // required for auth + cross-tenant guard
//   }
//
// Cross-tenant guard: the existing row's deployment_slug must match the
// auth-resolved deployment_slug.
//
// V1.6 candidate: soft-delete via a deleted_at timestamp column. Adds an
// audit trail and recoverability. Out of scope at V1.3.3 — operator is
// single-user (Gareth), accidental-delete blast radius is small, and
// schema changes belong with the logging dashboard work.
//
// Auth: Bearer token matching the deployment's admin_token_env_var.
// ----------------------------------------------------------------
adminRouter.delete('/kb/:id', requireAdminAuth(), async (req, res) => {
  const { id } = req.params;
  const { deployment_slug } = req.body || {};

  if (!id || typeof id !== 'string' || !id.trim()) {
    return sendError(
      res,
      400,
      makeError({
        type: 'validation_error',
        message: 'Missing or invalid entry id',
        suggestion: 'Send a valid entry id in the path.',
        recoverable: false,
      })
    );
  }

  // --- Fetch existing row for cross-tenant guard
  const { data: existing, error: fetchErr } = await supabase
    .from('kb_entries')
    .select('id, deployment_slug')
    .eq('id', id)
    .single();

  if (fetchErr || !existing) {
    return sendError(
      res,
      404,
      makeError({
        type: 'validation_error',
        message: `KB entry ${id} not found`,
        suggestion: 'Refresh the recent-entries list and try again.',
        recoverable: false,
      })
    );
  }

  if (existing.deployment_slug !== deployment_slug) {
    return sendError(
      res,
      403,
      makeError({
        type: 'auth_failure',
        message: 'Entry belongs to a different deployment',
        suggestion: 'Switch to the correct deployment in the admin frontend.',
        recoverable: false,
      })
    );
  }

  const { error } = await supabase
    .from('kb_entries')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[admin/kb DELETE] delete failed:', error);
    return sendError(
      res,
      500,
      makeError({
        type: 'downstream_unavailable',
        message: `KB delete failed: ${error.message}`,
        suggestion: 'Retry; check Supabase status if persistent.',
        recoverable: true,
      })
    );
  }

  return res.json({
    status: 'ok',
    deleted: id,
  });
});
