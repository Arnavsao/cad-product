import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DEFAULT_PREFERENCES, MeService } from '../../../core/api/me.service';
import { SupabaseAuthService } from '../../../core/auth/supabase-auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { MAX_IMAGE_BYTES } from '../../../core/utils/image-resize';
import { UiDialogService } from '../../../shared/ui/dialog/ui-dialog.service';
import { provideI18nTesting } from '../../../../testing/i18n-testing';
import { ProfilePage } from './profile.page';

/** A real 8x8 PNG, so `resizeToSquare` can actually decode it. */
async function pngFile(name = 'me.png'): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 8;
  canvas.getContext('2d')!.fillRect(0, 0, 8, 8);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  return new File([blob!], name, { type: 'image/png' });
}

describe('ProfilePage', () => {
  let auth: jasmine.SpyObj<SupabaseAuthService> & {
    enabled: ReturnType<typeof signal>;
    isLoaded: ReturnType<typeof signal>;
    isSignedIn: ReturnType<typeof signal>;
    identities: ReturnType<typeof signal>;
    userAvatarUrl: ReturnType<typeof signal>;
  };
  let me: jasmine.SpyObj<MeService> & { me: ReturnType<typeof signal>; preferences: ReturnType<typeof signal> };
  let dialog: jasmine.SpyObj<UiDialogService>;
  let notify: jasmine.SpyObj<NotificationService>;
  let fixture: ComponentFixture<ProfilePage>;
  let page: ProfilePage & {
    uploadingPhoto(): boolean;
    photoError(): string | null;
    canEditPhoto(): boolean;
    canRemovePhoto(): boolean;
    photoHint(): string;
    avatarUrl(): string | null;
    onPhotoDropped(files: File[]): void;
    onPhotoPicked(event: Event): void;
    removePhoto(): Promise<void>;
  };

  /**
   * Waits for the floating promise `onPhotoPicked`/`onPhotoDropped` kicks off.
   *
   * Polls rather than awaiting a fixed number of microtasks: the upload path
   * goes through `createImageBitmap` and `canvas.toBlob`, which are real async
   * browser work and settle on a task, not a microtask.
   */
  const settle = async (predicate?: () => boolean) => {
    // Default: the upload started AND finished. Waiting only on
    // `!uploadingPhoto()` would pass before the flag was ever raised.
    const done = predicate ?? (() => auth.uploadAvatar.calls.any() && !page.uploadingPhoto());
    for (let i = 0; i < 200 && !done(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  beforeEach(() => {
    auth = jasmine.createSpyObj<SupabaseAuthService>(
      'SupabaseAuthService',
      ['uploadAvatar', 'removeAvatar', 'updateName'],
      {
        enabled: signal(true),
        isLoaded: signal(true),
        isSignedIn: signal(true),
        identities: signal<string[]>([]),
        userAvatarUrl: signal<string | null>(null),
        userEmail: signal('drafter@example.com'),
        userFirstName: signal('Ada'),
        userLastName: signal('Lovelace'),
      },
    ) as typeof auth;
    auth.uploadAvatar.and.resolveTo('https://cdn.example.com/avatars/u1/1.webp');
    auth.removeAvatar.and.resolveTo();

    me = jasmine.createSpyObj<MeService>('MeService', ['load', 'refresh', 'updatePreferences'], {
      me: signal(null),
      preferences: signal({ ...DEFAULT_PREFERENCES, role: null }),
    }) as typeof me;
    me.load.and.resolveTo(null as never);
    me.refresh.and.resolveTo(null as never);

    dialog = jasmine.createSpyObj<UiDialogService>('UiDialogService', ['confirm']);
    dialog.confirm.and.resolveTo(true);
    notify = jasmine.createSpyObj<NotificationService>('NotificationService', ['success', 'error']);

    TestBed.configureTestingModule({
      imports: [ProfilePage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideI18nTesting(),
        { provide: SupabaseAuthService, useValue: auth },
        { provide: MeService, useValue: me },
        { provide: UiDialogService, useValue: dialog },
        { provide: NotificationService, useValue: notify },
      ],
    });
    fixture = TestBed.createComponent(ProfilePage);
    page = fixture.componentInstance as unknown as typeof page;
    fixture.detectChanges();
  });

  // ── upload ─────────────────────────────────────────────────────────────────

  it('uploads a dropped image and re-reads /me so the mirror cannot revert it', async () => {
    page.onPhotoDropped([await pngFile()]);
    await settle();

    expect(auth.uploadAvatar).toHaveBeenCalledTimes(1);
    expect(me.refresh).toHaveBeenCalled();
    expect(notify.success).toHaveBeenCalled();
    expect(page.photoError()).toBeNull();
    expect(page.uploadingPhoto()).toBeFalse();
  });

  it('hands the resized blob, not the original file, to the uploader', async () => {
    page.onPhotoDropped([await pngFile()]);
    await settle();

    const [blob, contentType] = auth.uploadAvatar.calls.mostRecent().args;
    expect(blob instanceof Blob).toBeTrue();
    expect(blob instanceof File).toBeFalse();
    expect(contentType).toMatch(/^image\/(webp|png)$/);
  });

  it('reads the file out of a picker change event', async () => {
    const input = document.createElement('input');
    // Must be set before `files`: a non-file input has a null `files`.
    input.type = 'file';
    const file = await pngFile();
    // A DataTransfer is the only way to populate `input.files` in a browser.
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;

    page.onPhotoPicked({ target: input } as unknown as Event);
    await settle(() => auth.uploadAvatar.calls.any());

    expect(auth.uploadAvatar).toHaveBeenCalled();
    // Reset, or picking the same file twice would not fire `change` again.
    expect(input.value).toBe('');
  });

  it('surfaces an upload failure inline instead of a toast', async () => {
    auth.uploadAvatar.and.rejectWith(new Error('Bucket not found'));

    page.onPhotoDropped([await pngFile()]);
    await settle();

    expect(page.photoError()).toBe('Bucket not found');
    expect(page.uploadingPhoto()).toBeFalse();
    expect(notify.success).not.toHaveBeenCalled();
  });

  // ── rejections ─────────────────────────────────────────────────────────────

  it('rejects a non-image drop without calling the uploader', async () => {
    page.onPhotoDropped([new File(['nope'], 'notes.txt', { type: 'text/plain' })]);
    await settle(() => !!page.photoError());

    expect(auth.uploadAvatar).not.toHaveBeenCalled();
    expect(page.photoError()).toMatch(/not an image/i);
  });

  it('rejects an oversized image without calling the uploader', async () => {
    const huge = new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], 'big.png', { type: 'image/png' });

    page.onPhotoDropped([huge]);
    await settle(() => !!page.photoError());

    expect(auth.uploadAvatar).not.toHaveBeenCalled();
    expect(page.photoError()).toMatch(/larger than/i);
  });

  it('ignores an empty drop', async () => {
    page.onPhotoDropped([]);
    // Nothing to wait for; a few turns are enough to catch a stray call.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(auth.uploadAvatar).not.toHaveBeenCalled();
    expect(page.photoError()).toBeNull();
  });

  // ── removal ────────────────────────────────────────────────────────────────

  it('confirms before removing, then clears and refreshes', async () => {
    await page.removePhoto();

    expect(dialog.confirm).toHaveBeenCalled();
    expect(auth.removeAvatar).toHaveBeenCalledTimes(1);
    expect(me.refresh).toHaveBeenCalled();
  });

  it('does nothing when the confirm is cancelled', async () => {
    dialog.confirm.and.resolveTo(false);

    await page.removePhoto();

    expect(auth.removeAvatar).not.toHaveBeenCalled();
    expect(me.refresh).not.toHaveBeenCalled();
  });

  it('surfaces a removal failure inline', async () => {
    auth.removeAvatar.and.rejectWith(new Error('Network down'));

    await page.removePhoto();

    expect(page.photoError()).toBe('Network down');
    expect(page.uploadingPhoto()).toBeFalse();
  });

  // ── affordances ────────────────────────────────────────────────────────────

  it('offers removal only once there is a picture', () => {
    expect(page.canRemovePhoto()).toBeFalse();
    auth.userAvatarUrl.set('https://cdn.example.com/a.png');
    expect(page.canRemovePhoto()).toBeTrue();
  });

  it('hides the photo controls in embedded mode', () => {
    auth.enabled.set(false);
    expect(page.canEditPhoto()).toBeFalse();
  });

  it('warns an OAuth user that removal reverts to their provider photo', () => {
    auth.userAvatarUrl.set('https://cdn.example.com/a.png');
    auth.identities.set(['google']);
    expect(page.photoHint()).toMatch(/sign-in provider/i);
  });

  it('does not mention a provider for a password-only account', () => {
    auth.userAvatarUrl.set('https://cdn.example.com/a.png');
    auth.identities.set([]);
    expect(page.photoHint()).not.toMatch(/sign-in provider/i);
  });
});
