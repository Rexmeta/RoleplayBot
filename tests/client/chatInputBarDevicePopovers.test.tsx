// @vitest-environment happy-dom
/**
 * ChatInputBar — 마이크/출력 기기 팝오버 wiring 회귀 테스트
 *
 * 사용자가 "출력 버튼과 마이크 버튼 기능이 뒤바뀐 것 같다"고 보고한 사례를 계기로,
 * 각 버튼이 정확히 자기 쪽 콜백(입력: onInputDeviceChange/onRefreshInputDevices,
 * 출력: onOutputDeviceChange/onRefreshOutputDevices)만 호출하는지 고정한다.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React, { createContext, useContext, useState } from 'react';

// ---------------------------------------------------------------------------
// Mocks — 팝오버는 트리거 클릭 시 onOpenChange(true)를 호출하고 내용을 항상 렌더
// ---------------------------------------------------------------------------

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? key.split('.').pop() ?? key,
  }),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/ui/auto-resize-textarea', () => ({
  AutoResizeTextarea: (props: any) => <textarea {...props} />,
}));

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipContent: () => null,
  TooltipProvider: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
}));

vi.mock('@/components/ui/popover', () => {
  const PopoverCtx = createContext<{ notifyOpen: () => void }>({ notifyOpen: () => {} });
  return {
    Popover: ({ children, onOpenChange }: any) => (
      <PopoverCtx.Provider value={{ notifyOpen: () => onOpenChange?.(true) }}>
        <div>{children}</div>
      </PopoverCtx.Provider>
    ),
    PopoverTrigger: ({ children }: any) => {
      const { notifyOpen } = useContext(PopoverCtx);
      return React.cloneElement(children, {
        onClick: (e: any) => {
          children.props.onClick?.(e);
          notifyOpen();
        },
      });
    },
    PopoverContent: ({ children }: any) => <div>{children}</div>,
  };
});

import { ChatInputBar } from '@/components/chat/ChatInputBar';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpies() {
  return {
    onInputDeviceChange: vi.fn().mockResolvedValue(true),
    onRefreshInputDevices: vi.fn().mockResolvedValue(undefined),
    onRequestInputPermission: vi.fn().mockResolvedValue(true),
    onOutputDeviceChange: vi.fn().mockResolvedValue(true),
    onRefreshOutputDevices: vi.fn().mockResolvedValue(undefined),
    onRequestOutputPermission: vi.fn().mockResolvedValue(true),
  };
}

function renderConnectedBar(spies: ReturnType<typeof makeSpies>, overrides: Record<string, unknown> = {}) {
  return render(
    <ChatInputBar
      userInput=""
      onUserInputChange={() => {}}
      onSendMessage={() => {}}
      onVoiceInput={() => {}}
      onSkipTurn={() => {}}
      isLoading={false}
      isRecording={false}
      speechSupported={true}
      mode="realtime-voice"
      realtimeVoiceProps={{
        status: 'connected',
        isRecording: false,
        isAISpeaking: false,
        isWaitingForGreeting: false,
        greetingFailed: false,
        greetingRetryCount: 0,
        conversationPhase: 'active',
        showMicPrompt: false,
        onConnect: () => {},
        onStartRecording: () => {},
        onStopRecording: () => {},
        onEndConversation: () => {},
        inputDevices: [
          { deviceId: '', label: '기본 마이크', kind: 'default' },
          { deviceId: 'bt-mic', label: '블루투스 · Buds Mic', kind: 'bluetooth' },
        ],
        selectedInputDeviceId: '',
        inputStatus: 'supported',
        inputMessage: null,
        inputNeedsPermission: true,
        outputDevices: [
          { deviceId: '', label: '기본 출력 기기', kind: 'default' },
          { deviceId: 'bt-out', label: '블루투스 · Buds', kind: 'bluetooth' },
        ],
        selectedOutputDeviceId: '',
        outputStatus: 'supported',
        outputMessage: null,
        outputNeedsPermission: true,
        outputListUnavailable: false,
        ...spies,
        ...overrides,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatInputBar device popovers wiring', () => {
  let spies: ReturnType<typeof makeSpies>;

  beforeEach(() => {
    spies = makeSpies();
  });

  it('마이크 버튼은 입력 기기 목록만 새로고침한다 (출력 아님)', () => {
    renderConnectedBar(spies);

    fireEvent.click(screen.getByTestId('button-audio-input-settings'));

    expect(spies.onRefreshInputDevices).toHaveBeenCalledTimes(1);
    expect(spies.onRefreshOutputDevices).not.toHaveBeenCalled();
  });

  it('출력 버튼은 출력 기기 목록만 새로고침한다 (입력 아님)', () => {
    renderConnectedBar(spies);

    fireEvent.click(screen.getByTestId('button-audio-output-settings'));

    expect(spies.onRefreshOutputDevices).toHaveBeenCalledTimes(1);
    expect(spies.onRefreshInputDevices).not.toHaveBeenCalled();
  });

  it('마이크 팝오버의 기기 선택은 onInputDeviceChange만 호출한다', () => {
    renderConnectedBar(spies);

    fireEvent.click(screen.getByTestId('button-input-device-bt-mic'));

    expect(spies.onInputDeviceChange).toHaveBeenCalledWith('bt-mic');
    expect(spies.onOutputDeviceChange).not.toHaveBeenCalled();
  });

  it('출력 팝오버의 기기 선택은 onOutputDeviceChange만 호출한다', () => {
    renderConnectedBar(spies);

    fireEvent.click(screen.getByTestId('button-output-device-bt-out'));

    expect(spies.onOutputDeviceChange).toHaveBeenCalledWith('bt-out');
    expect(spies.onInputDeviceChange).not.toHaveBeenCalled();
  });

  it('기기 목록 불러오기 버튼이 각각 자기 쪽 권한 요청만 호출한다', () => {
    renderConnectedBar(spies);

    fireEvent.click(screen.getByTestId('button-load-input-devices'));
    expect(spies.onRequestInputPermission).toHaveBeenCalledTimes(1);
    expect(spies.onRequestOutputPermission).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('button-load-output-devices'));
    expect(spies.onRequestOutputPermission).toHaveBeenCalledTimes(1);
    expect(spies.onRequestInputPermission).toHaveBeenCalledTimes(1);
  });

  it('마이크 버튼에는 마이크 아이콘·라벨, 출력 버튼에는 볼륨 아이콘·라벨이 표시된다', () => {
    renderConnectedBar(spies);

    const inputTrigger = screen.getByTestId('button-audio-input-settings');
    expect(inputTrigger.getAttribute('aria-label')).toBe('마이크 기기 설정');
    expect(inputTrigger.querySelector('.fa-microphone')).toBeTruthy();
    expect(inputTrigger.textContent).toContain('마이크');

    const outputTrigger = screen.getByTestId('button-audio-output-settings');
    expect(outputTrigger.getAttribute('aria-label')).toBe('음성 출력 기기 설정');
    expect(outputTrigger.querySelector('.fa-volume-up')).toBeTruthy();
    expect(outputTrigger.textContent).toContain('출력');
  });

  it('마이크 팝오버에는 마이크 목록, 출력 팝오버에는 출력 목록이 렌더된다', () => {
    renderConnectedBar(spies);

    // 입력 팝오버: 마이크 기기만
    expect(screen.getByTestId('button-input-device-default').textContent).toContain('기본 마이크');
    expect(screen.getByTestId('button-input-device-bt-mic').textContent).toContain('Buds Mic');

    // 출력 팝오버: 출력 기기만
    expect(screen.getByTestId('button-output-device-default').textContent).toContain('기본 출력 기기');
    expect(screen.getByTestId('button-output-device-bt-out').textContent).toContain('Buds');
  });
});
