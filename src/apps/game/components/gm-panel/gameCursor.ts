import { gameTextureUrl } from "@/apps/game/components/gm-panel/creator/gameTexture";

/**
 * The game's own cursor over the page's layers (the GM panel, cards, the creator, the sheet). The game draws its
 * cursor in the canvas, which those layers cover; the page cursor is hidden (app.scss). So the page cursor
 * becomes the game's cursor images: --game-cursor, --game-cursor-select (over something to click) and
 * --game-cursor-down (pressed), used by gm-cursor.scss once <html> has the game-cursor class.
 */
const CURSORS: [string, string][] = [
  ['--game-cursor', 'gui_mp_defaultu'],
  ['--game-cursor-down', 'gui_mp_defaultd'],
  ['--game-cursor-select', 'gui_mp_selectu'],
];

let installing: Promise<boolean> | null = null;

/** Read the cursor images and turn the game cursor on for page layers (once; true when it's on) */
export function installGameCursor(): Promise<boolean> {
  if (!installing) {
    installing = (async () => {
      const urls = await Promise.all(CURSORS.map(([, texture]) => gameTextureUrl(texture)));
      if (!urls[0]) return false;
      const root = document.documentElement;
      CURSORS.forEach(([variable], i) => {
        // The hotspot is the image's top-left corner, where the game puts the pointer
        root.style.setProperty(variable, `url("${urls[i] || urls[0]}") 0 0, none`);
      });
      root.classList.add('game-cursor');
      return true;
    })().catch(() => false).then((ok) => {
      if (!ok) installing = null;
      return ok;
    });
  }
  return installing;
}
