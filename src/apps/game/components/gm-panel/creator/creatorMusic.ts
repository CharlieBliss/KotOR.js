import * as KotOR from "@/apps/game/KotOR";

/**
 * Look up a track's resref by its display title in KotOR II's musictable.2da or ambientmusic.2da,
 * falling back to `fallbackResRef` when tables aren't loaded or no title matches.
 */
export function findMusicResRef(titlePattern: RegExp, fallbackResRef: string): string {
  const tables = KotOR.GameState?.TwoDAManager?.datatables;
  const tlk = KotOR.GameState?.TLKManager;
  const textOf = (strref: unknown): string => {
    const n = Number(strref);
    if (!Number.isFinite(n) || n <= 0) return '';
    try { return String(tlk?.GetStringById?.(n)?.Value || ''); } catch { return ''; }
  };

  // 1. musictable.2da (KotOR II's soundtrack jukebox table: strrefname -> filename)
  const musicTable: any = tables?.get('musictable');
  if (musicTable?.rows) {
    for (const row of Object.values(musicTable.rows) as any[]) {
      const filename = row?.filename && row.filename !== '****' ? String(row.filename).trim() : '';
      if (!filename) continue;
      if (titlePattern.test(textOf(row.strrefname))) return filename;
    }
  }

  // 2. ambientmusic.2da (area background music table: description -> resource)
  const ambientTable: any = tables?.get('ambientmusic');
  if (ambientTable?.rows) {
    for (const row of Object.values(ambientTable.rows) as any[]) {
      const resource = row?.resource && row.resource !== '****' ? String(row.resource).trim() : '';
      if (!resource) continue;
      if (titlePattern.test(textOf(row.description))) return resource;
    }
  }

  return fallbackResRef;
}

/**
 * Play a looping background track on the game's music channel while the creator is open,
 * pausing any active area/menu music and restoring it cleanly when the returned cleanup runs.
 */
export function startCreatorMusic(titlePattern: RegExp, fallbackResRef: string): () => void {
  let cancelled = false;
  let source: AudioBufferSourceNode | null = null;

  const engine = KotOR.AudioEngine?.GetAudioEngine?.();
  const areaEmitter = engine?.areaMusicDayAudioEmitter;
  const hadAreaMusic = Boolean(engine?.areaMusicLoaded && areaEmitter?.playing);
  if (hadAreaMusic) {
    try { areaEmitter.stop(); } catch { /* ignore */ }
  }

  const resRef = findMusicResRef(titlePattern, fallbackResRef);
  const loadMusic = KotOR.AudioLoader?.LoadMusic;
  if (engine?.audioCtx && typeof loadMusic === 'function') {
    Promise.resolve(loadMusic(resRef)).then((data: Uint8Array) => {
      if (cancelled || !data?.buffer) return;
      const copy = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      engine.audioCtx.decodeAudioData(copy).then((buffer: AudioBuffer) => {
        if (cancelled) return;
        const src = engine.audioCtx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        const dest = KotOR.AudioEngine?.musicChannel?.getGainNode?.() || engine.audioCtx.destination;
        src.connect(dest);
        src.start(0);
        source = src;
      }).catch(() => {});
    }).catch(() => {});
  }

  return () => {
    cancelled = true;
    if (source) {
      try { source.stop(); } catch { /* ignore */ }
      try { source.disconnect(); } catch { /* ignore */ }
      source = null;
    }
    if (hadAreaMusic && engine?.areaMusicLoaded) {
      try { areaEmitter?.play?.(); } catch { /* ignore */ }
    }
  };
}
