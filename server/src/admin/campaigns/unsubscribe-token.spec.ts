import { signUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribe-token';

const SECRET = 'a-test-secret-at-least-32-characters-long';

describe('unsubscribe tokens', () => {
  it('round-trips an address', () => {
    const token = signUnsubscribeToken('Reader@Example.com', SECRET);
    expect(verifyUnsubscribeToken(token, SECRET)).toBe('reader@example.com');
  });

  it('normalises case and whitespace before signing', () => {
    // Otherwise the same person would have two valid tokens and one
    // suppression row would not match the other.
    expect(signUnsubscribeToken('  Reader@Example.com ', SECRET)).toBe(
      signUnsubscribeToken('reader@example.com', SECRET),
    );
  });

  it('refuses a token signed with a different secret', () => {
    const token = signUnsubscribeToken('reader@example.com', 'some-other-secret-value-32-chars-ok');
    expect(verifyUnsubscribeToken(token, SECRET)).toBeNull();
  });

  it('refuses an address swapped into a valid token', () => {
    // The attack this exists to stop: editing the URL to unsubscribe somebody
    // else.
    const token = signUnsubscribeToken('reader@example.com', SECRET);
    const [, signature] = token.split('.');
    const forged = `${Buffer.from('victim@example.com').toString('base64url')}.${signature}`;
    expect(verifyUnsubscribeToken(forged, SECRET)).toBeNull();
  });

  it('refuses malformed input without throwing', () => {
    for (const bad of ['', 'nodot', '.', 'a.b', '!!!.???', 'x'.repeat(400)]) {
      expect(verifyUnsubscribeToken(bad, SECRET)).toBeNull();
    }
  });

  it('refuses a payload that is not an address', () => {
    const payload = Buffer.from('not-an-address').toString('base64url');
    expect(verifyUnsubscribeToken(`${payload}.whatever`, SECRET)).toBeNull();
  });
});
