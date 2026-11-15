import React, { useEffect, useRef, useState } from "react";
import { gameTextureUrl } from "@/apps/game/components/gm-panel/creator/gameTexture";

/**
 * One of the game's textures as an image. It's read from the game files only once it scrolls into view, then
 * cached for every other place that shows it.
 */
export const GameImage: React.FC<{ texture: string; alt: string; className?: string }> = React.memo(({ texture, alt, className = '' }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '120px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !texture) return;
    let live = true;
    gameTextureUrl(texture).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [visible, texture]);

  return (
    <div ref={ref} className={`cc-image ${className}`} role="img" aria-label={alt}>
      {url ? <img src={url} alt="" draggable={false} /> : <span className="cc-image-empty" aria-hidden="true" />}
    </div>
  );
});
