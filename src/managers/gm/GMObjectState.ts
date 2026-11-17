import type * as THREE from "three";
import type { GMCreatureSpawnConfig, GMPlaceableSpawnConfig, GMPlayerSpawnConfig, GMSkillGate } from "@/managers/gm/GMTypes";
import type { GMLootItem } from "@/managers/GMNetworkManager";
import type { GMNpcOrder } from "@/managers/GMNpcOrders";
import type { GMCombatStyle } from "@/managers/gm/GMCombatAI";
import type { ITwoDAAnimation } from "@/interface/twoDA/ITwoDAAnimation";

/**
 * What GM mode keeps on a world object. Merged onto ModuleObject (see the end of ModuleObject.ts), so every
 * field is optional and unset outside GM sessions.
 */
export interface GMObjectState {
  // ---- Identity and ownership
  /** Its id in the GM session, the same on the host and every player's machine */
  gmNetId?: string;
  /** The connected player who plays this character */
  gmOwnerPeerId?: string;
  /** The player character it was built as (GM-spawned player characters only) */
  gmPlayerConfig?: GMPlayerSpawnConfig;
  /** The config it was spawned from (GM-placed creatures and placeables) */
  gmSpawnConfig?: GMCreatureSpawnConfig | GMPlaceableSpawnConfig;
  /** Set while its model loads: world updates skip it until the spawn finishes */
  gmSpawning?: boolean;

  // ---- What the GM set on it
  gmBarkText?: string;
  gmScale?: number;
  /** Hidden from players: not sent to them, and not targetable */
  gmHidden?: boolean;
  /** Pinned scenery: the GM can't click, box-select, drag or Delete it in the scene (the Inspector still can) */
  gmPinned?: boolean;
  /** Using it takes this skill check first */
  gmSkillGate?: GMSkillGate;
  /** Someone passed the skill gate: it stays open */
  gmSkillGateSolved?: boolean;
  /** Its standing order (GMNpcOrders) */
  gmOrder?: GMNpcOrder;

  // ---- Replication
  /** Host: it is carrying out a player's request (the host owns its position until it finishes) */
  gmHostDriven?: boolean;
  /** Player's character: the enemy its player chose to fight (GMPlayers.keepFighting goes back to it) */
  gmFightTarget?: any;
  /** Host: the last request its player sent */
  gmIntentSeq?: number;
  /** Host: the last teleport the GM gave it (older player positions are dropped) */
  gmTeleportSeq?: number;
  /** Replica: where the host says it is; it moves there smoothly */
  gmNetTarget?: THREE.Vector3;
  /** Client: our character's combat action and queue on the host, as icons (the HUD's queue) */
  gmNetQueue?: string[];
  /** Client: whether this creature's weapons were last powered up (with the host's combat state) */
  gmNetPowered?: boolean;
  /** When this player character last rolled a skill (performance clock, ms), for GMChecks' cooldown */
  gmLastRollAt?: number;
  /** NPC: what it fights with (GMCombatAI): everything it has (default), weapons only, or plain attacks */
  gmCombatStyle?: GMCombatStyle;
  /** NPC: the GM left its behaviour to its own scripts, not the GM's AI (GMCombatAI.runsBehaviourScripts) */
  gmScripted?: boolean;
  /** NPC: a weapon swap the GM AI started, still loading items (GMCombatAI.equipWeapon) */
  gmWeaponSwap?: Promise<void>;
  /** NPC: when each combat tactic can next be used (performance clock, ms) */
  gmCombatCooldowns?: Record<string, number>;
  /** NPC: busy with a power, item or weapon swap it chose until then (performance clock, ms) */
  gmCombatActingUntil?: number;
  /** NPC: how close it was to its target, and since when (GMCombatAI.checkStuck) */
  gmCombatProgress?: { targetId: number; distance: number; since: number };
  /** NPC: no way through to anyone it could swing at; it stands ready until then (performance clock, ms) */
  gmCombatHoldUntil?: number;
  /** NPC: a target it couldn't reach, out of its melee plans until then */
  gmCombatUnreachable?: { targetId: number; until: number };
  /** NPC: how close it was to the spot its order sends it to, and since when (GMNpcOrders.arrived) */
  gmOrderProgress?: { x: number; y: number; distance: number; since: number };
  /** NPC: since when its combat round has held an action nothing will start (GMCombatAI.checkStuck) */
  gmCombatIdleSince?: number;
  /** NPC: the AI is closing its combat round itself (GMCombatAI.startFresh) */
  gmCombatClosingRound?: boolean;
  /** Replica: the animation state the host says it is in */
  gmNetAnim?: number;
  /** Replica: an animation an effect from the host is playing on it */
  gmFxAnimation?: ITwoDAAnimation;
  /** Replica: until when (performance clock, ms) that animation holds against the replica's own motion */
  gmFxUntil?: number;

  // ---- Players
  /** Host: a network player's inventory, kept as resrefs */
  gmInventory?: GMLootItem[];
  /** Down and waiting to get back up, respawn, or be revived */
  gmDowned?: { since: number; clearFor: number };
  /** Host: the last character sheet sent to its player, to send only changes */
  gmLastSheetJson?: string;
  gmLastSheetSession?: string;
  /** Equipment slots whose item is still loading */
  gmEquipLoading?: Record<string, boolean>;
}
