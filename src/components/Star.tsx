/** Claude's sunburst asterisk mark. */
export default function Star({ size = 20, className = "" }: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M12 2.5v19M2.5 12h19M5.28 5.28l13.44 13.44M18.72 5.28L5.28 18.72"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
