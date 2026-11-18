/** Real admin page with isolated read-only data; never imported by the application. */
import React from "react";
import { createRoot } from "react-dom/client";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import korean from "../../client/src/locales/ko.json";
import SystemAdmin from "../../client/src/pages/system-admin";

i18n.use(initReactI18next).init({
  lng: "ko", fallbackLng: "ko", resources: { ko: { translation: korean } },
  interpolation: { escapeValue: false },
});
createRoot(document.getElementById("root")!).render(<SystemAdmin />);
const params = new URLSearchParams(location.search);
let attempts = 0;
function openReview() {
  if (++attempts > 240) return;
  if (params.get("edit") === "user") {
    const editor = document.querySelector('[data-testid="dialog-edit-user"]');
    if (editor) {
      editor.querySelectorAll<HTMLButtonElement>(".scenario-editor-nav button")[Number(params.get("section") || 0)]?.click();
      return;
    }
    const edit = document.querySelector<HTMLElement>('[role="menuitem"]');
    if (edit) edit.click();
    else document.querySelector('[data-testid="button-edit-operator-review"]')
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  } else {
    const target = document.querySelector<HTMLButtonElement>(`[data-testid="tab-${params.get("tab") || "users"}"]`);
    if (target) { target.click(); return; }
  }
  requestAnimationFrame(openReview);
}
requestAnimationFrame(openReview);
