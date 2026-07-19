/**
 * The refynr mark — a symmetric pulse of bars and dots (data being refined),
 * teal→cyan gradient. Inline SVG so it scales crisply at any size and needs
 * no asset request. `userSpaceOnUse` on the gradient is required: an
 * objectBoundingBox gradient can't paint vertical lines (zero-width bbox).
 */
export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient
          id="refynr-mark"
          x1="24"
          y1="10"
          x2="24"
          y2="38"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#3ce8b6" />
          <stop offset="1" stopColor="#21d4ee" />
        </linearGradient>
      </defs>
      <g stroke="url(#refynr-mark)" strokeWidth="3.4" strokeLinecap="round">
        <line x1="24" y1="11" x2="24" y2="37" />
        <line x1="19" y1="17" x2="19" y2="32.5" />
        <line x1="29" y1="17" x2="29" y2="32.5" />
        <line x1="14" y1="19" x2="14" y2="30.5" />
        <line x1="34" y1="19" x2="34" y2="30.5" />
      </g>
      <g fill="url(#refynr-mark)">
        <circle cx="19" cy="12.5" r="1.7" />
        <circle cx="29" cy="12.5" r="1.7" />
        <circle cx="19" cy="37" r="1.7" />
        <circle cx="29" cy="37" r="1.7" />
        <circle cx="9.5" cy="21.5" r="1.7" />
        <circle cx="9.5" cy="27" r="1.7" />
        <circle cx="38.5" cy="21.5" r="1.7" />
        <circle cx="38.5" cy="27" r="1.7" />
      </g>
    </svg>
  );
}
