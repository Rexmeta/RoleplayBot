// @vitest-environment happy-dom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { CultureProfileFilters } from "@/components/admin/cultureMap/CultureProfileFilters";

afterEach(cleanup);

describe("CultureProfileFilters", () => {
  it("shows available profile counts and keeps type selection connected", () => {
    const onProfileTypeChange = vi.fn();
    render(
      <CultureProfileFilters
        profileType="all"
        onProfileTypeChange={onProfileTypeChange}
        profileTypeCounts={{ all: 12, country: 5, company: 3, custom: 4 }}
        search=""
        onSearchChange={vi.fn()}
        region="all"
        onRegionChange={vi.fn()}
        regions={[]}
        confidence="all"
        onConfidenceChange={vi.fn()}
      />,
    );

    const typeFilter = screen.getByLabelText("프로필 유형");
    expect(within(typeFilter).getByRole("option", { name: "모든 유형 (12)" })).toBeTruthy();
    expect(within(typeFilter).getByRole("option", { name: "국가 기준 (5)" })).toBeTruthy();
    expect(within(typeFilter).getByRole("option", { name: "기업 추정 (3)" })).toBeTruthy();
    expect(within(typeFilter).getByRole("option", { name: "사용자 정의 (4)" })).toBeTruthy();

    fireEvent.change(typeFilter, { target: { value: "company" } });
    expect(onProfileTypeChange).toHaveBeenCalledWith("company");
  });
});
