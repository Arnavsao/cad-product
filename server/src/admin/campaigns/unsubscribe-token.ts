import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed, self-contained unsubscribe tokens.
 *
 * The link in a campaign has to work with one click, from an email client, for
 * somebody who is not signed in — so it cannot require a session. That leaves
 * the address in the URL, and an unsigned address in a URL is an invitation to
 * unsubscribe other people by editing it.
 *
 * The signature is HMAC over the address with a secret the deployment already
 * has. No expiry: an unsubscribe link in a year-old email must still work, and
 * the only thing it can do is stop mail the recipient did not want anyway.
 */
export function signUnsubscribeToken(email: string, secret: string): string {
  const normalised = email.trim().toLowerCase();
  const payload = Buffer.from(normalised, 'utf8').toString('base64url');
  return `${payload}.${digest(normalised, secret)}`;
}

/** The address a token vouches for, or null when it does not verify. */
export function verifyUnsubscribeToken(token: string, secret: string): string | null {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) {
    return null;
  }

  let email: string;
  try {
    email = Buffer.from(payload, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!email.includes('@')) {
    return null;
  }

  const expected = digest(email, secret);
  // Constant time: a fast comparison here leaks how much of a forged signature
  // was right, one byte at a time.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }
  return email;
}

function digest(email: string, secret: string): string {
  return createHmac('sha256', secret).update(email).digest('base64url');
}
