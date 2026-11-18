/**
 * Render the actual persona editor with isolated read-only sample data.
 * Never imported by the application or served through its protected routes.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import korean from '../../client/src/locales/ko.json';
import { PersonaManager } from '../../client/src/components/admin/PersonaManager';

i18n.use(initReactI18next).init({
  lng: 'ko', fallbackLng: 'ko', resources: { ko: { translation: korean } },
  interpolation: { escapeValue: false },
});
createRoot(document.getElementById('root')!).render(<PersonaManager />);
let attempt = 0;
function openReview() {
  if (++attempt > 240) return;
  const editor = document.querySelector('.scenario-editor');
  if (editor) {
    const section = Number(new URLSearchParams(location.search).get('section') || 0);
    editor.querySelectorAll<HTMLButtonElement>('.scenario-editor-nav button')[section]?.click();
    document.documentElement.dataset.reviewReady = 'persona';
    return;
  }
  const edit = document.querySelector<HTMLElement>('[data-testid="button-edit-persona-persona-review"]');
  if (edit) edit.click();
  else document.querySelector('[data-testid="button-persona-menu-persona-review"]')
    ?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
  requestAnimationFrame(openReview);
}
requestAnimationFrame(openReview);
