// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
afterEach(cleanup);
import { render, screen, fireEvent } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { PersonaPortrait, getInitials } from "@/components/PersonaPortrait";

describe("PersonaPortrait", () => {
  it("renders lazy async image with portrait aspect and face-safe focal", () => {
    render(<PersonaPortrait src="/a.webp" name="Kim Minji" />);
    const img = screen.getByAltText("Kim Minji") as HTMLImageElement;
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("decoding")).toBe("async");
    expect(img.style.objectPosition).toBe("50% 18%");
    expect(screen.getByTestId("persona-portrait").getAttribute("data-aspect")).toBe("4 / 5");
  });
  it("falls back to initials on error", () => {
    render(<PersonaPortrait src="/bad.webp" name="Kim Minji" />);
    fireEvent.error(screen.getByAltText("Kim Minji"));
    expect(screen.getByTestId("persona-portrait-fallback").textContent).toBe("KM");
  });
  it("falls back without src", () => {
    render(<PersonaPortrait src={null} name="Lee" />);
    expect(screen.getByRole("img", { name: "Lee" })).toBeTruthy();
    expect(getInitials("")).toBe("?");
  });
  it("source no longer uses fixed image heights", () => {
    const root = path.resolve(__dirname, "../../client/src/components");
    const a = fs.readFileSync(path.join(root, "SimplePersonaSelector.tsx"), "utf8");
    const b = fs.readFileSync(path.join(root, "ScenarioSelector.tsx"), "utf8");
    expect(a).not.toMatch(/h-\[270px\]|sm:h-40|unsplash/);
    expect(a).toContain("PersonaPortrait");
    expect(b).not.toMatch(/relative h-44/);
  });
});
