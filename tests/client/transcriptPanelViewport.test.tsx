// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render as renderUI, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { TranscriptPanel } from '@/components/chat/TranscriptPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

function render(element: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return renderUI(element, {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

const props = {
  isOpen: true,
  onToggle: vi.fn(),
  onClose: vi.fn(),
  messages: [{ sender: 'user' as const, message: 'Latest message', timestamp: '2026-10-02T00:00:00Z' }],
  pendingAiMessage: false,
  pendingUserMessage: false,
  pendingUserText: '',
  personaName: 'Persona',
};

describe('TranscriptPanel viewport clearance', () => {
  it('bounds both the toggle and scrollable body by the visible viewport minus the safe area', () => {
    render(<TranscriptPanel {...props} viewportHeight={640} />);
    const toggle = screen.getByTestId('button-toggle-transcript');
    const overlay = toggle.parentElement!;
    expect(overlay.style.getPropertyValue('--transcript-viewport-height')).toBe('640px');
    expect(overlay.style.getPropertyValue('--transcript-viewport-top')).toBe('0px');
    expect(overlay.className).toContain('h-[calc(var(--transcript-viewport-height,100dvh)-env(safe-area-inset-bottom,0px))]');
    expect(toggle.className).toContain('absolute top-1/2');
    const messages = screen.getByText('Latest message').closest('.overflow-y-auto')!;
    expect(messages.className).toContain('min-h-0');
    expect(messages.parentElement?.className).toContain('absolute top-0 right-0 bottom-0');
    expect(messages.parentElement?.parentElement).toBe(overlay);
    // Desktop sizing still follows the character container, not the mobile height.
    expect(overlay.className).toContain('sm:absolute sm:inset-0 sm:h-auto');
  });

  it('updates the shared bounds when browser chrome or the keyboard changes the viewport', () => {
    const { rerender } = render(<TranscriptPanel {...props} viewportHeight={640} />);
    rerender(<TranscriptPanel {...props} viewportHeight={380} viewportOffsetTop={120} />);
    const overlay = screen.getByTestId('button-toggle-transcript').parentElement!;
    expect(overlay.style.getPropertyValue('--transcript-viewport-height')).toBe('380px');
    expect(overlay.style.getPropertyValue('--transcript-viewport-top')).toBe('120px');
  });

  it('uses a dynamic viewport fallback and preserves toggle and close behavior', () => {
    render(<TranscriptPanel {...props} isOpen={false} />);
    const toggle = screen.getByTestId('button-toggle-transcript');
    expect(toggle.parentElement!.style.getPropertyValue('--transcript-viewport-height')).toBe('');
    fireEvent.click(toggle);
    expect(props.onToggle).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTitle('대화 내역 보기').parentElement!.querySelector('button:not([data-testid])')!);
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});