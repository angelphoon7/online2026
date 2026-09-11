"use client";

import React from 'react';
import Image from 'next/image';
import ticketImg from '@/lib/ticket-darkblue.png';

interface AnimatedTicketIconProps {
  className?: string;
}

export default function AnimatedTicketIcon({ className = '' }: AnimatedTicketIconProps) {
  return (
    <div className={`ticket-icon-container ${className}`}>
      {/* Motion wrapper that moves subtly in sync with the glowing light wave */}
      <div className="ticket-motion-wrapper">
        {/* Base Exact Ticket Image */}
        <div className="ticket-base">
          <Image
            src={ticketImg}
            alt="Reshuffle Ticket Icon"
            width={610}
            height={380}
            priority
            className="ticket-img"
          />
        </div>

        {/* Glow Layer: Strictly Masked to the Ticket Shape */}
        <div className="ticket-glow-mask">
          {/* Luminous light wave that glides along the ticket from left to right, then right to left */}
          <div className="ticket-light-wave" />

          {/* High-brightness ticket overlay that lights up as the wave passes over */}
          <div className="ticket-bright-pass">
            <Image
              src={ticketImg}
              alt=""
              width={610}
              height={380}
              priority
              aria-hidden="true"
              className="ticket-bright-img"
            />
          </div>
        </div>
      </div>

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

        /* Ticket moves slightly in sync with the ping-pong light glow */
        .ticket-motion-wrapper {
          position: relative;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          transform-origin: center center;
          will-change: transform;
          animation: ticketSwayPingPong 4.8s ease-in-out infinite;
        }

        .ticket-base {
          position: relative;
          width: 100%;
          line-height: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .ticket-img {
          width: 100%;
          height: auto;
          display: block;
          object-fit: contain;
          user-select: none;
          pointer-events: none;
          /* Rich, saturated color grading */
          filter: saturate(1.35) contrast(1.12);
        }

        /* The Mask: strictly confines all glowing effects to the ticket silhouette */
        .ticket-glow-mask {
          position: absolute;
          inset: 0;
          pointer-events: none;
          -webkit-mask-image: url(/ticket-mask.png);
          mask-image: url(/ticket-mask.png);
          -webkit-mask-size: 100% 100%;
          mask-size: 100% 100%;
          -webkit-mask-repeat: no-repeat;
          mask-repeat: no-repeat;
          overflow: hidden;
        }

        /* Soft, gentle light wave moving across the ticket from left to right, then right to left */
        .ticket-light-wave {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 38%;
          pointer-events: none;
          mix-blend-mode: screen;
          background: linear-gradient(
            90deg,
            rgba(255, 255, 255, 0) 0%,
            rgba(217, 70, 239, 0.22) 28%,
            rgba(255, 255, 255, 0.45) 50%,
            rgba(56, 189, 248, 0.3) 72%,
            rgba(255, 255, 255, 0) 100%
          );
          filter: blur(10px);
          animation: lightWavePingPong 4.8s ease-in-out infinite;
        }

        /* Subtle brightness boost that preserves deep color richness */
        .ticket-bright-pass {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          mix-blend-mode: screen;
          -webkit-mask-image: linear-gradient(
            90deg,
            transparent 0%,
            rgba(0, 0, 0, 0.8) 50%,
            transparent 100%
          );
          mask-image: linear-gradient(
            90deg,
            transparent 0%,
            rgba(0, 0, 0, 0.8) 50%,
            transparent 100%
          );
          -webkit-mask-size: 40% 100%;
          mask-size: 40% 100%;
          -webkit-mask-repeat: no-repeat;
          mask-repeat: no-repeat;
          animation: brightMaskPingPong 4.8s ease-in-out infinite;
        }

        .ticket-bright-img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          /* Gentle brightness lift without washing out colors */
          filter: brightness(1.28) contrast(1.1) saturate(1.5);
        }

        /* Ping-pong animation: left to right, then right to left (gentle, elegant glow) */
        @keyframes lightWavePingPong {
          0% {
            left: -35%;
            opacity: 0.08;
          }
          12% {
            opacity: 0.55;
          }
          45% {
            opacity: 0.55;
          }
          50% {
            left: 95%;
            opacity: 0.08;
          }
          58% {
            opacity: 0.55;
          }
          90% {
            opacity: 0.55;
          }
          100% {
            left: -35%;
            opacity: 0.08;
          }
        }

        @keyframes brightMaskPingPong {
          0% {
            -webkit-mask-position: -35% 0;
            mask-position: -35% 0;
            opacity: 0.08;
          }
          12% {
            opacity: 0.55;
          }
          45% {
            opacity: 0.55;
          }
          50% {
            -webkit-mask-position: 130% 0;
            mask-position: 130% 0;
            opacity: 0.08;
          }
          58% {
            opacity: 0.55;
          }
          90% {
            opacity: 0.55;
          }
          100% {
            -webkit-mask-position: -35% 0;
            mask-position: -35% 0;
            opacity: 0.08;
          }
        }

        /* Subtle 2D swaying and floating in exact rhythm with the ping-pong glow */
        @keyframes ticketSwayPingPong {
          0% {
            transform: translate3d(-4px, 0px, 0) rotate(-0.8deg);
          }
          25% {
            transform: translate3d(0px, -6px, 0) rotate(0deg);
          }
          50% {
            transform: translate3d(4px, 0px, 0) rotate(0.8deg);
          }
          75% {
            transform: translate3d(0px, -6px, 0) rotate(0deg);
          }
          100% {
            transform: translate3d(-4px, 0px, 0) rotate(-0.8deg);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .ticket-motion-wrapper,
          .ticket-light-wave,
          .ticket-bright-pass {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
