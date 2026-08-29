import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'editor', pathMatch: 'full' },
  {
    path: 'editor',
    title: 'CADOnline',
    loadComponent: () => import('./features/cad-editor/cad-editor').then(m => m.CadEditorComponent),
  },
  // Legacy path used by the bridge application.
  { path: 'cad-editor', redirectTo: 'editor' },
  { path: '**', redirectTo: 'editor' },
];
