// @vitest-environment happy-dom
/**
 * ChatInputBar — 통합 음성 설정 패널 wiring 회귀 테스트
 *
 * 기존 세 개의 개별 Popover(감도·마이크·출력)가 단일 설정 버튼(⚙) + 통합 패널로
 * 대체되었다. 이 테스트는:
 * - 설정 버튼 하나로 마이크/출력 목록이 함께 새로고침되는지
 * - 각 섹션의 기기 선택이 자기 쪽 콜백만 호출하는지 (입력/출력 뒤바뀜 회귀 방지)
 * - 현재 기기 칩, 블루투스 "권장" 배지, 정렬(블루투스 → 유선 → 내장)
 * - VAD "자동(권장)" 토글과 수동 레벨 접힘/펼침
 * - 모바일 출력 목록 미제공 안내
 * 를 고정한다.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React, { createContext, useContext } from 'react';

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
    PopoverContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  };
});

import { ChatInputBar } from '@/components/chat/ChatInputBar';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpies() {
  return {
    onVadSensitivityChange: vi.fn(),
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
        vadSensitivity: 0,
        inputDevices: [
          { deviceId: '', label: '기본 마이크', kind: 'default' },
          { deviceId: 'bt-mic', label: '블루투스 · Buds Mic', kind: 'bluetooth' },
        ],
        selectedInputDeviceId: '',
        inputAutoSelected: false,
        inputStatus: 'supported',
        inputMessage: null,
        inputNeedsPermission: true,
        outputDevices: [
          { deviceId: '', label: '기본 출력 기기', kind: 'default' },
          { deviceId: 'bt-out', label: '블루투스 · Buds', kind: 'bluetooth' },
        ],
        selectedOutputDeviceId: '',
        outputAutoSelected: false,
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

describe('ChatInputBar unified audio settings panel', () => {
  let spies: ReturnType<typeof makeSpies>;

  beforeEach(() => {
    spies = makeSpies();
  });

  it('단일 설정 버튼(⚙) 하나만 노출되고, 기존 개별 버튼들은 없다', () => {
    renderConnectedBar(spies);

    expect(screen.getByTestId('button-audio-settings')).toBeTruthy();
    expect(screen.queryByTestId('button-audio-input-settings')).toBeNull();
    expect(screen.queryByTestId('button-audio-output-settings')).toBeNull();
  });

  it('설정 버튼을 열면 입력·출력 기기 목록을 모두 새로고침한다', () => {
    renderConnectedBar(spies);

    fireEvent.click(screen.getByTestId('button-audio-settings'));

    expect(spies.onRefreshInputDevices).toHaveBeenCalledTimes(1);
    expect(spies.onRefreshOutputDevices).toHaveBeenCalledTimes(1);
  });

  it('패널에 마이크·출력·감도 세 섹션이 함께 렌더된다', () => {
    renderConnectedBar(spies);

    expect(screen.getByTestId('section-audio-input')).toBeTruthy();
    expect(screen.getByTestId('section-audio-output')).toBeTruthy();
    expect(screen.getByTestId('section-vad-sensitivity')).toBeTruthy();
  });

  it('마이크 섹션의 기기 선택은 onInputDeviceChange만 호출한다', () => {
    renderConnectedBar(spies);

    fireEvent.click(screen.getByTestId('button-input-device-bt-mic'));

    expect(spies.onInputDeviceChange).toHaveBeenCalledWith('bt-mic');
    expect(spies.onOutputDeviceChange).not.toHaveBeenCalled();
  });

  it('출력 섹션의 기기 선택은 onOutputDeviceChange만 호출한다', () => {
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

  it('블루투스 기기가 선택되면 트리거 칩에 이름이 표시된다', () => {
    renderConnectedBar(spies, { selectedInputDeviceId: 'bt-mic' });

    const chip = screen.getByTestId('chip-current-device');
    expect(chip.textContent).toContain('Buds Mic');
    expect(chip.querySelector('.fa-bluetooth-b')).toBeTruthy();
  });

  it('아무 기기도 선택되지 않으면 칩에 기본 기기 라벨이 표시된다', () => {
    renderConnectedBar(spies);

    expect(screen.getByTestId('chip-current-device').textContent).toContain('기본 기기');
  });

  it('기기 목록은 블루투스가 먼저 오도록 정렬되고 블루투스에 "권장" 배지가 붙는다', () => {
    renderConnectedBar(spies, {
      inputDevices: [
        { deviceId: '', label: '기본 마이크', kind: 'default' },
        { deviceId: 'builtin-mic', label: '휴대폰 · Phone Mic', kind: 'builtin' },
        { deviceId: 'bt-mic', label: '블루투스 · Buds Mic', kind: 'bluetooth' },
        { deviceId: 'wired-mic', label: '유선 · USB Mic', kind: 'wired' },
      ],
    });

    const section = screen.getByTestId('section-audio-input');
    const ids = Array.from(section.querySelectorAll('[data-testid^="button-input-device-"]'))
      .map(el => el.getAttribute('data-testid'));
    expect(ids).toEqual([
      'button-input-device-bt-mic',
      'button-input-device-wired-mic',
      'button-input-device-builtin-mic',
      'button-input-device-default',
    ]);

    expect(screen.getByTestId('button-input-device-bt-mic').textContent).toContain('권장');
    expect(screen.getByTestId('button-input-device-wired-mic').textContent).not.toContain('권장');
  });

  it('자동 선택된 기기에는 이유("블루투스 감지됨")가 표시된다', () => {
    renderConnectedBar(spies, {
      selectedInputDeviceId: 'bt-mic',
      inputAutoSelected: true,
      selectedOutputDeviceId: 'bt-out',
      outputAutoSelected: true,
    });

    expect(screen.getByTestId('text-input-selection-reason').textContent).toContain('블루투스 감지됨');
    expect(screen.getByTestId('text-output-selection-reason').textContent).toContain('블루투스 감지됨');
  });

  it('수동으로 저장된 선택에는 "저장된 선택" 이유가 표시된다', () => {
    renderConnectedBar(spies, { selectedInputDeviceId: 'bt-mic', inputAutoSelected: false });

    expect(screen.getByTestId('text-input-selection-reason').textContent).toContain('저장된 선택');
  });

  it('모바일에서 출력 목록 미제공 시 안내 문구만 표시되고 기기 버튼은 없다', () => {
    renderConnectedBar(spies, { outputListUnavailable: true });

    expect(screen.getByTestId('text-output-list-unavailable')).toBeTruthy();
    expect(screen.getByTestId('text-output-selection-reason').textContent)
      .toContain('OS 미디어 출력으로 자동 제어됨');
    expect(screen.queryByTestId('button-output-device-bt-out')).toBeNull();
  });

  describe('VAD 감도 섹션', () => {
    it('자동(권장) 모드(0)에서는 수동 레벨 목록이 접혀 있다', () => {
      renderConnectedBar(spies, { vadSensitivity: 0 });

      const toggle = screen.getByTestId('toggle-vad-auto');
      expect(toggle.getAttribute('aria-checked')).toBe('true');
      expect(screen.queryByTestId('vad-manual-levels')).toBeNull();
    });

    it('자동 토글을 끄면 수동 기본 레벨(3)로 전환한다', () => {
      renderConnectedBar(spies, { vadSensitivity: 0 });

      fireEvent.click(screen.getByTestId('toggle-vad-auto'));
      expect(spies.onVadSensitivityChange).toHaveBeenCalledWith(3);
    });

    it('수동 모드에서는 레벨 목록이 펼쳐지고 레벨 클릭이 전달된다', () => {
      renderConnectedBar(spies, { vadSensitivity: 3 });

      expect(screen.getByTestId('toggle-vad-auto').getAttribute('aria-checked')).toBe('false');
      expect(screen.getByTestId('vad-manual-levels')).toBeTruthy();

      fireEvent.click(screen.getByTestId('button-vad-level-5'));
      expect(spies.onVadSensitivityChange).toHaveBeenCalledWith(5);
    });

    it('수동 모드에서 자동 토글을 켜면 0(자동)으로 전환한다', () => {
      renderConnectedBar(spies, { vadSensitivity: 4 });

      fireEvent.click(screen.getByTestId('toggle-vad-auto'));
      expect(spies.onVadSensitivityChange).toHaveBeenCalledWith(0);
    });
  });
});
