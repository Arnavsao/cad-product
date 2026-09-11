import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { BillingService } from '../billing/billing.service';
import type { UserPreferences } from '../generated/prisma/client';
import { Units } from '../generated/prisma/client';
import type { NotificationsService } from '../notifications/notifications.service';
import type { OrganizationsService } from '../organizations/organizations.service';
import type { PrismaService } from '../prisma/prisma.service';
import { LOCALES, type UpdatePreferencesDto } from './dto/preferences.dto';
import { UsersService } from './users.service';

/**
 * Every field `UpdatePreferencesDto` accepts must reach the database.
 *
 * The DTO validates `locale` against the shipped languages, and
 * `locale-registry.spec.ts` proves it accepts all fourteen — but until this
 * spec existed nothing checked that an accepted value was *written*. It was
 * not: the patch mapper listed every field except `locale`, so the language a
 * person picked was validated, dropped, and echoed back as the stored `en`.
 * In the app that read as "I select German and it snaps back to English",
 * because the echo (and every later `/me`) carried the old value.
 *
 * Driving the check off the DTO's own keys means the next field added to it
 * cannot be forgotten the same way.
 */

const USER = 'cuser00000000000000000001';

function row(overrides: Partial<UserPreferences> = {}): UserPreferences {
  return {
    userId: USER,
    units: Units.MM,
    theme: 'monokai',
    locale: 'en',
    role: null,
    defaultTemplate: 'blank',
    autosaveIntervalSec: 30,
    uiState: null,
    emailOnShare: true,
    emailOnOrgActivity: true,
    updatedAt: new Date('2026-09-01T10:00:00.000Z'),
    ...overrides,
  } as UserPreferences;
}

describe('UsersService.updatePreferences', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let service: UsersService;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    service = new UsersService(
      prisma,
      mockDeep<NotificationsService>(),
      mockDeep<OrganizationsService>(),
      mockDeep<BillingService>(),
    );
  });

  it('writes the locale the user picked', async () => {
    prisma.userPreferences.upsert.mockResolvedValue(row({ locale: 'de' }));

    const result = await service.updatePreferences(USER, { locale: 'de' });

    const args = prisma.userPreferences.upsert.mock.calls[0][0];
    expect(args.update).toEqual({ locale: 'de' });
    expect(args.create).toEqual({ userId: USER, locale: 'de' });
    expect(result.locale).toBe('de');
  });

  it('writes every shipped locale, not just the common ones', async () => {
    for (const locale of LOCALES) {
      prisma.userPreferences.upsert.mockResolvedValue(row({ locale }));
      await service.updatePreferences(USER, { locale });
      const last = prisma.userPreferences.upsert.mock.calls.at(-1)![0];
      expect({ locale, written: last.update }).toEqual({ locale, written: { locale } });
    }
  });

  it('forwards every scalar field the DTO accepts', async () => {
    // One representative value per DTO field. If a field is added to the DTO
    // and not here, the object-key comparison below fails and names it.
    const dto: Required<Omit<UpdatePreferencesDto, 'uiState' | 'role' | 'units'>> = {
      theme: 'solarized',
      locale: 'ja',
      defaultTemplate: 'a3-landscape',
      autosaveIntervalSec: 60,
      emailOnShare: false,
      emailOnOrgActivity: false,
    };
    prisma.userPreferences.upsert.mockResolvedValue(row());

    await service.updatePreferences(USER, dto);

    const written = prisma.userPreferences.upsert.mock.calls[0][0].update as Record<string, unknown>;
    expect(Object.keys(written).sort()).toEqual(Object.keys(dto).sort());
    expect(written).toEqual(dto);
  });

  it('leaves the locale alone when the patch does not mention it', async () => {
    prisma.userPreferences.upsert.mockResolvedValue(row());

    await service.updatePreferences(USER, { theme: 'solarized' });

    expect(prisma.userPreferences.upsert.mock.calls[0][0].update).toEqual({ theme: 'solarized' });
  });
});
