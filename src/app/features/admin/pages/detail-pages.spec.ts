import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AdminApiService } from '../../../core/api/admin-api.service';
import { MeService } from '../../../core/api/me.service';
import { NotificationService } from '../../../core/services/notification.service';
import { provideI18nTesting } from '../../../../testing/i18n-testing';
import { AdminFeedbackDetailPage } from './feedback-detail.page';
import { AdminUserDetailPage } from './user-detail.page';

/**
 * Both detail pages take their id as a REQUIRED route input.
 *
 * These tests exist because reading such an input from the constructor throws
 * NG0950 — the router binds it after construction — and the failure is invisible
 * to a typecheck and to any spec that sets the input directly. Driving the real
 * router is the only way to reproduce what a user hitting the URL gets.
 */
describe('admin detail pages (required route input)', () => {
  let api: jasmine.SpyObj<AdminApiService>;

  beforeEach(() => {
    api = jasmine.createSpyObj<AdminApiService>('AdminApiService', ['getUser', 'getFeedback']);
    api.getUser.and.resolveTo({ id: 'u1', email: 'a@b.c', organizations: [] } as never);
    api.getFeedback.and.resolveTo({ id: 'f1', status: 'new', kind: 'bug', context: null } as never);

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter(
          [
            { path: 'admin/users/:id', component: AdminUserDetailPage },
            { path: 'admin/feedback/:id', component: AdminFeedbackDetailPage },
          ],
          withComponentInputBinding(),
        ),
        provideI18nTesting(),
        { provide: AdminApiService, useValue: api },
        {
          provide: MeService,
          useValue: jasmine.createSpyObj<MeService>('MeService', ['load'], { me: signal(null) }),
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

  it('loads the account named in the URL', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin/users/cuser000000000000000000001', AdminUserDetailPage);
    expect(api.getUser).toHaveBeenCalledWith('cuser000000000000000000001');
  });

  it('loads the report named in the URL', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin/feedback/cfb0000000000000000000001', AdminFeedbackDetailPage);
    expect(api.getFeedback).toHaveBeenCalledWith('cfb0000000000000000000001');
  });
});
