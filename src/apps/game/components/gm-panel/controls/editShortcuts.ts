import * as KotOR from "@/apps/game/KotOR";
import { GMManager, GMHistory, GMEditTools } from "@/apps/game/components/gm-panel/gmPanelStore";

/** Two presses of a group's number this close together bring the camera to it */
const DOUBLE_TAP_MS = 350;
let lastGroupTap = { n: 0, at: 0 };

/** Delete the selection (not characters players are playing), as one undoable step */
export function deleteSelection(list: KotOR.ModuleObject[] = GMManager.selectedObjects()): number {
  const doomed = list.filter((o) => GMManager.isDeletable(o));
  if (!doomed.length) return 0;
  return GMHistory.track(`Delete ${GMHistory.nameOf(doomed)}`, doomed, () => GMManager.deleteObjects(doomed));
}

/**
 * The GM's editing keys in the free camera's select mode. Returns true when the key was one of them (the
 * caller stops it going on to the game).
 *  - Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z): undo, redo
 *  - Ctrl+C, Ctrl+V (at the mouse), Ctrl+D: copy, paste, duplicate
 *  - Ctrl+A: every creature on screen; Esc: select nothing
 *  - Delete: delete the selection
 *  - Ctrl+1..9: save the selection as a group; 1..9: select it (Shift: add it), twice: go to it
 *  - F: bring the camera to the selection
 */
export function editShortcut(e: KeyboardEvent): boolean {
  if (!KotOR.GameState.gmMode || !GMManager.isGMUser()) return false;
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  // Undo and redo work with any tool
  if (ctrl && key === 'z' && !e.shiftKey) { void GMHistory.undo(); return true; }
  if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) { void GMHistory.redo(); return true; }

  if (GMManager.activeTool !== 'select' || GMManager.controlMode === 'POSSESS') return false;
  const selection = GMManager.selectedObjects();

  if (e.key === 'Escape' && selection.length) { GMManager.setSelection([]); return true; }
  if (e.key === 'Delete') { deleteSelection(selection); return true; }
  if (ctrl && key === 'c') { GMEditTools.copy(selection); return true; }
  if (ctrl && key === 'v') { void GMEditTools.paste(); return true; }
  if (ctrl && key === 'd') { void GMEditTools.duplicate(selection); return true; }
  if (ctrl && key === 'a') { GMManager.setSelection(GMEditTools.creaturesInView()); return true; }
  if (!ctrl && !e.altKey && e.code === 'KeyF') { GMEditTools.focusCamera(selection); return true; }

  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit && !e.altKey) {
    const n = Number(digit[1]);
    if (ctrl) { GMEditTools.saveGroup(n, selection); return true; }
    const now = performance.now();
    const twice = lastGroupTap.n === n && now - lastGroupTap.at < DOUBLE_TAP_MS;
    lastGroupTap = { n, at: now };
    const members = GMEditTools.recallGroup(n, e.shiftKey);
    if (twice && members.length) GMEditTools.focusCamera(members);
    return members.length > 0;
  }
  return false;
}

/** Every editing control, for the Inspector's key list */
export const EDIT_SHORTCUT_HINTS: [string, string][] = [
  ['Click / Shift + click', 'select / add or take out'], ['Shift + drag', 'select with a box'], ['Ctrl + A', 'creatures on screen'],
  ['Esc', 'select nothing'], ['Drag it', 'move (the selection)'], ['Alt + drag', 'raise an object'],
  ['Shift or Ctrl + wheel', 'turn each'], ['Ctrl + Shift + wheel', 'turn the group'], ['Delete', 'remove'],
  ['Ctrl + Z / Y', 'undo / redo'], ['Ctrl + C / V / D', 'copy / paste at mouse / duplicate'],
  ['Ctrl + 1–9', 'save group'], ['1–9', 'select group (twice: go to it)'], ['F', 'go to the selection'],
];
