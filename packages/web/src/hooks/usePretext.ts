// usePretext — measure variable-height text using Pretext before DOM render.
//
// Used in: ChatMessage feed, execution log viewer, event timeline.
// Call only after document.fonts.ready resolves to ensure font metrics are correct.

import { prepare, layout } from '@chenglou/pretext';
import { useState, useEffect, useRef } from 'react';

export function usePretext(text: string, font: string, lineHeight: number) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const preparedRef = useRef(prepare(text, font));

  useEffect(() => {
    preparedRef.current = prepare(text, font);
  }, [text, font]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const width = entry.contentRect.width;
      const result = layout(preparedRef.current, width, lineHeight);
      setHeight(result.height);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [lineHeight]);

  return { containerRef, height };
}
