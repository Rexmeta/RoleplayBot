import { useRef, useEffect } from 'react';

interface AISpeechParticleLayerProps {
  amplitude: number;
  isActive: boolean;
  className?: string;
}

export function AISpeechParticleLayer({ amplitude, isActive, className = '' }: AISpeechParticleLayerProps) {
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
        smoothedAmpRef.current = currentAmp + (targetAmp - currentAmp) * 0.4;
      } else {
        smoothedAmpRef.current = currentAmp + (targetAmp - currentAmp) * 0.1;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const centerX = canvas.width / 2;
      const centerY = canvas.height * 0.28;
      const amp = smoothedAmpRef.current;

      if (!isActive && amp < 0.01) {
        animationRef.current = requestAnimationFrame(animate);
        return;
      }

      const baseRadius = Math.min(canvas.width, canvas.height) * 0.18;
      const maxRadius = baseRadius * (1 + amp * 2.5);

      const auroraColors = [
        [99, 102, 241],
        [139, 92, 246],
        [168, 85, 247],
        [192, 132, 252],
        [79, 70, 229],
      ];

      const numWaves = 5;
      for (let w = 0; w < numWaves; w++) {
        const phaseOffset = (w / numWaves) * Math.PI * 2;
        const waveAmp = 0.6 + 0.4 * Math.sin(time * 1.5 + phaseOffset);
        const waveRadius = baseRadius + (maxRadius - baseRadius) * waveAmp * (0.4 + 0.6 * amp);
        const alpha = isActive
          ? (0.04 + amp * 0.12) * waveAmp
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
        const pulseRadius = baseRadius * (0.7 + amp * 0.5 + 0.2 * Math.sin(time * 6));
        const pulseAlpha = 0.08 + amp * 0.10;

        const pulseGradient = ctx.createRadialGradient(
          centerX, centerY, 0,
          centerX, centerY, pulseRadius
        );
        pulseGradient.addColorStop(0, `rgba(192, 132, 252, ${pulseAlpha})`);
        pulseGradient.addColorStop(0.6, `rgba(139, 92, 246, ${pulseAlpha * 0.6})`);
        pulseGradient.addColorStop(1, `rgba(99, 102, 241, 0)`);

        ctx.beginPath();
        ctx.arc(centerX, centerY, pulseRadius, 0, Math.PI * 2);
        ctx.fillStyle = pulseGradient;
        ctx.fill();
      }

      if (isActive && amp > 0.15) {
        const numRings = 2;
        for (let r = 0; r < numRings; r++) {
          const ringPhase = ((time * 0.8 + r * 0.5) % 1.2);
          const ringRadius = baseRadius * (0.6 + ringPhase * 1.2 * (0.5 + amp * 0.5));
          const ringAlpha = Math.max(0, (1 - ringPhase / 1.2) * amp * 0.08);
          ctx.beginPath();
          ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(168, 85, 247, ${ringAlpha})`;
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
      data-testid="ai-speech-particle-canvas"
    />
  );
}
