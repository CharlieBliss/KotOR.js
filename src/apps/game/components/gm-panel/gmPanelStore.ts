import { useEffect, useReducer } from "react";
import * as KotOR from "@/apps/game/KotOR";

// The engine library's single GM managers, via the KotOR external (importing them directly would bundle a
// second copy of the whole engine into game.js)
export const {
  GMManager, GMNetworkManager, GMConversationManager, GMNpcOrders,
  GMChecks, GMMines, GMSetPieces, GMRoomNames, GMPlayers, GMSessions, GMSpawner, GMViewport, GMHistory, GMEditTools, GMAtmosphere,
} = KotOR;

/** The GM panel's drawer tabs (null: the drawer is closed) */
export type DrawerTab = 'scenes' | 'actors' | 'players' | 'inspector' | 'multiplayer' | null;

/** How often the panel redraws while GM mode runs, for what changes without an event (HP, positions...) */
const POLL_MS = 350;

const listeners = new Set<() => void>();
let wired = false;
let pollExtra = false;

/** Redraw every part of the GM panel that is showing */
export function refreshPanel() {
  listeners.forEach((listener) => listener());
}

/** Keep polling outside GM mode too (the main menu's join card shows the join's progress) */
export function setPanelPolling(on: boolean) {
  pollExtra = on;
}

function wire() {
  if (wired) return;
  wired = true;
  GMManager.events.addEventListener('change', refreshPanel);
  GMNetworkManager.events.addEventListener('change', refreshPanel);
  setInterval(() => {
    if (KotOR.GameState.gmMode || pollExtra) refreshPanel();
  }, POLL_MS);
}

/**
 * Redraw this component when the GM managers change and on the panel's poll. A hidden tab passes
 * active = false: it keeps its state but skips redraws until it shows again.
 */
export function useGMStore(active: boolean = true): () => void {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    wire();
    if (!active) return;
    listeners.add(bump);
    return () => { listeners.delete(bump); };
  }, [active]);
  return refreshPanel;
}

/** What "Play as" and F2 would take control of: the selected creature, the party leader, or the first player */
export function possessCandidate(): KotOR.ModuleCreature | null {
  const selected = GMManager.selectedObject;
  if (selected && KotOR.GMObjectKind.isCreature(selected)) return selected;
  return KotOR.GameState.getCurrentPlayer() || GMManager.spawnedPlayers[0] || null;
}
