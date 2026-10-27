// @vitest-environment happy-dom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CultureProfileCard } from "@/components/admin/cultureMap/CultureProfileCard";
import { SYSTEM_CULTURE_OWNER_ID, newCultureValues } from "@shared/cultureMap";
import type { CultureProfile } from "@shared/cultureMap";

const companyProfile: CultureProfile = {
  id: "1bd3fe26-2a98-5fa3-9523-9d5a20ec8880",
  ownerId: SYSTEM_CULTURE_OWNER_ID,
  version: 1,
  createdAt: "",
  updatedAt: "",
  name: "Meta",
  country: "기업",
  region: "글로벌 기술",
  description: "기업 공개 자료 기반 추정",
  dimensions: newCultureValues(),
  sources: [{
    title: "Work Culture at Meta",
    url: "https://www.metacareers.com/culture",
    locator: "Our core values",
    note: "공식 회사 소개",
  }],
  visibility: "shared",
  assessment: {
    kind: "organization_editorial_estimate",
    confidence: "low",
    notice: "공개 자료 기반 자체 추정입니다.",
    sourceReviewedAt: "2026-10-27",
    revision: "2026.2",
  },
};

afterEach(cleanup);

describe("organization culture profile card", () => {
  it("shows the company estimate warning without requiring country-dataset provenance", () => {
    render(
      <CultureProfileCard
        profile={companyProfile}
        selected={false}
        comparisonIndex={0}
        comparisonLimitReached={false}
        isOwner={false}
        isAdmin
        isEditing={false}
        duplicatePending={false}
        onToggleComparison={vi.fn()}
        onInspect={vi.fn()}
        onDuplicate={vi.fn()}
        onHistory={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText("시스템 기업 프로필 · 공개자료 기반 자체 추정 · 검토 필요 · 신뢰도 낮음")).toBeTruthy();
    expect(screen.getByText("출처 검토일: 2026-10-27 · 추정 개정: 2026.2")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Work Culture at Meta" }).getAttribute("href")).toBe("https://www.metacareers.com/culture");
    expect(screen.getByText("기업 · 글로벌 기술")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Meta 프로필 미리보기 및 편집" })).toBeTruthy();
  });
});
