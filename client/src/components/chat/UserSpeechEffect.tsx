import { UserSpeechParticleLayer } from "@/components/UserSpeechParticleLayer";

export function UserSpeechEffect({ active, amplitude }: { active: boolean; amplitude: number }) {
  return (
    <>
      {active && (
        <div
          aria-hidden="true"
          data-testid="user-speech-glow"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[12] h-[40%] motion-safe:animate-[beamPulse_2s_ease-in-out_infinite]"
          style={{ background: "linear-gradient(to top, rgba(34, 197, 94, 0.20) 0%, rgba(16, 185, 129, 0.08) 40%, transparent 100%)" }}
        />
      )}
      <UserSpeechParticleLayer amplitude={amplitude} isActive={active} className="motion-reduce:hidden" />
    </>
  );
}
