import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { AdminApiService } from '../../../core/api/admin-api.service';
import { JobStatusDto } from '../../../core/api/admin.models';
import { MeService } from '../../../core/api/me.service';
import { NotificationService } from '../../../core/services/notification.service';
import { UiDialogService } from '../../../shared/ui';
import { provideI18nTesting } from '../../../../testing/i18n-testing';
import { AdminJobsPage } from './jobs.page';

function job(overrides: Partial<JobStatusDto> = {}): JobStatusDto {
  return {
    name: 'trash.purge',
    description: 'Delete drawings trashed more than 30 days ago.',
    suggestedCron: '17 3 * * *',
    destructive: true,
    lastRun: null,
    ...overrides,
  };
}

describe('AdminJobsPage', () => {
  let api: jasmine.SpyObj<AdminApiService>;
  let dialog: jasmine.SpyObj<UiDialogService>;

  beforeEach(() => {
    api = jasmine.createSpyObj<AdminApiService>('AdminApiService', ['jobs', 'runJob']);
    dialog = jasmine.createSpyObj<UiDialogService>('UiDialogService', ['confirm']);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideI18nTesting(),
        { provide: AdminApiService, useValue: api },
        { provide: UiDialogService, useValue: dialog },
        {
          provide: MeService,
          useValue: jasmine.createSpyObj<MeService>('MeService', ['load'], {
            me: signal({ user: { platformRole: 'owner' } }) as never,
          }),
        },
        {
          provide: NotificationService,
          useValue: jasmine.createSpyObj<NotificationService>('NotificationService', [
            'success',
            'error',
            'info',
            'warning',
          ]),
        },
      ],
    });
  });

  async function settle(done: () => boolean): Promise<void> {
    for (let i = 0; i < 200 && !done(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  it('confirms before running a job that deletes data', async () => {
    api.jobs.and.resolveTo([job({ destructive: true })]);
    dialog.confirm.and.resolveTo(false);
    const fixture = TestBed.createComponent(AdminJobsPage);
    fixture.detectChanges();
    const page = fixture.componentInstance as unknown as { jobs(): JobStatusDto[]; run(j: JobStatusDto): Promise<void> };
    await settle(() => page.jobs().length > 0);

    await page.run(job({ destructive: true }));

    expect(dialog.confirm).toHaveBeenCalled();
    // Declined, so nothing ran.
    expect(api.runJob).not.toHaveBeenCalled();
  });

  it('runs a harmless job without a confirmation', async () => {
    api.jobs.and.resolveTo([job({ name: 'alerts.check', destructive: false })]);
    api.runJob.and.resolveTo({
      id: 'r1',
      name: 'alerts.check',
      status: 'succeeded',
      summary: {},
      error: null,
      triggeredById: 'u1',
      startedAt: '',
      finishedAt: null,
    });
    const fixture = TestBed.createComponent(AdminJobsPage);
    fixture.detectChanges();
    const page = fixture.componentInstance as unknown as { jobs(): JobStatusDto[]; run(j: JobStatusDto): Promise<void> };
    await settle(() => page.jobs().length > 0);

    await page.run(job({ name: 'alerts.check', destructive: false }));

    expect(dialog.confirm).not.toHaveBeenCalled();
    expect(api.runJob).toHaveBeenCalledWith('alerts.check');
  });

  it('renders a summary object as readable text', () => {
    const fixture = TestBed.createComponent(AdminJobsPage);
    const page = fixture.componentInstance as unknown as { summarise(s: unknown): string };
    expect(page.summarise({ deleted: 3, bytesFreed: 400 })).toBe('deleted 3, bytesFreed 400');
    expect(page.summarise(null)).toBe('');
  });
});
