// backend/lib/auth.js
//
// V1.3 — Admin auth middleware (token-based).
//
// Per-deployment env var token. The deployment's CONFIG points to the env
// var name (e.g. ADMIN_TOKEN_UPUNT). The engine reads process.env[envVarName]
// — never knows the deployment slug directly. Pattern 5 enforced.
//
// Auth flow:
//   1. Request arrives with Authorization: Bearer <token>
//   2. Body must include deployment_slug to identify which CONFIG to load
//   3. Engine looks up CONFIG by slug → reads CONFIG.admin_token_env_var
//   4. Compares request token against process.env[CONFIG.admin_token_env_var]
//   5. Pass on match, 401 on mismatch
//
// V1.3 ships with one deployment (UPunt). Multi-deployment selection
// (V1.3.1+) reads from a deployment registry. For now: hardcoded import.

import { makeError, sendError } from './errors.js';
import { upuntConfig } from '../config/upunt.js';

// Deployment registry — keyed by client_slug.
// V1.3+ deployments register here. Engine reads CONFIG.admin_token_env_var
// to look up the env var name per deployment.
const DEPLOYMENT_REGISTRY = {
  upunt: upuntConfig,
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
  const { requireDeployment = true } = options;

  return (req, res, next) => {
    // --- Extract bearer token
    const authHeader = req.headers.authorization || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return sendError(
        res,
        401,
        makeError({
          type: 'auth_failure',
          message: 'Missing or malformed Authorization header',
          suggestion: 'Send Authorization: Bearer <token>.',
          recoverable: false,
        })
      );
    }
    const token = match[1].trim();
    if (!token) {
      return sendError(
        res,
        401,
        makeError({
          type: 'auth_failure',
          message: 'Empty bearer token',
          suggestion: 'Send a non-empty token.',
          recoverable: false,
        })
      );
    }

    // --- If route doesn't need deployment slug, skip resolution.
    // Used by /admin/deployments listing route.
    if (!requireDeployment) {
      // For deployment-listing routes, accept any token that matches ANY
      // registered deployment. This means: if you have a valid token for
      // any deployment, you can list deployments. Acceptable trade-off
      // for V1.3 since the only operator is Gareth.
      const matched = Object.values(DEPLOYMENT_REGISTRY).some(cfg => {
        const expected = process.env[cfg.admin_token_env_var];
        return expected && expected === token;
      });
      if (!matched) {
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
