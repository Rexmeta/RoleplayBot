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

const PARTICLE_COUNT = 120; // 3배 증가 (40 → 120)
const COLORS = [
  'rgba(99, 102, 241, 0.18)',
  'rgba(139, 92, 246, 0.18)',
  'rgba(168, 85, 247, 0.15)',
  'rgba(79, 70, 229, 0.18)',
  'rgba(124, 58, 237, 0.15)',
  'rgba(192, 132, 252, 0.12)',
];

export function AISpeechParticleLayer({ amplitude, isActive, className = '' }: AISpeechParticleLayerProps) {
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
    const centerY = canvas.height * 0.25; // 더 상단으로 이동 (35% → 25%)
    const baseRadius = Math.min(canvas.width, canvas.height) * 0.16;

    particlesRef.current = Array.from({ length: PARTICLE_COUNT }, (_, i) => {
      const angle = (i / PARTICLE_COUNT) * Math.PI * 2;
      const radius = baseRadius + Math.random() * 20;
      return {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
        baseX: centerX,
        baseY: centerY,
        size: 0.5 + Math.random() * 0.5,
        baseSize: 0.5 + Math.random() * 0.5,
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
      
      // 직접 amplitude 값 사용 (이미 hook에서 smoothing됨)
      const targetAmp = amplitude;
      const currentAmp = smoothedAmpRef.current;
      
      // 빠른 반응
      if (targetAmp > currentAmp) {
        smoothedAmpRef.current = currentAmp + (targetAmp - currentAmp) * 0.5;
      } else {
        smoothedAmpRef.current = currentAmp + (targetAmp - currentAmp) * 0.15;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const centerX = canvas.width / 2;
      const centerY = canvas.height * 0.25; // 더 상단으로 이동 (35% → 25%)
      const amp = smoothedAmpRef.current;

      particlesRef.current.forEach((particle) => {
        // 방사형 펄스: amplitude에 비례해서 바깥으로 확장 (더 다이나믹하게)
        const pulseWave = Math.sin(time * 8 + particle.phase) * 0.4 + 0.6; // 속도 2배, 진폭 증가
        const radiusExpand = amp * 120 * pulseWave; // 확장 범위 1.5배 증가
        
        const currentRadius = particle.baseRadius + radiusExpand;
        
        particle.x = centerX + Math.cos(particle.angle) * currentRadius;
        particle.y = centerY + Math.sin(particle.angle) * currentRadius;

        // 크기와 투명도도 amplitude에 반응 (원래 수준으로 복원)
        const dynamicSize = particle.baseSize * (1 + amp * 2.0); // 크기 반응 증가
        const alpha = isActive ? 0.08 + amp * 0.15 : 0.03;

        ctx.beginPath();
        ctx.arc(particle.x, particle.y, dynamicSize, 0, Math.PI * 2);
        ctx.fillStyle = particle.color.replace(/[\d.]+\)$/, `${alpha})`);
        ctx.fill();
      });

      // 중심에서 퍼져나가는 파동 (amplitude 클 때만)
      if (isActive && amp > 0.15) {
        const wavePhase = (time * 2) % 1.5;
        const waveRadius = Math.min(canvas.width, canvas.height) * 0.16 * (0.6 + wavePhase * amp * 0.8);
        const waveAlpha = Math.max(0, (1 - wavePhase * 0.7) * amp * 0.04);
        
        ctx.beginPath();
        ctx.arc(centerX, centerY, waveRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(139, 92, 246, ${waveAlpha})`;
        ctx.lineWidth = 0.5;
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
