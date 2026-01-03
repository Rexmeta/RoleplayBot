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

interface AISpeechParticleLayerProps {
  amplitude: number;
  isActive: boolean;
  className?: string;
}

const PARTICLE_COUNT = 48;
const COLORS = [
  'rgba(99, 102, 241, 0.25)',
  'rgba(139, 92, 246, 0.25)',
  'rgba(168, 85, 247, 0.2)',
  'rgba(79, 70, 229, 0.25)',
  'rgba(124, 58, 237, 0.2)',
  'rgba(192, 132, 252, 0.18)',
];

export function AISpeechParticleLayer({ amplitude, isActive, className = '' }: AISpeechParticleLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animationRef = useRef<number | null>(null);
  const currentAmplitudeRef = useRef(0);
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
    const centerY = canvas.height / 2;
    const baseRadius = Math.min(canvas.width, canvas.height) * 0.18;

    particlesRef.current = Array.from({ length: PARTICLE_COUNT }, (_, i) => {
      const angle = (i / PARTICLE_COUNT) * Math.PI * 2;
      const radius = baseRadius + Math.random() * 30;
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
      const currentAmp = currentAmplitudeRef.current;
      
      if (targetAmp > currentAmp) {
        currentAmplitudeRef.current = currentAmp + (targetAmp - currentAmp) * 0.3;
      } else {
        currentAmplitudeRef.current = currentAmp + (targetAmp - currentAmp) * 0.08;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const amp = currentAmplitudeRef.current;

      particlesRef.current.forEach((particle) => {
        const pulseWave = Math.sin(time * 3 + particle.phase) * 0.5 + 0.5;
        const radiusExpand = amp * 60 + pulseWave * amp * 25;
        
        const currentRadius = particle.baseRadius + radiusExpand;
        
        particle.x = centerX + Math.cos(particle.angle) * currentRadius;
        particle.y = centerY + Math.sin(particle.angle) * currentRadius;

        const dynamicSize = particle.baseSize * (1 + amp * 1.2);
        const alpha = isActive ? 0.12 + amp * 0.18 : 0.05;

        ctx.beginPath();
        ctx.arc(particle.x, particle.y, dynamicSize, 0, Math.PI * 2);
        ctx.fillStyle = particle.color.replace(/[\d.]+\)$/, `${alpha})`);
        ctx.fill();

        if (isActive && amp > 0.35) {
          const glowSize = dynamicSize * 1.8;
          const glowAlpha = amp * 0.08;
          
          const gradient = ctx.createRadialGradient(
            particle.x, particle.y, 0,
            particle.x, particle.y, glowSize
          );
          gradient.addColorStop(0, particle.color.replace(/[\d.]+\)$/, `${glowAlpha})`));
          gradient.addColorStop(1, particle.color.replace(/[\d.]+\)$/, '0)'));
          
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, glowSize, 0, Math.PI * 2);
          ctx.fillStyle = gradient;
          ctx.fill();
        }
      });

      if (isActive && amp > 0.25) {
        const wavePhase = (time * 1.5) % 2;
        const waveRadius = Math.min(canvas.width, canvas.height) * 0.18 * (0.8 + wavePhase * amp);
        const waveAlpha = Math.max(0, (1 - wavePhase * 0.5) * amp * 0.05);
        
        ctx.beginPath();
        ctx.arc(centerX, centerY, waveRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(139, 92, 246, ${waveAlpha})`;
        ctx.lineWidth = 1;
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
      data-testid="ai-speech-particle-canvas"
    />
  );
}
