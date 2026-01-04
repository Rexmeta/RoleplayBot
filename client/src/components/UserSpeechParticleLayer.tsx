import { useRef, useEffect } from 'react';

interface Particle {
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  size: number;
  baseSize: number;
  color: string;
  angle: number;
  baseRadius: number;
  phase: number;
}

interface UserSpeechParticleLayerProps {
  amplitude: number;
  isActive: boolean;
  className?: string;
}

const PARTICLE_COUNT = 80;
const COLORS = [
  'rgba(34, 197, 94, 0.20)',
  'rgba(74, 222, 128, 0.20)',
  'rgba(16, 185, 129, 0.18)',
  'rgba(52, 211, 153, 0.18)',
  'rgba(110, 231, 183, 0.15)',
  'rgba(5, 150, 105, 0.20)',
];

export function UserSpeechParticleLayer({ amplitude, isActive, className = '' }: UserSpeechParticleLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animationRef = useRef<number | null>(null);
  const smoothedAmpRef = useRef(0);
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (rect) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const centerX = canvas.width / 2;
    const centerY = canvas.height * 0.85;
    const baseRadius = Math.min(canvas.width, canvas.height) * 0.12;

    particlesRef.current = Array.from({ length: PARTICLE_COUNT }, (_, i) => {
      const angle = (i / PARTICLE_COUNT) * Math.PI * 2;
      const radius = baseRadius + Math.random() * 15;
      return {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
        baseX: centerX,
        baseY: centerY,
        size: 0.8 + Math.random() * 0.8,
        baseSize: 0.8 + Math.random() * 0.8,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        angle,
        baseRadius: radius,
        phase: Math.random() * Math.PI * 2,
      };
    });

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
        smoothedAmpRef.current = currentAmp + (targetAmp - currentAmp) * 0.6;
      } else {
        smoothedAmpRef.current = currentAmp + (targetAmp - currentAmp) * 0.2;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const centerX = canvas.width / 2;
      const centerY = canvas.height * 0.85;
      const amp = smoothedAmpRef.current;

      particlesRef.current.forEach((particle) => {
        const pulseWave = Math.sin(time * 10 + particle.phase) * 0.5 + 0.5;
        const radiusExpand = amp * 100 * pulseWave;
        
        const currentRadius = particle.baseRadius + radiusExpand;
        
        particle.x = centerX + Math.cos(particle.angle) * currentRadius;
        particle.y = centerY + Math.sin(particle.angle) * currentRadius;

        const dynamicSize = particle.baseSize * (1 + amp * 2.5);
        const alpha = isActive ? 0.12 + amp * 0.20 : 0.04;

        ctx.beginPath();
        ctx.arc(particle.x, particle.y, dynamicSize, 0, Math.PI * 2);
        ctx.fillStyle = particle.color.replace(/[\d.]+\)$/, `${alpha})`);
        ctx.fill();
      });

      if (isActive && amp > 0.1) {
        const wavePhase = (time * 3) % 1.5;
        const waveRadius = Math.min(canvas.width, canvas.height) * 0.12 * (0.5 + wavePhase * amp * 1.0);
        const waveAlpha = Math.max(0, (1 - wavePhase * 0.7) * amp * 0.06);
        
        ctx.beginPath();
        ctx.arc(centerX, centerY, waveRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(34, 197, 94, ${waveAlpha})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();
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
