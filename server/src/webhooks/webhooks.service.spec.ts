import type { UserJSON, WebhookEvent } from '@clerk/backend';
import { mock, mockDeep, type DeepMockProxy, type MockProxy } from 'jest-mock-extended';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { WebhooksService } from './webhooks.service';

const USER_JSON = {
  object: 'user',
  id: 'user_123',
  primary_email_address_id: 'idn_2',
  email_addresses: [
    { id: 'idn_1', email_address: 'secondary@example.com' },
    { id: 'idn_2', email_address: 'primary@example.com' },
  ],
  first_name: 'Ada',
  last_name: 'Lovelace',
  image_url: 'https://img.clerk.com/ada.png',
} as unknown as UserJSON;

function event(type: string, data: unknown): WebhookEvent {
  return { type, data, object: 'event' } as unknown as WebhookEvent;
}

function uniqueViolation(modelName = 'WebhookEvent'): Error {
  return Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
    clientVersion: '7.10.0',
    meta: { modelName, target: ['id'] },
  });
}

describe('WebhooksService', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;
  let users: MockProxy<UsersService>;
  let service: WebhooksService;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();
    users = mock<UsersService>();
    // Interactive transaction: run the callback against the tx mock.
    (prisma.$transaction as unknown as jest.Mock).mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));
    service = new WebhooksService(prisma, users);
  });

  it('records the svix id and upserts the user on user.created', async () => {
    tx.webhookEvent.create.mockResolvedValue({ id: 'msg_1', type: 'user.created', receivedAt: new Date() });

    const ack = await service.handle(event('user.created', USER_JSON), 'msg_1');

    expect(ack).toEqual({ received: true });
    expect(tx.webhookEvent.create).toHaveBeenCalledWith({ data: { id: 'msg_1', type: 'user.created' } });
    expect(users.upsertFromClerk).toHaveBeenCalledWith(
      {
        clerkId: 'user_123',
        email: 'primary@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        imageUrl: 'https://img.clerk.com/ada.png',
      },
      tx,
    );
  });

  it('upserts on user.updated with the same mapping', async () => {
    tx.webhookEvent.create.mockResolvedValue({ id: 'msg_2', type: 'user.updated', receivedAt: new Date() });

    await service.handle(event('user.updated', { ...USER_JSON, first_name: 'Augusta' }), 'msg_2');

    expect(users.upsertFromClerk).toHaveBeenCalledWith(expect.objectContaining({ clerkId: 'user_123', firstName: 'Augusta' }), tx);
    expect(users.softDeleteByClerkId).not.toHaveBeenCalled();
  });

  it('falls back to the first email, then a placeholder, when no primary matches', async () => {
    tx.webhookEvent.create.mockResolvedValue({ id: 'msg_3', type: 'user.created', receivedAt: new Date() });
    await service.handle(event('user.created', { ...USER_JSON, primary_email_address_id: 'nope' }), 'msg_3');
    expect(users.upsertFromClerk).toHaveBeenCalledWith(expect.objectContaining({ email: 'secondary@example.com' }), tx);

    users.upsertFromClerk.mockClear();
    await service.handle(event('user.created', { ...USER_JSON, email_addresses: [] }), 'msg_3b');
    expect(users.upsertFromClerk).toHaveBeenCalledWith(expect.objectContaining({ email: 'user_123@local.invalid' }), tx);
  });

  it('soft-deletes on user.deleted', async () => {
    tx.webhookEvent.create.mockResolvedValue({ id: 'msg_4', type: 'user.deleted', receivedAt: new Date() });

    const ack = await service.handle(event('user.deleted', { object: 'user', id: 'user_123', deleted: true }), 'msg_4');

    expect(ack).toEqual({ received: true });
    expect(users.softDeleteByClerkId).toHaveBeenCalledWith('user_123', tx);
    expect(users.upsertFromClerk).not.toHaveBeenCalled();
  });

  it('is idempotent: a duplicate svix id answers { duplicate: true } and applies nothing', async () => {
    tx.webhookEvent.create.mockRejectedValue(uniqueViolation());

    const ack = await service.handle(event('user.created', USER_JSON), 'msg_1');

    expect(ack).toEqual({ received: true, duplicate: true });
    expect(users.upsertFromClerk).not.toHaveBeenCalled();
  });

  it('re-throws unique violations that are not the webhook ledger', async () => {
    tx.webhookEvent.create.mockResolvedValue({ id: 'msg_5', type: 'user.created', receivedAt: new Date() });
    users.upsertFromClerk.mockRejectedValue(uniqueViolation('User'));

    await expect(service.handle(event('user.created', USER_JSON), 'msg_5')).rejects.toMatchObject({ code: 'P2002' });
  });

  it('re-throws other failures so Svix retries (id not recorded thanks to rollback)', async () => {
    tx.webhookEvent.create.mockResolvedValue({ id: 'msg_6', type: 'user.deleted', receivedAt: new Date() });
    users.softDeleteByClerkId.mockRejectedValue(new Error('db down'));

    await expect(service.handle(event('user.deleted', { object: 'user', id: 'user_123', deleted: true }), 'msg_6')).rejects.toThrow('db down');
  });

  it('records but ignores unknown event types', async () => {
    tx.webhookEvent.create.mockResolvedValue({ id: 'msg_7', type: 'session.created', receivedAt: new Date() });

    const ack = await service.handle(event('session.created', { id: 'sess_1' }), 'msg_7');

    expect(ack).toEqual({ received: true });
    expect(tx.webhookEvent.create).toHaveBeenCalledTimes(1);
    expect(users.upsertFromClerk).not.toHaveBeenCalled();
    expect(users.softDeleteByClerkId).not.toHaveBeenCalled();
  });
});
