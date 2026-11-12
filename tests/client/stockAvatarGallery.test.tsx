import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import assert from "node:assert/strict";
import { StockAvatarGallery } from "../../client/src/components/admin/StockAvatarGallery";
import { personaStockAvatarSchema, isSelectableStockAvatar, personaLiveAvatarSchema } from "../../shared/avatar/personaAvatar";
const entry = (id: string, extra: object = {}) => personaStockAvatarSchema.parse({
  id, name: id, providerId: "tavus", kind: "configured", configured: true, description: "fixture",
  languages: [], stock: true, thumbnailUrl: "https://cdn.replica.tavus.io/face.jpg", model: "phoenix-4.5", ...extra,
});
test("schema preserves image/model metadata and accepts server-confirmed stock beyond Lucy", () => {
  const a = entry("tavus-stock-rLucas");
  assert.equal(isSelectableStockAvatar(a), true);
  assert.equal(a.thumbnailUrl, "https://cdn.replica.tavus.io/face.jpg");
  assert.equal(isSelectableStockAvatar(entry(a.id, { stock: false })), false);
  assert.equal(isSelectableStockAvatar(entry(a.id, { configured: false })), false);
  const draft = personaLiveAvatarSchema.parse({ kind: "stock", avatarId: a.id, providerId: "tavus", voiceMode: "roleplayx", activation: "draft", validationStatus: "unverified" });
  assert.equal(draft.avatarId, a.id);
});
test("gallery renders multiple preview images, accessible selected state and model labels without selection side effects", () => {
  let selected = 0;
  const html = renderToStaticMarkup(<StockAvatarGallery avatars={[entry("tavus-stock-rLucas"), entry("tavus-stock-rAnna")]}
    selectedId="tavus-stock-rLucas" selectedProviderId="tavus" onSelect={() => selected++} displayName={n => n}/>);
  assert.equal(selected, 0);
  assert.ok(html.includes('role="radiogroup"')); assert.ok(html.includes('aria-checked="true"'));
  assert.equal((html.match(/loading="lazy"/g) ?? []).length, 2);
  assert.ok(html.includes("phoenix-4.5")); assert.ok(!html.includes("<video"));
  assert.ok(html.includes('referrerPolicy="no-referrer"') || html.includes('referrerpolicy="no-referrer"'));
});
test("saved but missing stock never silently selects another avatar", () => {
  const html = renderToStaticMarkup(<StockAvatarGallery avatars={[entry("tavus-stock-rLucas")]}
    selectedId="tavus-stock-rMissing" selectedProviderId="tavus" onSelect={() => assert.fail()} displayName={n => n}/>);
  assert.ok(!html.includes('aria-checked="true"'));
});
