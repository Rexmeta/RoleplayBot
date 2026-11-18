/** Actual production components with read-only fixtures, never imported by the app. */
import React from "react";
import { createRoot } from "react-dom/client";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import korean from "../../client/src/locales/ko.json";
import { EvaluationCriteriaManager } from "../../client/src/components/admin/EvaluationCriteriaManager";
import { CultureProfilesManager } from "../../client/src/components/admin/cultureMap/CultureProfilesManager";

i18n.use(initReactI18next).init({
  lng: "ko", fallbackLng: "ko", resources: { ko: { translation: korean } },
  interpolation: { escapeValue: false },
});
const params = new URLSearchParams(location.search);
const culture = params.get("kind") === "culture";
const dimension = params.get("kind") === "dimension";
const editing = params.get("mode") === "edit" || dimension;
createRoot(document.getElementById("root")!).render(culture ? <CultureProfilesManager /> : <EvaluationCriteriaManager />);
let attempts = 0;
function openReview() {
  if (++attempts > 240) return;
  const editor = document.querySelector(".scenario-editor");
  if (editor) {
    editor.querySelectorAll<HTMLButtonElement>(".scenario-editor-nav button")[Number(params.get("section") || 0)]?.click();
    return;
  }
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
  if (editing) {
    const action = culture
      ? buttons.find(button => button.getAttribute("aria-label")?.includes("프로필 미리보기 및 편집"))
      : buttons.find(button => button.textContent?.trim() === String(i18n.t(dimension ? "admin.evaluationCriteria.addDimension" : "admin.evaluationCriteria.edit")));
    if (action) action.click();
    else buttons.find(button => button.textContent?.includes("협업 대화 평가"))?.click();
    requestAnimationFrame(openReview);
    return;
  }
  const create = buttons.find(button => culture ? button.textContent?.includes("새 프로필 만들기") :
    button.textContent?.includes(String(i18n.t("admin.evaluationCriteria.newCriteriaSet"))));
  create?.click();
  requestAnimationFrame(openReview);
}
requestAnimationFrame(openReview);
