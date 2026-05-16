import type { Theme } from '@/lib/theme';

interface ThemeToggleProps {
  theme: Theme;
  onToggle: () => void;
}

export function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  return (
    <button
      onClick={onToggle}
      className="relative flex h-7 w-14 items-center rounded-full border border-border-subtle bg-dark-surface p-0.5 transition-colors duration-200"
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label="Toggle theme"
    >
      {/* Sun icon (left) */}
      <svg
        className="absolute left-1.5 h-3.5 w-3.5 text-amber-400"
        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
      </svg>
      {/* Moon icon (right) */}
      <svg
        className="absolute right-1.5 h-3.5 w-3.5 text-accent"
        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
      </svg>
      {/* Sliding knob */}
      <span
        className="h-5 w-5 rounded-full bg-content-primary shadow transition-transform duration-200"
        style={{ transform: theme === 'dark' ? 'translateX(28px)' : 'translateX(0px)' }}
      />
    </button>
  );
}
