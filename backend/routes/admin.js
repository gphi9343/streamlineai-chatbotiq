// backend/routes/admin.js
//
// V1.3 — Admin routes for KB curation.
//
// Endpoints:
//   GET  /admin/deployments         — list registered deployments (for picker)
//   POST /admin/kb                  — create a KB entry (REFERENCE or VERBATIM)
//   GET  /admin/kb                  — list KB entries for a deployment (read-back / pagination)
//
// Deferred to V1.3.1+:
//   - PATCH /admin/kb/:id (edit existing entry)
//   - DELETE /admin/kb/:id (remove entry)
//   - POST /admin/kb/bulk (CSV upload)
//   - POST /admin/ingest (API webhook for VERBATIM from third parties)
//
// All routes require Bearer token auth via lib/auth.js.

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { requireAdminAuth, listDeployments } from '../lib/auth.js';
import { makeError, serialiseError, sendError } from '../lib/errors.js';

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
//     source: "..."                  // optional, defaults to 'admin-form-v1.3'
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

  // --- Validate content_type
  if (content_type !== 'REFERENCE' && content_type !== 'VERBATIM') {
    return sendError(
      res,
      400,
      makeError({
        type: 'validation_error',
        message: 'content_type must be "REFERENCE" or "VERBATIM"',
        suggestion: 'Send content_type as one of the two enum values.',
        recoverable: false,
      })
    );
  }

  // --- Validate question
  if (typeof question !== 'string' || !question.trim()) {
    return sendError(
      res,
      400,
      makeError({
        type: 'validation_error',
        message: 'question is required',
        suggestion: 'Send a non-empty question string.',
        recoverable: false,
      })
    );
  }
  if (question.length > 500) {
    return sendError(
      res,
      400,
      makeError({
        type: 'validation_error',
        message: 'question exceeds 500 character limit',
        suggestion: 'Shorten the question.',
        recoverable: false,
      })
    );
  }

  // --- Validate body
  if (typeof body !== 'string' || !body.trim()) {
    return sendError(
      res,
      400,
      makeError({
        type: 'validation_error',
        message: 'body is required',
        suggestion: 'Send a non-empty body string.',
        recoverable: false,
      })
    );
  }
  if (body.length > 10000) {
    return sendError(
      res,
      400,
      makeError({
        type: 'validation_error',
        message: 'body exceeds 10000 character limit',
        suggestion: 'Shorten the body or split into multiple entries.',
        recoverable: false,
      })
    );
  }

  // --- VERBATIM requires attribution
  if (content_type === 'VERBATIM') {
    if (typeof attribution !== 'string' || !attribution.trim()) {
      return sendError(
        res,
        400,
        makeError({
          type: 'validation_error',
          message: 'VERBATIM entries require attribution',
          suggestion:
            'Send a non-empty attribution string identifying the source.',
          recoverable: false,
        })
      );
    }
    if (attribution.length > 200) {
      return sendError(
        res,
        400,
        makeError({
          type: 'validation_error',
          message: 'attribution exceeds 200 character limit',
          suggestion: 'Shorten the attribution.',
          recoverable: false,
        })
      );
    }
  }

  // --- Validate tags (optional)
  let tagsArr = [];
  if (tags !== undefined && tags !== null) {
    if (!Array.isArray(tags)) {
      return sendError(
        res,
        400,
        makeError({
          type: 'validation_error',
          message: 'tags must be an array of strings',
          suggestion: 'Send tags as an array, or omit the field.',
          recoverable: false,
        })
      );
    }
    if (!tags.every(t => typeof t === 'string' && t.length <= 50)) {
      return sendError(
        res,
        400,
        makeError({
          type: 'validation_error',
          message: 'each tag must be a string under 50 chars',
          suggestion: 'Trim tags before sending.',
          recoverable: false,
        })
      );
    }
    tagsArr = tags.map(t => t.trim()).filter(Boolean);
  }

  // --- Insert
  const row = {
    deployment_slug,
    content_type,
    question: question.trim(),
    body: body.trim(),
    attribution: content_type === 'VERBATIM' ? attribution.trim() : null,
    tags: tagsArr,
    source: (source && typeof source === 'string' ? source.trim() : '') || 'admin-form-v1.3',
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
