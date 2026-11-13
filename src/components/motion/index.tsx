'use client';

// Small, dependency-free motion helpers. All of them respect prefers-reduced-motion via globals.css.
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/** Fades and lifts its children into view the first time they scroll on screen. */
export function Reveal({
  children,
  delay = 0,
  className,
  as: Tag = 'div',
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  as?: 'div' | 'section' | 'li';
}) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag
      ref={ref as React.RefObject<never>}
      data-visible={visible}
      className={cn('reveal', className)}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}

/** Card wrapper whose green spotlight follows the pointer (see .spotlight in globals.css). */
export function Spotlight({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn('spotlight', className)}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
        props.onPointerMove?.(e);
      }}
    >
      {children}
    </div>
  );
}

/** Animates a number up from zero when it first renders (or changes). */
export function CountUp({ value, format, duration = 900 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      setShown(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{format ? format(shown) : Math.round(shown).toLocaleString('en-GB')}</>;
}

/** Cycles through words with a blur-and-rise transition. */
export function RotatingWords({
  words,
  interval = 2600,
  className,
  wordClassName,
}: {
  words: string[];
  interval?: number;
  className?: string;
  /** Applied to the animated word itself (e.g. gradient text, which must sit on the transformed element). */
  wordClassName?: string;
}) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setI((n) => (n + 1) % words.length), interval);
    return () => clearInterval(id);
  }, [words.length, interval]);
  return (
    <span className={cn('relative inline-block', className)}>
      <span key={i} className={cn('inline-block animate-word-in', wordClassName)}>
        {words[i]}
      </span>
    </span>
  );
}
