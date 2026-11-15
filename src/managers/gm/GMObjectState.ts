import type * as THREE from "three";
import type { GMCreatureSpawnConfig, GMPlaceableSpawnConfig, GMPlayerSpawnConfig, GMSkillGate } from "@/managers/gm/GMTypes";
import type { GMLootItem } from "@/managers/GMNetworkManager";
import type { GMNpcOrder } from "@/managers/GMNpcOrders";
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
  /** Using it takes this skill check first */
  gmSkillGate?: GMSkillGate;
  /** Someone passed the skill gate: it stays open */
  gmSkillGateSolved?: boolean;
  /** Its standing order (GMNpcOrders) */
  gmOrder?: GMNpcOrder;

  // ---- Replication
  /** Host: it is carrying out a player's request (the host owns its position until it finishes) */
  gmHostDriven?: boolean;
  /** Host: the last request its player sent */
  gmIntentSeq?: number;
  /** Host: the last teleport the GM gave it (older player positions are dropped) */
  gmTeleportSeq?: number;
  /** Replica: where the host says it is; it moves there smoothly */
  gmNetTarget?: THREE.Vector3;
  /** When this player character last rolled a skill (performance clock, ms), for GMChecks' cooldown */
  gmLastRollAt?: number;
  /** Replica: the animation state the host says it is in */
  gmNetAnim?: number;
  /** Replica: an animation an effect from the host is playing on it */
  gmFxAnimation?: ITwoDAAnimation;

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
