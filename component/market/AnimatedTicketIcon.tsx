"use client";

import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import ticketImg from '@/lib/ticket-darkblue.png';

interface AnimatedTicketIconProps {
  className?: string;
}

export default function AnimatedTicketIcon({ className = '' }: AnimatedTicketIconProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Check user preference for reduced motion
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let isCancelled = false;

    // Load base ticket asset and mask
    const img = new window.Image();
    img.src = '/ticket-darkblue.png?v=21';
    const mask = new window.Image();
    mask.src = '/ticket-mask.png?v=21';

    let loadedCount = 0;
    const onAssetLoad = () => {
      loadedCount++;
      if (loadedCount === 2 && !isCancelled) {
        startAnimation();
      }
    };

    img.onload = onAssetLoad;
    mask.onload = onAssetLoad;

    function startAnimation() {
      if (!canvas || !ctx) return;
      setIsReady(true);

      // Pre-render base canvas strictly using transparent ticket ribbon
      const baseCanvas = document.createElement('canvas');
      baseCanvas.width = 610;
      baseCanvas.height = 380;
      const baseCtx = baseCanvas.getContext('2d');
      if (baseCtx) {
        baseCtx.drawImage(img, 0, 0);
        baseCtx.globalCompositeOperation = 'destination-in';
        baseCtx.drawImage(mask, 0, 0);
        baseCtx.globalCompositeOperation = 'source-over';
      }

      // Pre-render bright canvas strictly using transparent ticket ribbon
      const brightCanvas = document.createElement('canvas');
      brightCanvas.width = 610;
      brightCanvas.height = 380;
      const bCtx = brightCanvas.getContext('2d');
      if (bCtx) {
        bCtx.filter = 'brightness(1.15) contrast(1.04) saturate(1.05)';
        bCtx.drawImage(img, 0, 0);
        bCtx.filter = 'none';
        bCtx.globalCompositeOperation = 'destination-in';
        bCtx.drawImage(mask, 0, 0);
        bCtx.globalCompositeOperation = 'source-over';
      }

      // Pre-render luminous crimson/coral sheen canvas strictly masked to the ticket ribbon
      const tintCanvas = document.createElement('canvas');
      tintCanvas.width = 610;
      tintCanvas.height = 380;
      const tCtx = tintCanvas.getContext('2d');
      if (tCtx) {
        tCtx.drawImage(img, 0, 0);
        tCtx.globalCompositeOperation = 'source-in';
        const grad = tCtx.createLinearGradient(120, 0, 480, 0);
        grad.addColorStop(0, 'rgba(254, 215, 170, 0.25)');   // radiant golden light crest on ridge
        grad.addColorStop(0.35, 'rgba(239, 68, 68, 0.35)');  // vivid crimson-scarlet luster
        grad.addColorStop(1, 'rgba(225, 29, 72, 0.42)');     // deep ruby-wine sheen on right
        tCtx.fillStyle = grad;
        tCtx.fillRect(0, 0, 610, 380);
      }

      const SLICE_W = 1; // 1px vertical slices for fluid, artifact-free wave deformation
      const totalSlices = Math.ceil(canvas.width / SLICE_W);
      const startTime = performance.now();

      function render(now: number) {
        if (isCancelled || !canvas || !ctx) return;
        const time = (now - startTime) * 0.001;

        // Slower, calmer ping-pong cycle: 7.2s (slow, luxurious gliding glow)
        const cycle = (time / 7.2) % 1.0;
        const pingpong = 0.5 - 0.5 * Math.cos(cycle * 2.0 * Math.PI);
        const glowX = 0.18 + 0.64 * pingpong;

        // Clear canvas with transparency so the background dot grid fills all around the ribbon
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Render ticket slice-by-slice: gentle, slow, non-vibrating wave motion
        for (let i = 0; i < totalSlices; i++) {
          const sx = i * SLICE_W;
          const normX = sx / canvas.width;

          // Edge damping ensures the outer padding remains completely still
          const edgeDamp = Math.max(0, Math.min(1, (normX - 0.04) / 0.14)) *
                           Math.max(0, Math.min(1, (0.96 - normX) / 0.14));

          // 1. Broad, gentle wave crest that glides slowly with the glow (zero high-frequency vibration)
          const dist = normX - glowX;
          const glowPulse = -Math.cos(dist * Math.PI * 2.2) * Math.exp(-dist * dist * 18.0) * 4.8;

          // 2. Slow, broad harmonic ocean-like undulation across the ticket (single gentle curve, slow 7s period)
          const harmonic = Math.sin(normX * Math.PI * 1.3 - time * 0.9) * 3.2;

          // Combined gentle wave displacement
          const dy = (glowPulse + harmonic) * edgeDamp;

          // Draw base ribbon slice
          ctx.drawImage(baseCanvas, sx, 0, SLICE_W, canvas.height, sx, dy, SLICE_W, canvas.height);

          // If glow is near this slice, composite the glowing wave highlights
          const absDist = Math.abs(dist);
          if (absDist < 0.18) {
            const glowIntensity = Math.pow(1 - absDist / 0.18, 1.8);

            // Draw bright pass on the wave crest
            ctx.globalAlpha = glowIntensity * 0.75;
            ctx.globalCompositeOperation = 'screen';
            ctx.drawImage(brightCanvas, sx, 0, SLICE_W, canvas.height, sx, dy, SLICE_W, canvas.height);

            // Draw luminous tint pass on the wave crest
            ctx.globalAlpha = glowIntensity * 0.45;
            ctx.drawImage(tintCanvas, sx, 0, SLICE_W, canvas.height, sx, dy, SLICE_W, canvas.height);

            ctx.globalAlpha = 1.0;
            ctx.globalCompositeOperation = 'source-over';
          }
        }

        animId = requestAnimationFrame(render);
      }

      animId = requestAnimationFrame(render);
    }

    return () => {
      isCancelled = true;
      if (animId) cancelAnimationFrame(animId);
    };
  }, []);

  return (
    <div className={`ticket-icon-container ${className}`}>
      {/* Fallback image for SSR / initial paint / reduced motion */}
      <div className={`ticket-fallback ${isReady ? 'hidden' : ''}`}>
        <Image
          src={ticketImg}
          alt="Reshuffle Ticket Icon"
          width={610}
          height={380}
          priority
          className="ticket-img"
        />
      </div>

      {/* Dynamic 2D Wave Canvas */}
      <canvas
        ref={canvasRef}
        width={610}
        height={380}
        className={`ticket-wave-canvas ${isReady ? 'visible' : ''}`}
        aria-label="Reshuffle Ticket Icon"
      />

      <style jsx>{`
        .ticket-icon-container {
          position: relative;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          overflow: visible;
        }

        .ticket-fallback {
          position: relative;
          width: 100%;
          line-height: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: opacity 0.3s ease;
        }

        .ticket-fallback.hidden {
          opacity: 0;
          pointer-events: none;
          position: absolute;
          inset: 0;
        }

        .ticket-img {
          width: 100%;
          height: auto;
          display: block;
          object-fit: contain;
          user-select: none;
          pointer-events: none;
          mask-image: url('/ticket-mask.png?v=16');
          mask-size: 100% 100%;
          -webkit-mask-image: url('/ticket-mask.png?v=16');
          -webkit-mask-size: 100% 100%;
          filter: drop-shadow(0 0 22px rgba(225, 29, 72, 0.22));
        }

        .ticket-wave-canvas {
          width: 100%;
          height: auto;
          max-width: 100%;
          display: block;
          opacity: 0;
          transition: opacity 0.3s ease;
          user-select: none;
          pointer-events: none;
          filter: drop-shadow(0 0 22px rgba(225, 29, 72, 0.22));
        }

        .ticket-wave-canvas.visible {
          opacity: 1;
        }

        @media (prefers-reduced-motion: reduce) {
          .ticket-fallback {
            opacity: 1 !important;
            position: relative !important;
          }
          .ticket-wave-canvas {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
