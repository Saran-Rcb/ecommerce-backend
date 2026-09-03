import { createHmac, timingSafeEqual } from 'crypto';
import { extname, resolve, sep } from 'path';
import { BadRequestException } from '@nestjs/common';

// Designs hold private customer artwork, so they are written OUTSIDE the
// directory main.ts exposes at /uploads. Nothing here is ever publicly
// reachable — a file is only served through the token-gated endpoint.
//
// Relative to process.cwd(), the same base multer resolves './uploads/...'
// against, so the writer and the reader can never disagree.
export const WHOLESALE_DESIGN_DIR = resolve('private', 'wholesale');

export const MAX_DESIGN_BYTES = 25 * 1024 * 1024;
export const MAX_DESIGN_FILES = 5;

// The configurator advertises exactly these. .ai and .psd reach the server with
// inconsistent MIME types (often application/octet-stream), so the extension
// list is the authority and the mime is only recorded, never trusted.
const ALLOWED_DESIGN_EXTENSIONS = ['.png', '.svg', '.ai', '.psd'];

// What we send back in Content-Type. An uploaded mime is never echoed to a
// browser, because the client controls it.
const SAFE_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ai': 'application/postscript',
  '.psd': 'image/vnd.adobe.photoshop',
};

export function designExtension(originalName: string): string {
  return extname(originalName || '').toLowerCase();
}

export function assertAllowedDesign(originalName: string): string {
  const ext = designExtension(originalName);

  if (!ALLOWED_DESIGN_EXTENSIONS.includes(ext)) {
    throw new BadRequestException(
      `Design files must be one of: ${ALLOWED_DESIGN_EXTENSIONS.join(', ')}`,
    );
  }

  return ext;
}

export function designContentType(storedPath: string): string {
  const ext = designExtension(storedPath);
  return SAFE_CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

// A stored path is always one we generated (uuid + allowlisted extension), but
// reads are still confined to the design directory so a bad row in the database
// can never turn into arbitrary filesystem access.
export function resolveDesignPath(storedPath: string): string {
  const absolute = resolve(WHOLESALE_DESIGN_DIR, storedPath);

  if (absolute !== WHOLESALE_DESIGN_DIR && !absolute.startsWith(WHOLESALE_DESIGN_DIR + sep)) {
    throw new BadRequestException('Design path is outside the allowed storage directory.');
  }

  return absolute;
}

// Domain-separated so a design link can never be replayed as any other HMAC
// consumer of the same secret.
const TOKEN_SCOPE = 'hekx-wholesale-design-v1';

function signature(secret: string, designId: number, expiresAt: number): string {
  return createHmac('sha256', secret)
    .update(`${TOKEN_SCOPE}|${designId}|${expiresAt}`)
    .digest('base64url');
}

export function signDesignAccess(
  secret: string,
  designId: number,
  ttlSeconds: number,
): { expiresAt: number; sig: string } {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  return { expiresAt, sig: signature(secret, designId, expiresAt) };
}

export function verifyDesignAccess(
  secret: string,
  designId: number,
  expiresAt: number,
  presented: string | undefined,
): boolean {
  if (!presented || !Number.isFinite(expiresAt)) return false;
  if (expiresAt < Math.floor(Date.now() / 1000)) return false;

  const expected = signature(secret, designId, expiresAt);

  if (expected.length !== presented.length) return false;

  return timingSafeEqual(Buffer.from(expected), Buffer.from(presented));
}

export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  if (bufA.length !== bufB.length) return false;

  return timingSafeEqual(bufA, bufB);
}
