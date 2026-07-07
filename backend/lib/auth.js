// backend/lib/auth.js
//
// V1.4 — Multi-deployment registry + chat dispatch resolver.
//
// V1.3 baseline preserved:
//   - Per-deployment env var token. CONFIG points to the env var name
//     (e.g. ADMIN_TOKEN_UPUNT). Engine reads process.env[envVarName] —
//     never knows the deployment slug directly. Pattern 5 enforced.
//   - Auth flow for admin routes:
//       1. Authorization: Bearer <token>
//       2. Body/query carries deployment_slug
//       3. Engine looks up CONFIG by slug → reads CONFIG.admin_token_env_var
//       4. Compares request token against process.env[envVarName]
//       5. Pass on match, 401 on mismatch
//   - requireDeployment: false listing route accepts any registered token.
//     Acceptable at single-operator state. V1.6 deployment-scoped tightening
//     tracked in build journal — V1.4 is the first version where this surface
//     is exercised across two real deployments.
//
// V1.4 additions:
//   - DEPLOYMENT_REGISTRY now contains streamlineai (second deployment).
//   - New exported function: getDeploymentByOrigin(origin). Walks the
//     registry, returns the first CONFIG whose allowed_origins array
//     includes the given Origin header value. Used by /chat dispatch in
//     server.js. Returns null on miss; server.js converts that to a
//     structured config_error.
//   - DEPLOYMENT_REGISTRY remains module-private. Callers use the two
//     exported accessors: getDeploymentConfig(slug) for slug-based admin
//     lookups, getDeploymentByOrigin(origin) for chat dispatch.

import { makeError, sendError } from './errors.js';
import { upuntConfig } from '../config/upunt.js';
import { streamlineaiConfig } from '../config/streamlineai.js';
import { macarthurConfig } from '../config/macarthur.js';
import { demoKawanaConfig } from '../config/demo-kawana.js';

// Deployment registry — keyed by client_slug.
// Add new deployments here. Engine reads CONFIG.admin_token_env_var per
// deployment for admin auth, and CONFIG.allowed_origins per deployment
// for chat dispatch. Registry stays module-private.
const DEPLOYMENT_REGISTRY = {
  upunt: upuntConfig,
  streamlineai: streamlineaiConfig,
  macarthur: macarthurConfig,
  'demo-kawana': demoKawanaConfig,
};

/**
 * Resolve a deployment slug to its CONFIG object.
 * Returns null if slug isn't registered.
 *
 * @param {string} slug
 * @returns {object | null}
 */
export function getDeploymentConfig(slug) {
  if (typeof slug !== 'string' || !slug.trim()) return null;
  return DEPLOYMENT_REGISTRY[slug] || null;
}

/**
 * V1.4 — Resolve an Origin header value to its CONFIG object.
 * Walks the registry; returns the first CONFIG whose allowed_origins
 * array includes the given origin. Returns null on miss.
 *
 * Used by the /chat endpoint dispatch in server.js. The dispatch path
 * treats null as a config_error (Build Standard #2, non-recoverable):
 * a request from an unknown Origin is either a misconfigured deployment
 * or a probe, and both should fail loudly rather than silently routing
 * to a default.
 *
 * Note: a deployment's CONFIG.allowed_origins must agree with the
 * ALLOWED_ORIGINS env var (CORS allow-list). They answer different
 * questions (CORS = which origins can call the API at all; this lookup
 * = which deployment a given allowed origin maps to) but both must
 * include the same origin or the request fails. Drift symptom:
 * "CORS passed, dispatch failed with config_error".
 *
 * @param {string | undefined} origin - value of req.headers.origin
 * @returns {object | null}
 */
export function getDeploymentByOrigin(origin) {
  if (typeof origin !== 'string' || !origin.trim()) return null;
  for (const cfg of Object.values(DEPLOYMENT_REGISTRY)) {
    const list = cfg.allowed_origins;
    if (Array.isArray(list) && list.includes(origin)) {
      return cfg;
    }
  }
  return null;
}

/**
 * List all registered deployments (slug + display name).
 * Used by the admin frontend to populate the deployment picker.
 *
 * @returns {Array<{slug: string, display_name: string}>}
 */
export function listDeployments() {
  return Object.entries(DEPLOYMENT_REGISTRY).map(([slug, cfg]) => ({
    slug,
    display_name: cfg.deployment_name,
  }));
}

/**
 * Express middleware — verifies admin token against the deployment's
 * configured env var.
 *
 * Expects:
 *   - Authorization: Bearer <token> header
 *   - req.body.deployment_slug present (for POST routes that include it)
 *     OR req.query.deployment_slug (for GET routes)
 *
 * On success: attaches req.deploymentConfig and calls next().
 * On failure: returns 401 structured error.
 *
 * Special case: routes that don't need a slug (e.g. GET /admin/deployments)
 * skip slug resolution. Set requireDeployment: false in the route.
 */
export function requireAdminAuth(options = {}) {
  const {
    requireDeployment = true,
    slugFrom = null,
    allowClientToken = false,
    allowQueryToken = false,
  } = options;

  return (req, res, next) => {
    // --- Extract token. Authorization: Bearer is the rule everywhere. The
    // conversations route additionally opts into a ?token= query fallback
    // (allowQueryToken) for the bookmarkable client link — no other route.
    const authHeader = req.headers.authorization || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    let token = match ? match[1].trim() : '';
    let tokenSource = token ? 'header' : null;

    if (!token && allowQueryToken && typeof req.query.token === 'string') {
      token = req.query.token.trim();
      if (token) tokenSource = 'query';
    }

    if (!token) {
      return sendError(
        res,
        401,
        makeError({
          type: 'auth_failure',
          message: 'Missing or malformed credentials',
          suggestion: allowQueryToken
            ? 'Send Authorization: Bearer <token> or ?token=<token>.'
            : 'Send Authorization: Bearer <token>.',
          recoverable: false,
        })
      );
    }

    // --- V1.6 param-scoped mode. Slug comes from the route path
    // (req.params.slug) and the bearer token must be the token issued for
    // THAT specific deployment — not merely any valid admin token. Used by the
    // slug-scoped debug routes and GET /admin/conversations/:slug. Checked
    // before the requireDeployment logic so it takes precedence.
    if (slugFrom === 'param') {
      const slug = req.params && req.params.slug;
      if (!slug || typeof slug !== 'string' || !slug.trim()) {
        return sendError(
          res,
          400,
          makeError({
            type: 'validation_error',
            message: 'Missing slug parameter',
            suggestion: 'This route requires a :slug path segment.',
            recoverable: false,
          })
        );
      }

      const config = getDeploymentConfig(slug);
      if (!config) {
        return sendError(
          res,
          404,
          makeError({
            type: 'validation_error',
            message: `Unknown deployment slug: ${slug}`,
            suggestion: `Valid slugs: ${Object.keys(DEPLOYMENT_REGISTRY).join(', ')}`,
            recoverable: false,
          })
        );
      }

      const envVarName = config.admin_token_env_var;
      if (!envVarName) {
        return sendError(
          res,
          500,
          makeError({
            type: 'config_error',
            message: `Deployment ${slug} has no admin_token_env_var configured`,
            suggestion: 'Add admin_token_env_var to the deployment CONFIG.',
            recoverable: false,
          })
        );
      }

      const expectedToken = process.env[envVarName];
      if (!expectedToken) {
        return sendError(
          res,
          500,
          makeError({
            type: 'config_error',
            message: `Env var ${envVarName} not set`,
            suggestion: `Set ${envVarName} in Railway env vars.`,
            recoverable: false,
          })
        );
      }

      // Admin token authorizes via HEADER ONLY — never via ?token= (keeps the
      // powerful admin token out of URLs, browser history, and access logs).
      if (tokenSource === 'header' && token === expectedToken) {
        req.deploymentConfig = config;
        req.authTier = 'admin';
        return next();
      }

      // Client token tier — opt-in per route via allowClientToken. Narrower,
      // separate env var (config.client_token_env_var); may arrive via header
      // OR the ?token= fallback. Only routes that pass allowClientToken accept
      // it, so a leaked client link can never reach KB/debug routes.
      if (allowClientToken && config.client_token_env_var) {
        const expectedClientToken = process.env[config.client_token_env_var];
        if (expectedClientToken && token === expectedClientToken) {
          req.deploymentConfig = config;
          req.authTier = 'client';
          return next();
        }
      }

      return sendError(
        res,
        401,
        makeError({
          type: 'auth_failure',
          message: 'Invalid token for this deployment',
          suggestion: 'Use the admin token issued for this deployment slug.',
          recoverable: false,
        })
      );
    }

    // --- Scoped enumeration (V1.6). Still accept any valid admin token, but
    // resolve WHICH deployment(s) this token authorizes and attach them so the
    // handler can filter its listing to just those. A token matches exactly one
    // deployment (env var values are unique per deployment). Used by the
    // /admin/deployments listing route.
    if (!requireDeployment) {
      const authorizedSlugs = Object.entries(DEPLOYMENT_REGISTRY)
        .filter(([, cfg]) => {
          const expected = process.env[cfg.admin_token_env_var];
          return expected && expected === token;
        })
        .map(([slug]) => slug);

      if (authorizedSlugs.length === 0) {
        return sendError(
          res,
          401,
          makeError({
            type: 'auth_failure',
            message: 'Token does not match any registered deployment',
            suggestion: 'Check the token in the admin frontend localStorage.',
            recoverable: false,
          })
        );
      }

      req.authorizedSlugs = authorizedSlugs;
      return next();
    }

    // --- Resolve deployment slug from body or query
    const slug =
      (req.body && req.body.deployment_slug) ||
      (req.query && req.query.deployment_slug);

    if (!slug || typeof slug !== 'string') {
      return sendError(
        res,
        400,
        makeError({
          type: 'validation_error',
          message: 'Missing deployment_slug',
          suggestion:
            'Include deployment_slug in request body (POST) or query (GET).',
          recoverable: false,
        })
      );
    }

    const config = getDeploymentConfig(slug);
    if (!config) {
      return sendError(
        res,
        400,
        makeError({
          type: 'validation_error',
          message: `Unknown deployment_slug: ${slug}`,
          suggestion: `Valid slugs: ${Object.keys(DEPLOYMENT_REGISTRY).join(', ')}`,
          recoverable: false,
        })
      );
    }

    // --- Compare token against the deployment's configured env var
    const envVarName = config.admin_token_env_var;
    if (!envVarName) {
      // Misconfiguration — CONFIG is missing the field entirely.
      // Hard error, not recoverable.
      return sendError(
        res,
        500,
        makeError({
          type: 'config_error',
          message: `Deployment ${slug} has no admin_token_env_var configured`,
          suggestion: 'Add admin_token_env_var to the deployment CONFIG.',
          recoverable: false,
        })
      );
    }

    const expectedToken = process.env[envVarName];
    if (!expectedToken) {
      // Env var not set on Railway. Hard error.
      return sendError(
        res,
        500,
        makeError({
          type: 'config_error',
          message: `Env var ${envVarName} not set`,
          suggestion: `Set ${envVarName} in Railway env vars.`,
          recoverable: false,
        })
      );
    }

    if (token !== expectedToken) {
      return sendError(
        res,
        401,
        makeError({
          type: 'auth_failure',
          message: 'Invalid token for this deployment',
          suggestion: 'Check the token in the admin frontend localStorage.',
          recoverable: false,
        })
      );
    }

    // --- Attach config for downstream handlers and continue
    req.deploymentConfig = config;
    next();
  };
}
