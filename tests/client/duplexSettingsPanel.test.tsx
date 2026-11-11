// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DuplexSettingsPanel from '../../client/src/components/admin/DuplexSettingsPanel';
import { BASELINE_DUPLEX_CONFIG } from '../../shared/duplexMode';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><DuplexSettingsPanel /></QueryClientProvider>);
}
describe('admin Duplex controls (component harness, not a real signed-in browser)', () => {
  it('loads, rejects invalid combinations, saves an explicit mode and resets to baseline', async () => {
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      return new Response(JSON.stringify(init?.method === 'PUT' ? { id: 'setting' } : []), { status: 200 });
    });
    vi.stubGlobal('fetch', fetcher);
    mount();
    await screen.findByTestId('duplex-settings-panel');
    expect((screen.getByTestId('duplex-toggle-voiceBackchannel') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('duplex-toggle-playbackLifecycle'));
    expect(screen.getByTestId('duplex-validation-errors')).toBeTruthy();
    expect((screen.getByTestId('duplex-save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('duplex-toggle-interaction'));
    fireEvent.click(screen.getByTestId('duplex-save'));
    await screen.findByTestId('duplex-settings-saved');
    const request = fetcher.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(request[0]).toBe('/api/system-admin/settings');
    expect(JSON.parse(request[1]!.body as string).value).toMatchObject({
      interaction: true, playbackLifecycle: true, voiceBackchannel: false,
    });
    fireEvent.click(screen.getByTestId('duplex-reset-baseline'));
    expect(screen.getByTestId('duplex-toggle-interaction').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('duplex-barge-in-policy')).toBeTruthy();
  });
  it('does not silently fall back to baseline when the persisted setting is malformed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { category: 'voice_duplex', key: 'config', value: '{broken' },
    ]), { status: 200 })));
    mount();
    await screen.findByTestId('duplex-settings-load-error');
    expect(screen.queryByTestId('duplex-save')).toBeNull();
  });
  it('loads an existing pinned-setting shape without activating it by default', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { category: 'voice_duplex', key: 'config', value: JSON.stringify(BASELINE_DUPLEX_CONFIG) },
    ]), { status: 200 })));
    mount();
    await screen.findByTestId('duplex-settings-panel');
    await waitFor(() => expect(screen.getByTestId('duplex-toggle-interaction').getAttribute('aria-checked')).toBe('false'));
  });
});
