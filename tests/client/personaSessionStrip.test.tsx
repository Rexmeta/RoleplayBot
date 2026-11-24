// @vitest-environment happy-dom
import React from "react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PersonaSessionStrip } from "../../client/src/components/chat/PersonaSessionStrip";

afterEach(cleanup);

describe("PersonaX bottom session strip", () => {
  it("renders identity, description, progress and wires the end action", () => {
    const end = vi.fn();
    render(<PersonaSessionStrip name="Mina" description="Calm mentor" progressPercentage={142}
      progressBarClass="bg-x" toneClass="t" statusLabel="40% · 3 left" elapsedLabel="1:05"
      endAction={<button onClick={end}>End</button>} />);
    expect(screen.getByTestId("persona-strip-name").textContent).toBe("Mina");
    expect(screen.getByTestId("persona-strip-description").textContent).toBe("Calm mentor");
    expect(screen.getByTestId("persona-strip-initials").textContent).toBe("Mi");
    expect((screen.getByTestId("persona-strip-progress") as HTMLElement).style.width).toBe("100%");
    fireEvent.click(screen.getByText("End"));
    expect(end).toHaveBeenCalledOnce();
  });

  it("removes top overlays for PersonaX and places the strip in the bottom surface", () => {
    const page = readFileSync("client/src/pages/FreeChatPage.tsx", "utf8");
    const chat = readFileSync("client/src/components/ChatWindow.tsx", "utf8");
    expect(page).not.toContain("Character mini identity banner");
    expect(chat).toContain('{!isPersonaX && (\n                  <VoiceOverlayHeader');
    expect(chat).toContain("inputMode !== 'realtime-voice' && !isPersonaX");
    expect(chat.indexOf("<PersonaSessionStrip")).toBeGreaterThan(chat.indexOf("<ConversationSurface"));
  });

  it("hides the duplicate footer for PersonaX even outside the free-chat entry", () => {
    const chat = readFileSync("client/src/components/ChatWindow.tsx", "utf8");
    expect(chat).toContain("!isPersonaX && !isPersonaMode && conversation.turnCount < MAX_TURNS");
    expect(chat).toContain('data-testid="button-end-conversation-persona-strip"');
  });
});
