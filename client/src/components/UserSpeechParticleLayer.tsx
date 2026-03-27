import { useRef, useEffect } from 'react';

interface UserSpeechParticleLayerProps {
  amplitude: number;
  isActive: boolean;
  className?: string;
}

export function UserSpeechParticleLayer({ amplitude, isActive, className = '' }: UserSpeechParticleLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const smoothedAmpRef = useRef(0);
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (rect) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => {
      window.removeEventListener('resize', resizeCanvas);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const animate = () => {
      timeRef.current += 0.016;
      const time = timeRef.current;

      const targetAmp = amplitude;
      const currentAmp = smoothedAmpRef.current;
      if (targetAmp > currentAmp) {
        smoothedAmpRef.current = currentAmp + (targetAmp - currentAmp) * 0.5;
      } else {
        smoothedAmpRef.current = currentAmp + (targetAmp - currentAmp) * 0.15;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const centerX = canvas.width / 2;
      const centerY = canvas.height * 0.85;
      const amp = smoothedAmpRef.current;

      if (!isActive && amp < 0.01) {
        animationRef.current = requestAnimationFrame(animate);
        return;
      }

      const baseRadius = Math.min(canvas.width, canvas.height) * 0.14;
      const maxRadius = baseRadius * (1 + amp * 2.2);

      const auroraColors = [
        [34, 197, 94],
        [16, 185, 129],
        [74, 222, 128],
        [52, 211, 153],
        [5, 150, 105],
      ];

      const numWaves = 4;
      for (let w = 0; w < numWaves; w++) {
        const phaseOffset = (w / numWaves) * Math.PI * 2;
        const waveAmp = 0.6 + 0.4 * Math.sin(time * 2 + phaseOffset);
        const waveRadius = baseRadius + (maxRadius - baseRadius) * waveAmp * (0.4 + 0.6 * amp);
        const alpha = isActive
          ? (0.05 + amp * 0.14) * waveAmp
          : 0.015 * waveAmp;
        const colorIdx = w % auroraColors.length;
        const [r, g, b] = auroraColors[colorIdx];

        const gradient = ctx.createRadialGradient(
          centerX, centerY, waveRadius * 0.2,
          centerX, centerY, waveRadius
        );
        gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha * 0.5})`);
        gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${alpha})`);
        gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

        ctx.beginPath();
        ctx.arc(centerX, centerY, waveRadius, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
      }

      if (isActive && amp > 0.05) {
        const pulseRadius = baseRadius * (0.7 + amp * 0.5 + 0.2 * Math.sin(time * 8));
        const pulseAlpha = 0.10 + amp * 0.12;

        const pulseGradient = ctx.createRadialGradient(
          centerX, centerY, 0,
          centerX, centerY, pulseRadius
        );
        pulseGradient.addColorStop(0, `rgba(110, 231, 183, ${pulseAlpha})`);
        pulseGradient.addColorStop(0.6, `rgba(34, 197, 94, ${pulseAlpha * 0.6})`);
        pulseGradient.addColorStop(1, `rgba(5, 150, 105, 0)`);

        ctx.beginPath();
        ctx.arc(centerX, centerY, pulseRadius, 0, Math.PI * 2);
        ctx.fillStyle = pulseGradient;
        ctx.fill();
      }

      if (isActive && amp > 0.1) {
        const numRings = 2;
        for (let r = 0; r < numRings; r++) {
          const ringPhase = ((time * 1.2 + r * 0.4) % 1.0);
          const ringRadius = baseRadius * (0.5 + ringPhase * 1.2 * (0.5 + amp * 0.5));
          const ringAlpha = Math.max(0, (1 - ringPhase) * amp * 0.10);
          ctx.beginPath();
          ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(34, 197, 94, ${ringAlpha})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isActive, amplitude]);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 pointer-events-none ${className}`}
      style={{ zIndex: 10 }}
      data-testid="user-speech-particle-canvas"
    />
  );
}
