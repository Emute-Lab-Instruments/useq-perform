/**
 * Network utilities for extracting client connection information.
 */

import type { IncomingMessage } from 'http';

/**
 * Extract the client IP address from an HTTP request.
 *
 * Checks the `x-forwarded-for` header first (for proxied connections),
 * then falls back to `req.socket.remoteAddress`.
 */
export function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}
