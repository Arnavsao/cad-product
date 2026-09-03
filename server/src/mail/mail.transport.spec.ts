import { Logger } from '@nestjs/common';
import { LogMailTransport, ResendMailTransport } from './mail.transport';
import type { OutboundEmail } from './mail.types';

/**
 * Unit spec for the two transports.
 *
 * `fetch` is mocked rather than intercepted at the socket: the thing under test
 * is the request SHAPE Resend requires (bearer header, `to` as an array, the
 * snake_case `reply_to`) and what happens to a non-2xx answer — none of which
 * needs a real connection.
 */

const FROM = 'CADOnline <no-reply@cadonline.app>';

function email(overrides: Partial<OutboundEmail> = {}): OutboundEmail {
  return {
    to: 'bob@example.com',
    subject: 'Alice shared "Site Plan" with you',
    html: '<p>hello</p>',
    text: 'hello',
    category: 'share',
    ...overrides,
  };
}

describe('ResendMailTransport', () => {
  let fetchMock: jest.Mock;
  const original = global.fetch;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = original;
  });

  it('posts to Resend with a bearer token and a JSON content type', async () => {
    await new ResendMailTransport('re_test_key').send(email(), FROM);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer re_test_key');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('sends the body shape the API expects', async () => {
    await new ResendMailTransport('re_test_key').send(email(), FROM);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      from: FROM,
      // An array even for one recipient — the API takes a list.
      to: ['bob@example.com'],
      subject: 'Alice shared "Site Plan" with you',
      html: '<p>hello</p>',
      text: 'hello',
    });
  });

  it('sends reply_to (snake_case) only when there is one', async () => {
    const transport = new ResendMailTransport('re_test_key');
    await transport.send(email({ replyTo: 'support@cadonline.app' }), FROM);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reply_to).toBe('support@cadonline.app');

    await transport.send(email(), FROM);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty('reply_to');
  });

  it('surfaces a 422 body in the thrown error, so the log is diagnosable', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => '{"message":"The cadonline.app domain is not verified"}',
    });

    await expect(new ResendMailTransport('re_test_key').send(email(), FROM)).rejects.toThrow(
      /422.*domain is not verified/,
    );
  });

  it('truncates a huge error body rather than spilling it into logs', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'x'.repeat(5000) });
    const error = await new ResendMailTransport('k')
      .send(email(), FROM)
      .then(() => null)
      .catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error!.message.length).toBeLessThan(600);
  });

  it('still reports a failure when the error body cannot be read', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => {
        throw new Error('stream closed');
      },
    });
    await expect(new ResendMailTransport('k').send(email(), FROM)).rejects.toThrow(/502/);
  });

  it('gives the request an abort signal, so a hung provider cannot pin a request', async () => {
    await new ResendMailTransport('k').send(email(), FROM);
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('propagates an aborted fetch as a rejection', async () => {
    // What `AbortSignal.timeout` produces once the deadline passes.
    fetchMock.mockRejectedValue(Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }));
    await expect(new ResendMailTransport('k').send(email(), FROM)).rejects.toThrow(/aborted/);
  });
});

describe('LogMailTransport', () => {
  it('logs the recipient, subject and TEXT body, and never rejects', async () => {
    const logger = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await expect(new LogMailTransport().send(email(), FROM)).resolves.toBeUndefined();

    const printed = String(logger.mock.calls[0][0]);
    expect(printed).toContain('bob@example.com');
    expect(printed).toContain('Alice shared "Site Plan" with you');
    expect(printed).toContain('hello');
    expect(printed).toContain(FROM);
    // Says why nothing was sent, so a developer is not left wondering.
    expect(printed).toContain('not sent');
    logger.mockRestore();
  });

  it('names itself so the send log says which transport ran', () => {
    expect(new LogMailTransport().name).toBe('log');
    expect(new ResendMailTransport('k').name).toBe('resend');
  });
});
