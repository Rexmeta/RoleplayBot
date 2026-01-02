import { useRef, useEffect } from 'react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseX: number;
  baseY: number;
  size: number;
  baseSize: number;
  color: string;
  angle: number;
  speed: number;
  orbitRadius: number;
  baseOrbitRadius: number;
  phase: number;
  noiseOffset: number;
  energy: number;
}

interface AISpeechParticleLayerProps {
  amplitude: number;
  isActive: boolean;
  className?: string;
}

const PARTICLE_COUNT = 80;
const COLORS = [
  'rgba(99, 102, 241, 1)',
  'rgba(139, 92, 246, 1)',
  'rgba(168, 85, 247, 1)',
  'rgba(79, 70, 229, 1)',
  'rgba(124, 58, 237, 1)',
  'rgba(192, 132, 252, 1)',
];

export function AISpeechParticleLayer({ amplitude, isActive, className = '' }: AISpeechParticleLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animationRef = useRef<number | null>(null);
  const targetAmplitudeRef = useRef(0);
  const currentAmplitudeRef = useRef(0);
  const timeRef = useRef(0);
  const prevAmplitudeRef = useRef(0);

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
    const baseRadius = Math.min(canvas.width, canvas.height) * 0.2;

    particlesRef.current = Array.from({ length: PARTICLE_COUNT }, (_, i) => {
      const angle = (i / PARTICLE_COUNT) * Math.PI * 2;
      const orbitRadius = baseRadius + Math.random() * 50;
      return {
        x: centerX + Math.cos(angle) * orbitRadius,
        y: centerY + Math.sin(angle) * orbitRadius,
        vx: 0,
        vy: 0,
        baseX: centerX,
        baseY: centerY,
        size: 2 + Math.random() * 3,
        baseSize: 2 + Math.random() * 3,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        angle,
        speed: 0.003 + Math.random() * 0.004,
        orbitRadius,
        baseOrbitRadius: orbitRadius,
        phase: Math.random() * Math.PI * 2,
        noiseOffset: Math.random() * 1000,
        energy: 0,
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
      timeRef.current += 0.016;
      const time = timeRef.current;
      
      const currentAmp = currentAmplitudeRef.current;
      const targetAmp = targetAmplitudeRef.current;
      currentAmplitudeRef.current = currentAmp + (targetAmp - currentAmp) * 0.25;
      
      const ampDelta = currentAmplitudeRef.current - prevAmplitudeRef.current;
      const isBurst = ampDelta > 0.15;
      prevAmplitudeRef.current = currentAmplitudeRef.current;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const baseRadius = Math.min(canvas.width, canvas.height) * 0.2;
      const amp = currentAmplitudeRef.current;

      particlesRef.current.forEach((particle) => {
        if (isBurst) {
          particle.energy = Math.min(1, particle.energy + 0.5);
        }
        particle.energy *= 0.95;
        
        const baseSpeed = isActive ? particle.speed * (1 + amp * 3) : particle.speed * 0.3;
        particle.angle += baseSpeed;
        
        const noise = Math.sin(time * 2 + particle.noiseOffset) * 15 * amp;
        const pulseOffset = Math.sin(particle.angle * 4 + particle.phase) * 30 * amp;
        const burstOffset = particle.energy * 40;
        
        const dynamicRadius = particle.baseOrbitRadius * (isActive ? (0.8 + amp * 0.8) : 0.5) + pulseOffset + noise + burstOffset;
        
        const targetX = centerX + Math.cos(particle.angle) * dynamicRadius;
        const targetY = centerY + Math.sin(particle.angle) * dynamicRadius;
        
        const springForce = 0.15 + amp * 0.1;
        const damping = 0.75;
        
        particle.vx = (particle.vx + (targetX - particle.x) * springForce) * damping;
        particle.vy = (particle.vy + (targetY - particle.y) * springForce) * damping;
        
        particle.x += particle.vx;
        particle.y += particle.vy;

        const dynamicSize = particle.baseSize * (1 + amp * 2.5 + particle.energy * 2);
        const alpha = isActive ? 0.5 + amp * 0.5 : 0.15;

        ctx.beginPath();
        ctx.arc(particle.x, particle.y, dynamicSize, 0, Math.PI * 2);
        ctx.fillStyle = particle.color.replace(/[\d.]+\)$/, `${alpha})`);
        ctx.fill();

        if (isActive && (amp > 0.2 || particle.energy > 0.2)) {
          const glowSize = dynamicSize * (2 + amp + particle.energy);
          const glowAlpha = (amp * 0.4 + particle.energy * 0.3) * 0.5;
          
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

      if (isActive && amp > 0.1) {
        const waveCount = 3;
        for (let w = 0; w < waveCount; w++) {
          const wavePhase = (time * 2 + w * 0.5) % 2;
          const waveRadius = baseRadius * (0.5 + wavePhase * amp * 1.5);
          const waveAlpha = Math.max(0, (1 - wavePhase) * amp * 0.15);
          
          ctx.beginPath();
          ctx.arc(centerX, centerY, waveRadius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(139, 92, 246, ${waveAlpha})`;
          ctx.lineWidth = 2 + amp * 3;
          ctx.stroke();
        }
      }

      if (isActive && amp > 0.15) {
        const gradient = ctx.createRadialGradient(
          centerX, centerY, baseRadius * 0.3,
          centerX, centerY, baseRadius * (1.5 + amp)
        );
        gradient.addColorStop(0, `rgba(139, 92, 246, ${amp * 0.12})`);
        gradient.addColorStop(0.5, `rgba(99, 102, 241, ${amp * 0.06})`);
        gradient.addColorStop(1, 'rgba(99, 102, 241, 0)');

        ctx.beginPath();
        ctx.arc(centerX, centerY, baseRadius * (1.5 + amp), 0, Math.PI * 2);
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
