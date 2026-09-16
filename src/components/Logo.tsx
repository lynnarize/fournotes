// Four Notes logo: red "4" over a black "N" with a red dot.
// Vector trace of the brand artwork; the "N" uses --logo-ink so it stays
// visible in dark mode.

export default function Logo({ size = 32, className = "", title }: { size?: number; className?: string; title?: string }) {
  return (
    <svg
      viewBox="113 140 1000 1000"
      width={size}
      height={size}
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <polygon points="535,375 625,375 985,898 988,378 1073,378 1075,1012 950,1012 601,493 601,1012 535,1012" fill="var(--logo-ink)" />
      <path fill="var(--logo-red)" fillRule="evenodd" d="M460 375H535V795H631V867H535V1012H450V870H145V795Z M452 500L450 795H232Z" />
      <circle cx="1031" cy="318" r="50" fill="var(--logo-red)" />
    </svg>
  );
}
