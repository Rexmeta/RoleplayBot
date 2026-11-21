export const GUEST_MESSAGE_MAX_LENGTH = 1000;

export interface GuestScenario {
  id: string;
  title: string;
  description: string;
  situation: string;
  partner: { name: string; role: string };
}

export interface GuestMessage {
  sender: "user" | "ai";
  message: string;
  timestamp: string;
}

export interface GuestProgress {
  scenario: GuestScenario;
  messages: GuestMessage[];
  turns: number;
  turnLimit: number;
}

export interface GuestDemoView {
  scenarios: GuestScenario[];
  progress: GuestProgress | null;
}
