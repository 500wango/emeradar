import React from 'react';

interface LogoProps {
  variant?: 'header' | 'full' | 'icon';
  className?: string;
  idPrefix?: string;
}

export function Logo({
  variant = 'header',
  className = 'h-8 w-auto',
  idPrefix = 'emeradar',
}: LogoProps) {
  const iconGradId = `${idPrefix}-icon-grad`;
  const emeGradId = `${idPrefix}-eme-grad`;

  // Variant: Just the rising gradient icon
  if (variant === 'icon') {
    return (
      <svg
        viewBox="45 55 265 215"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        role="img"
        aria-label="EmeRadar Icon"
      >
        <defs>
          <linearGradient
            id={iconGradId}
            x1="60"
            y1="230"
            x2="300"
            y2="70"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#7C3AED" />
            <stop offset="35%" stopColor="#2563EB" />
            <stop offset="68%" stopColor="#06B6D4" />
            <stop offset="100%" stopColor="#34D399" />
          </linearGradient>
        </defs>

        <path
          d="M58 205 Q58 193 69 188 L115 166 Q128 160 128 174 L128 230 Q128 239 119 243 L73 260 Q58 265 58 249 Z"
          fill={`url(#${iconGradId})`}
        />
        <path
          d="M138 159 Q138 148 149 142 L213 109 Q227 102 227 118 L227 211 Q227 221 218 226 L155 258 Q138 266 138 248 Z"
          fill={`url(#${iconGradId})`}
        />
        <path
          d="M230 101 L286 72 Q299 65 299 80 L299 151 Q299 159 292 164 L254 190 Q242 198 242 183 L242 125 L218 125 Q204 125 214 114 Z"
          fill={`url(#${iconGradId})`}
        />
      </svg>
    );
  }

  // Variant: Full Logo with Tagline (Hero section, marketing pages)
  if (variant === 'full') {
    return (
      <svg
        viewBox="20 20 860 220"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        role="img"
        aria-labelledby={`${idPrefix}-title ${idPrefix}-desc`}
      >
        <title id={`${idPrefix}-title`}>EmeRadar</title>
        <desc id={`${idPrefix}-desc`}>
          EmeRadar — Find markets before they get crowded.
        </desc>

        <defs>
          <linearGradient
            id={iconGradId}
            x1="60"
            y1="230"
            x2="300"
            y2="70"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#7C3AED" />
            <stop offset="35%" stopColor="#2563EB" />
            <stop offset="68%" stopColor="#06B6D4" />
            <stop offset="100%" stopColor="#34D399" />
          </linearGradient>

          <linearGradient
            id={emeGradId}
            x1="200"
            y1="60"
            x2="500"
            y2="160"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#06B6D4" />
            <stop offset="45%" stopColor="#2563EB" />
            <stop offset="100%" stopColor="#7C3AED" />
          </linearGradient>
        </defs>

        {/* Scaled Icon (55% scale, optically aligned) */}
        <g transform="translate(30, 18) scale(0.55)">
          <path
            d="M58 205 Q58 193 69 188 L115 166 Q128 160 128 174 L128 230 Q128 239 119 243 L73 260 Q58 265 58 249 Z"
            fill={`url(#${iconGradId})`}
          />
          <path
            d="M138 159 Q138 148 149 142 L213 109 Q227 102 227 118 L227 211 Q227 221 218 226 L155 258 Q138 266 138 248 Z"
            fill={`url(#${iconGradId})`}
          />
          <path
            d="M230 101 L286 72 Q299 65 299 80 L299 151 Q299 159 292 164 L254 190 Q242 198 242 183 L242 125 L218 125 Q204 125 214 114 Z"
            fill={`url(#${iconGradId})`}
          />
        </g>

        {/* Contiguous Wordmark */}
        <text
          x="215"
          y="140"
          fontFamily="Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif"
          fontSize="102"
          fontWeight="800"
          letterSpacing="-5"
        ><tspan fill={`url(#${emeGradId})`}>Eme</tspan><tspan fill="#0F172A">Radar</tspan></text>

        {/* Slogan */}
        <text
          x="218"
          y="185"
          fontFamily="Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif"
          fontSize="26"
          fontWeight="500"
          letterSpacing="0"
          fill="#64748B"
        >
          Find markets before they get crowded.
        </text>
      </svg>
    );
  }

  // Variant: Header (Optimal for Navbar / Footer, cropped tightly with balanced proportions)
  return (
    <svg
      viewBox="25 25 690 145"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="EmeRadar"
    >
      <defs>
        <linearGradient
          id={iconGradId}
          x1="60"
          y1="230"
          x2="300"
          y2="70"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#7C3AED" />
          <stop offset="35%" stopColor="#2563EB" />
          <stop offset="68%" stopColor="#06B6D4" />
          <stop offset="100%" stopColor="#34D399" />
        </linearGradient>

        <linearGradient
          id={emeGradId}
          x1="200"
          y1="60"
          x2="500"
          y2="160"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#06B6D4" />
          <stop offset="45%" stopColor="#2563EB" />
          <stop offset="100%" stopColor="#7C3AED" />
        </linearGradient>
      </defs>

      {/* Scaled Icon (Option A) */}
      <g transform="translate(30, 18) scale(0.55)">
        <path
          d="M58 205 Q58 193 69 188 L115 166 Q128 160 128 174 L128 230 Q128 239 119 243 L73 260 Q58 265 58 249 Z"
          fill={`url(#${iconGradId})`}
        />
        <path
          d="M138 159 Q138 148 149 142 L213 109 Q227 102 227 118 L227 211 Q227 221 218 226 L155 258 Q138 266 138 248 Z"
          fill={`url(#${iconGradId})`}
        />
        <path
          d="M230 101 L286 72 Q299 65 299 80 L299 151 Q299 159 292 164 L254 190 Q242 198 242 183 L242 125 L218 125 Q204 125 214 114 Z"
          fill={`url(#${iconGradId})`}
        />
      </g>

      {/* Contiguous Wordmark */}
      <text
        x="215"
        y="140"
        fontFamily="Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif"
        fontSize="102"
        fontWeight="800"
        letterSpacing="-5"
      ><tspan fill={`url(#${emeGradId})`}>Eme</tspan><tspan fill="#0F172A">Radar</tspan></text>
    </svg>
  );
}
