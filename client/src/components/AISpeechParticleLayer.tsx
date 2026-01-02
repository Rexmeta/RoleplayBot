import { useRef, useEffect } from 'react';

interface Particle {
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  size: number;
  color: string;
  angle: number;
  speed: number;
  orbitRadius: number;
  phase: number;
}

interface AISpeechParticleLayerProps {
  amplitude: number;
  isActive: boolean;
  className?: string;
}

const PARTICLE_COUNT = 60;
const COLORS = [
  'rgba(99, 102, 241, 0.8)',
  'rgba(139, 92, 246, 0.8)',
  'rgba(168, 85, 247, 0.8)',
  'rgba(79, 70, 229, 0.6)',
  'rgba(124, 58, 237, 0.6)',
];

export function AISpeechParticleLayer({ amplitude, isActive, className = '' }: AISpeechParticleLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animationRef = useRef<number | null>(null);
  const targetAmplitudeRef = useRef(0);
  const currentAmplitudeRef = useRef(0);

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
    const baseRadius = Math.min(canvas.width, canvas.height) * 0.25;

    particlesRef.current = Array.from({ length: PARTICLE_COUNT }, (_, i) => {
      const angle = (i / PARTICLE_COUNT) * Math.PI * 2;
      const orbitRadius = baseRadius + Math.random() * 30;
      return {
        x: centerX + Math.cos(angle) * orbitRadius,
        y: centerY + Math.sin(angle) * orbitRadius,
        baseX: centerX,
        baseY: centerY,
        size: 2 + Math.random() * 4,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        angle,
        speed: 0.002 + Math.random() * 0.003,
        orbitRadius,
        phase: Math.random() * Math.PI * 2,
      };
    });

    return () => {
      window.removeEventListener('resize', resizeCanvas);
    };
  }, []);

  useEffect(() => {
    targetAmplitudeRef.current = amplitude;
  }, [amplitude]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const animate = () => {
      const currentAmp = currentAmplitudeRef.current;
      const targetAmp = targetAmplitudeRef.current;
      currentAmplitudeRef.current = currentAmp + (targetAmp - currentAmp) * 0.15;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const baseRadius = Math.min(canvas.width, canvas.height) * 0.25;
      const amplitudeScale = isActive ? 1 + currentAmplitudeRef.current * 3 : 0.3;

      particlesRef.current.forEach((particle, i) => {
        particle.angle += particle.speed * (isActive ? 1 + currentAmplitudeRef.current * 2 : 0.5);
        
        const pulseOffset = Math.sin(particle.angle * 3 + particle.phase) * 20 * currentAmplitudeRef.current;
        const dynamicRadius = (particle.orbitRadius + pulseOffset) * amplitudeScale;
        
        particle.x = centerX + Math.cos(particle.angle) * dynamicRadius;
        particle.y = centerY + Math.sin(particle.angle) * dynamicRadius;

        const dynamicSize = particle.size * (1 + currentAmplitudeRef.current * 1.5);
        const alpha = isActive ? 0.4 + currentAmplitudeRef.current * 0.6 : 0.2;

        ctx.beginPath();
        ctx.arc(particle.x, particle.y, dynamicSize, 0, Math.PI * 2);
        ctx.fillStyle = particle.color.replace(/[\d.]+\)$/, `${alpha})`);
        ctx.fill();

        if (isActive && currentAmplitudeRef.current > 0.1) {
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, dynamicSize * 2, 0, Math.PI * 2);
          const glowAlpha = currentAmplitudeRef.current * 0.3;
          ctx.fillStyle = particle.color.replace(/[\d.]+\)$/, `${glowAlpha})`);
          ctx.fill();
        }
      });

      if (isActive && currentAmplitudeRef.current > 0.05) {
        const gradient = ctx.createRadialGradient(
          centerX, centerY, baseRadius * 0.5 * amplitudeScale,
          centerX, centerY, baseRadius * 1.5 * amplitudeScale
        );
        gradient.addColorStop(0, `rgba(139, 92, 246, ${currentAmplitudeRef.current * 0.1})`);
        gradient.addColorStop(0.5, `rgba(99, 102, 241, ${currentAmplitudeRef.current * 0.05})`);
        gradient.addColorStop(1, 'rgba(99, 102, 241, 0)');

        ctx.beginPath();
        ctx.arc(centerX, centerY, baseRadius * 1.5 * amplitudeScale, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isActive]);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 pointer-events-none ${className}`}
      style={{ zIndex: 10 }}
      data-testid="ai-speech-particle-canvas"
    />
  );
}
