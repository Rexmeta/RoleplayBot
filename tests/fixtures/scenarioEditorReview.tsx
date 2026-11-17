/**
 * Isolated visual-review fixture. This is not imported by the application,
 * has no backend access and never changes the application's authentication.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import korean from '../../client/src/locales/ko.json';
import { ScenarioManager } from '../../client/src/components/admin/ScenarioManager';
import { EDITOR_SECTIONS } from '../../client/src/components/admin/scenarioEditor/ScenarioEditor';

i18n.use(initReactI18next).init({
  lng: 'ko', fallbackLng: 'ko', resources: { ko: { translation: korean } },
  interpolation: { escapeValue: false },
});

createRoot(document.getElementById('root')!).render(<ScenarioManager />);

const selected = EDITOR_SECTIONS.find(section => section.id === new URLSearchParams(location.search).get('section')) ?? EDITOR_SECTIONS[0];
let attempt = 0;
function openReview() {
  if (++attempt > 240) return;
  const editor = document.querySelector('.scenario-editor');
  if (editor) {
    const button = Array.from(editor.querySelectorAll<HTMLButtonElement>('.scenario-editor-nav button'))
      .find(button => button.textContent?.trim() === selected.label);
    button?.click();
    document.documentElement.dataset.reviewReady = selected.id;
    return;
  }
  const edit = document.querySelector<HTMLElement>('[data-testid="button-edit-scenario-scenario-review"]');
  if (edit) edit.click();
  else document.querySelector('[data-testid="button-scenario-menu-scenario-review"]')
    ?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
  requestAnimationFrame(openReview);
}
requestAnimationFrame(openReview);
