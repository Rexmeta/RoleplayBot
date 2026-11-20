// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { PersonaMediaPreview, type ScenarioPersonaMedia } from '@/components/admin/scenarioEditor/PersonaMediaPreview';

afterEach(cleanup);
const template: ScenarioPersonaMedia = {
  id: 'live-template', mbti: 'ESTJ', avatarMode: 'live',
  liveAvatar: { kind: 'stock', avatarId: 'tavus-stock-lucy', providerId: 'tavus',
    voiceMode: 'roleplayx', validationStatus: 'unverified', activation: 'draft' },
  images: { base: 'personas/base.png', female: { expressions: { 중립: 'personas/female.png' } } },
};

it('shows the base image and live setting without claiming connection readiness', () => {
  render(<PersonaMediaPreview persona={template} gender="female" />);
  expect(screen.getByRole('img').getAttribute('src')).toBe('/objects?key=personas%2Fbase.png');
  expect(screen.getByText('라이브 아바타 설정').getAttribute('title')).toContain('실제 연결 가능 여부');
});

it('uses the matching gender neutral image only when there is no base image', () => {
  render(<PersonaMediaPreview persona={{ ...template, images: { female: { expressions: { 중립: 'personas/female.png' } } } }} gender="female" />);
  expect(screen.getByRole('img').getAttribute('src')).toBe('/objects?key=personas%2Ffemale.png');
});

it('shows compact previews for selection options too', () => {
  render(<PersonaMediaPreview compact persona={template} />);
  expect(screen.getByRole('img').getAttribute('alt')).toBe('ESTJ 기본 이미지');
  expect(screen.getByText('라이브 아바타 설정')).toBeTruthy();
});

it('warns when live display is selected without an assigned avatar', () => {
  render(<PersonaMediaPreview persona={{ ...template, liveAvatar: null }} />);
  expect(screen.getByText('라이브 아바타 미연결').getAttribute('title')).toContain('선택하고 저장');
  expect(screen.queryByText('라이브 아바타 설정')).toBeNull();
});

it('distinguishes a missing selection from a missing image', () => {
  const { rerender } = render(<PersonaMediaPreview />);
  expect(screen.getByRole('img', { name: '페르소나 미선택' })).toBeTruthy();
  rerender(<PersonaMediaPreview persona={{ id: 'empty', mbti: 'INTJ' }} />);
  expect(screen.getByRole('img', { name: '기본 이미지 없음' })).toBeTruthy();
  expect(screen.getByText('이미지 아바타')).toBeTruthy();
});

it('handles image failure and recovers when another template is selected', () => {
  const { rerender } = render(<PersonaMediaPreview persona={template} />);
  fireEvent.error(screen.getByRole('img'));
  expect(screen.getByRole('img', { name: '이미지를 불러오지 못했습니다' })).toBeTruthy();
  rerender(<PersonaMediaPreview persona={{ ...template, images: { base: 'personas/next.png' } }} />);
  expect(screen.getByRole('img').getAttribute('src')).toBe('/objects?key=personas%2Fnext.png');
});

it('does not label legacy video personas as live', () => {
  render(<PersonaMediaPreview persona={{ id: 'video', mbti: 'INTJ', videos: { enabled: true } }} />);
  expect(screen.getByText('영상 아바타')).toBeTruthy();
  expect(screen.queryByText('라이브 아바타 설정')).toBeNull();
});
