import { GMFaction, gmItemResRef } from "@/managers/gm/GMVocab";
import { GMObjectKind } from "@/managers/gm/GMObjectKind";
import * as THREE from "three";
import { GameState } from "@/GameState";
import { ModuleCreatureArmorSlot } from "@/enums/module/ModuleCreatureArmorSlot";
import { ModuleCreatureAnimState } from "@/enums/module/ModuleCreatureAnimState";
import { ModuleDoorOpenState } from "@/enums/module/ModuleDoorOpenState";
import { ModuleObject, ModuleCreature, ModulePlaceable, ModuleDoor, ModuleItem } from "@/module";
import { OdysseyModelAnimation } from "@/odyssey";
import { TextSprite3D } from "@/engine/TextSprite3D";
import type { ITwoDAAnimation } from "@/interface/twoDA/ITwoDAAnimation";
import type { GameEffect } from "@/effects/GameEffect";
import { GameEffectDurationType } from "@/enums/effects/GameEffectDurationType";
import { GameEffectType } from "@/enums/effects/GameEffectType";
import {
  GMNetworkManager,
  GMSerializedActor,
  GMSerializedDoorState,
  GMWorldSnapshot,
  GMFxEvent,
} from "@/managers/GMNetworkManager";
import { GMManager } from "@/managers/GMManager";
import { GMSpawner } from "@/managers/gm/GMSpawner";
import { GMPlayers } from "@/managers/gm/GMPlayers";
import { GMMines } from "@/managers/gm/GMMines";
import { GMAtmosphere } from "@/managers/gm/GMAtmosphere";

/** Keeping players' games in step with the GM's: serializing the world, applying it on clients, smoothing replica motion and mirroring the host's visuals. */
export class GMReplication {
  // Network actors whose spawn is still loading, so repeated ticks don't spawn duplicates
  static pendingNetSpawns: Set<string> = new Set();

  // Replica motion smoothing (higher = snappier) and the distance beyond which we teleport instead
  static NET_SMOOTHING: number = 12;

  static NET_SNAP_DISTANCE: number = 6;

  // Animation states set alongside a replayed 2DA animation (see applyFxEventOnClient)
  static FX_DRIVEN_ANIM_STATES: number[] = [
    ModuleCreatureAnimState.ATTACK,
    ModuleCreatureAnimState.DAMAGE,
    ModuleCreatureAnimState.DODGE,
    ModuleCreatureAnimState.PARRY,
  ];

  /**
   * Client: the GM teleported a character. Our own character is moved here, since we normally ignore the
   * host's position for it; anyone else's just snaps.
   */
  static applyTeleportOnClient(payload: { netId: string; x: number; y: number; z: number; seq?: number }) {
    const obj = GMManager.netIdMap.get(payload.netId);
    if (!obj) return;
    GMManager.placeAt(obj, new THREE.Vector3(payload.x, payload.y, payload.z));
    if (payload.netId === GMNetworkManager.assignedActorNetId) {
      GMNetworkManager.teleportSeq = Math.max(GMNetworkManager.teleportSeq, payload.seq || 0);
      GMNetworkManager.awaitingHost = false;
    }
    GMManager.notifyChange();
  }

  static serializeSingleActor(obj: ModuleObject): GMSerializedActor {
    const netId = obj.gmNetId || GMManager.getNextNetId('obj');
    if (!obj.gmNetId) {
      GMManager.registerNetObject(netId, obj);
    }

    const isPlayer = GMObjectKind.isPlayer(obj) || GameState.PartyManager.party.includes(obj as ModuleCreature);
    const isPlaceable = GMObjectKind.isPlaceable(obj);
    const kind: 'creature' | 'player' | 'placeable' = isPlaceable ? 'placeable' : (isPlayer ? 'player' : 'creature');

    const { rightHandResRef, leftHandResRef, armorResRef } = isPlaceable
      ? { rightHandResRef: '', leftHandResRef: '', armorResRef: '' }
      : GMSpawner.gearOf(obj as ModuleCreature);

    return {
      netId,
      kind,
      ownerPeerId: obj.gmOwnerPeerId,
      templateResRef: obj.gmSpawnConfig?.templateResRef || obj.getTemplateResRef() || '',
      appearanceId: obj.appearance || 0,
      name: obj.getName() || (obj as ModuleCreature).firstName || 'Actor',
      tag: obj.getTag() || '',
      factionId: obj.factionId ?? GMFaction.FRIENDLY,
      hp: obj.getHP() ?? 50,
      maxHp: obj.getMaxHP() ?? 50,
      x: obj.position.x,
      y: obj.position.y,
      z: obj.position.z,
      facing: isPlaceable ? (obj.bearing || 0) : (obj as ModuleCreature).getFacing(),
      scale: obj.gmScale || 1.0,
      animState: isPlaceable ? 0 : ((obj as ModuleCreature).animationState?.index || 0),
      combat: isPlaceable ? undefined : !!(obj as ModuleCreature).combatData?.combatState,
      hidden: !!obj.gmHidden,
      stealth: !!(obj as any).stealthMode,
      hostDriven: !!obj.gmHostDriven,
      intentSeq: obj.gmIntentSeq || 0,
      rightHandResRef,
      leftHandResRef,
      armorResRef,
      barkText: obj.gmBarkText || '',
      stance: isPlaceable ? undefined : ((obj as ModuleCreature).heldStance || ''),
      hasInventory: isPlaceable ? (obj as ModulePlaceable).hasInventory : false,
      locked: isPlaceable ? (obj as ModulePlaceable).isLocked() : false,
      openState: isPlaceable ? (obj as ModulePlaceable).state : 0,
      lootResRefs: isPlaceable ? GMSpawner.lootOf(obj) : []
    };
  }

  static serializeActorsForTick(): GMSerializedActor[] {
    return this.serializeAllActors().filter((actor) => !actor.hidden);
  }

  static serializeAllActors(): GMSerializedActor[] {
    const area = GameState.module?.area;
    if (!area || GMManager.sceneLoading || !GameState.module.readyToProcessEvents) return [];
    const list: GMSerializedActor[] = [];
    for (const p of GameState.PartyManager.party) {
      if (p) list.push(this.serializeSingleActor(p));
    }
    // Objects still loading are sent once, complete, when their spawn finishes
    for (const c of area.creatures) {
      if (c && !GameState.PartyManager.party.includes(c) && !c.gmSpawning) {
        list.push(this.serializeSingleActor(c));
      }
    }
    for (const plc of area.placeables) {
      if (plc && plc.gmNetId && !plc.gmSpawning && !String(plc.gmNetId).startsWith('plc_area_')) {
        list.push(this.serializeSingleActor(plc));
      }
    }
    return list;
  }

  static buildWorldSnapshot(): GMWorldSnapshot {
    const area = GameState.module?.area;
    const doors: GMSerializedDoorState[] = (area?.doors || []).map((d, idx) => ({
      netId: d.gmNetId || `door_${idx}_${d.getTag() || d.id}`,
      tag: d.getTag(),
      x: d.position.x,
      y: d.position.y,
      locked: d.isLocked(),
      openState: d.openState
    }));

    return {
      moduleResRef: GameState.module?.filename || 'danm14aa',
      keepDefaultCreatures: GMManager.keepDefaultCreatures,
      keepDefaultTriggers: GMManager.keepDefaultTriggers,
      keepDefaultPlaceables: GMManager.keepDefaultPlaceables,
      rules: GMManager.sessionRules(),
      actors: this.serializeActorsForTick(),
      doors,
      mines: GMMines.getMines().map((m) => GMMines.serializeMine(m)),
      atmosphere: Object.keys(GMAtmosphere.current).length ? GMAtmosphere.current : undefined,
    };
  }

  static async loadSceneFromNetwork(
    moduleResRef: string,
    keepCreatures: boolean,
    keepTriggers: boolean,
    keepPlaceables: boolean = true
  ) {
    GMManager.keepDefaultCreatures = keepCreatures;
    GMManager.keepDefaultTriggers = keepTriggers;
    GMManager.keepDefaultPlaceables = keepPlaceables;
    return GMManager.loadScene(moduleResRef, {
      keepCreatures,
      keepTriggers,
      keepPlaceables,
      preserveParty: false
    });
  }

  static async applyWorldSnapshotOnClient(snapshot: GMWorldSnapshot) {
    if (!snapshot) return;
    const keepPlaceables = snapshot.keepDefaultPlaceables ?? true;
    if (!GameState.module || GameState.module.filename !== snapshot.moduleResRef) {
      const loaded = await this.loadSceneFromNetwork(
        snapshot.moduleResRef,
        snapshot.keepDefaultCreatures,
        snapshot.keepDefaultTriggers,
        keepPlaceables
      );
      // Applied once the new scene is up (not awaited, so later packets aren't held up)
      GMManager.waitForScene(loaded, Infinity).then((ready) => {
        if (ready) return this.syncSnapshotEntitiesOnClient(snapshot);
      });
      return;
    }
    await this.syncSnapshotEntitiesOnClient(snapshot);
  }

  static async syncSnapshotEntitiesOnClient(snapshot: GMWorldSnapshot) {
    await GMAtmosphere.receive(snapshot.atmosphere);
    if (Array.isArray(snapshot.mines)) {
      const known = new Set(snapshot.mines.map((m) => m.netId));
      for (const mine of GMMines.getMines()) {
        if (!known.has(GMMines.mineNetId(mine))) GMMines.removeMineOnClient(GMMines.mineNetId(mine));
      }
      for (const mine of snapshot.mines) GMMines.applyMineOnClient(mine);
    }
    if (snapshot.rules?.deathRule) {
      GMNetworkManager.sessionRules = { ...GMNetworkManager.sessionRules, ...snapshot.rules };
    }
    if (Array.isArray(snapshot.doors)) {
      for (const ds of snapshot.doors) {
        this.applyDoorStateOnClient(ds);
      }
    }
    if (Array.isArray(snapshot.actors)) {
      for (const actor of snapshot.actors) {
        await this.spawnOrUpdateFromSerialized(actor);
      }
    }
  }

  static applyWorldTickOnClient(actors: GMSerializedActor[]) {
    if (!Array.isArray(actors) || GMManager.sceneLoading || !GameState.module?.readyToProcessEvents) return;
    for (const actor of actors) {
      if (actor.netId === GMNetworkManager.assignedActorNetId && GMManager.controlMode === 'POSSESS') {
        // Once the host has seen our latest intent and finished it, position authority returns to us
        if (
          GMNetworkManager.awaitingHost &&
          (actor.intentSeq ?? 0) >= GMNetworkManager.localIntentSeq &&
          !actor.hostDriven
        ) {
          GMNetworkManager.awaitingHost = false;
        }
        // While the host drives our actor, follow it like any other replica
        if (GMNetworkManager.awaitingHost) {
          this.spawnOrUpdateFromSerialized(actor);
          continue;
        }
        // Otherwise keep our local position and only take the host's HP
        const localObj = GMManager.netIdMap.get(actor.netId);
        if (localObj) {
          if (GMObjectKind.isCreature(localObj)) {
            GMManager.setCreatureHP(localObj as ModuleCreature, actor.hp, actor.maxHp);
            const own = localObj as ModuleCreature;
            if (!!own.stealthMode !== !!actor.stealth) own.setStealthMode(!!actor.stealth, true);
            // Fights happen on the host: under attack there, our character takes its combat stance here too
            if (actor.combat) own.resetExcitedDuration();
            // Our character fights on the host: its weapons light up here when it does
            if (actor.combat !== undefined) this.syncWeaponPower(own, !!actor.combat || !!own.combatData?.combatState);
          } else {
            localObj.setMaxHP(actor.maxHp);
            localObj.currentHP = actor.hp;
          }
        }
        continue;
      }
      this.spawnOrUpdateFromSerialized(actor);
    }
  }

  static async spawnOrUpdateFromSerialized(actor: GMSerializedActor): Promise<ModuleObject | null> {
    if (!actor || actor.hidden || !GameState.module?.area) return null;
    const existing = GMManager.netIdMap.get(actor.netId);
    if (existing) {
      if (actor.kind === 'placeable') {
        if (existing.position.x !== actor.x || existing.position.y !== actor.y || existing.position.z !== actor.z) {
          existing.position.set(actor.x, actor.y, actor.z);
          if (existing.container) existing.container.position.copy(existing.position);
          existing.computeBoundingBox?.(true);
        }
      } else {
        this.setNetTarget(existing, actor.x, actor.y, actor.z);
        existing.gmNetAnim = actor.animState;
      }
      if (existing.container) {
        if (typeof actor.scale === 'number' && actor.scale > 0) {
          existing.container.scale.setScalar(actor.scale);
          existing.gmScale = actor.scale;
        }
      }
      if (GMObjectKind.isCreature(existing)) {
        GMManager.setCreatureHP(existing as ModuleCreature, actor.hp, actor.maxHp);
      } else {
        existing.setMaxHP(actor.maxHp);
        existing.currentHP = actor.hp;
      }
      if (actor.barkText !== undefined) {
        existing.gmBarkText = actor.barkText;
      }
      if (actor.kind === 'placeable') {
        const plc = existing as ModulePlaceable;
        plc.setLocked(!!actor.locked);
        plc.bearing = actor.facing;
        plc.rotation.z = actor.facing;
      } else {
        const cre = existing as ModuleCreature;
        cre.setFacing(actor.facing, false);
        this.syncCombatState(cre, actor.combat);
        if (!!cre.stealthMode !== !!actor.stealth) cre.setStealthMode(!!actor.stealth, true);
        if (actor.stance !== undefined && (cre.heldStance || '') !== actor.stance) cre.setHeldStance(actor.stance);
        if (cre.factionId !== actor.factionId) {
          GMManager.assignFaction(cre, actor.factionId);
        }
        // Our own character's equipment comes from our character sheet instead
        if (actor.netId !== GMNetworkManager.assignedActorNetId) {
          this.syncReplicaEquipment(cre, actor);
        }
      }
      return existing;
    }

    // Spawning loads models asynchronously; ignore further ticks for this actor until it exists
    if (this.pendingNetSpawns.has(actor.netId)) return null;
    this.pendingNetSpawns.add(actor.netId);
    try {
      return await this.spawnFromSerialized(actor);
    } finally {
      this.pendingNetSpawns.delete(actor.netId);
    }
  }

  static async spawnFromSerialized(actor: GMSerializedActor): Promise<ModuleObject | null> {
    const spawned = await this.spawnFromSerializedInner(actor);
    if (spawned && GMPlayers.pendingPlayerSheet?.netId === actor.netId) {
      await GMPlayers.applyPlayerSheetOnClient(GMPlayers.pendingPlayerSheet);
    }
    return spawned;
  }

  static async spawnFromSerializedInner(actor: GMSerializedActor): Promise<ModuleObject | null> {
    const pos = new THREE.Vector3(actor.x, actor.y, actor.z);
    if (actor.kind === 'placeable') {
      return await GMSpawner.spawnPlaceable(
        {
          name: actor.name,
          templateResRef: actor.templateResRef,
          appearanceId: actor.appearanceId,
          // Mirror what the host built (its model, name and lock), not the template's defaults
          customized: true,
          scale: actor.scale || 1.0,
          useable: true,
          hasInventory: !!actor.hasInventory,
          locked: !!actor.locked,
          openLockDC: 15,
          lootResRefs: actor.lootResRefs || [],
          barkText: actor.barkText
        },
        pos,
        actor.facing,
        actor.netId
      );
    } else if (actor.kind === 'player') {
      const isMine = actor.ownerPeerId === GMNetworkManager.peerId || actor.netId === GMNetworkManager.assignedActorNetId;
      return await GMSpawner.spawnPlayerCharacter(
        {
          ...GMManager.pendingPlayerConfig,
          name: actor.name,
          appearanceId: actor.appearanceId || 136,
          hp: actor.maxHp || 120,
          rightHandResRef: actor.rightHandResRef,
          leftHandResRef: actor.leftHandResRef,
          armorResRef: actor.armorResRef,
          possessImmediately: isMine,
          ownerPeerId: actor.ownerPeerId
        },
        pos,
        actor.facing,
        actor.netId
      );
    } else {
      return await GMSpawner.spawnCreature(
        {
          name: actor.name,
          templateResRef: actor.templateResRef,
          appearanceId: actor.appearanceId,
          // Mirror what the host built (look, HP, gear), on top of the template's other slots
          customized: true,
          factionId: actor.factionId,
          hp: actor.maxHp || 50,
          level: 4,
          classId: 0,
          rightHandResRef: actor.rightHandResRef,
          leftHandResRef: actor.leftHandResRef,
          armorResRef: actor.armorResRef,
          barkText: actor.barkText,
          stance: actor.stance
        },
        pos,
        actor.facing,
        actor.netId
      );
    }
  }

  static removeActorByNetId(netId: string) {
    const obj = GMManager.netIdMap.get(netId);
    if (obj) {
      GMManager.netIdMap.delete(netId);
      obj.destroy();
      GMManager.notifyChange();
    }
  }

  static applyDoorStateOnClient(doorState: GMSerializedDoorState) {
    const area = GameState.module?.area;
    if (!area || !doorState) return;
    let door = GMManager.netIdMap.get(doorState.netId) as ModuleDoor;
    if (!door) {
      door = area.doors.find(
        d => d.getTag() === doorState.tag && Math.hypot(d.position.x - doorState.x, d.position.y - doorState.y) < 2.0
      );
    }
    if (!door) return;
    door.setLocked(doorState.locked);
    if (door.openState !== doorState.openState) {
      if (doorState.openState === ModuleDoorOpenState.OPEN1 || doorState.openState === ModuleDoorOpenState.OPEN2) {
        door.openDoor(door);
      } else {
        door.closeDoor(door);
      }
    }
  }

  /**
   * Resolve a network actor that the given peer is allowed to control
   */
  /**
   * Host: the net id of a character still in the world that belongs to this peer, so a reconnecting player gets it back
   */
  static findActorOwnedBy(peerId: string): string | null {
    for (const [netId, obj] of GMManager.netIdMap.entries()) {
      if (obj.gmOwnerPeerId === peerId && !obj.destroyed) return netId;
    }
    return null;
  }

  /**
   * Host: a disconnected player's character stops any intent in progress and stands still until they rejoin
   */
  static releaseActor(netId: string) {
    const actor = GMManager.netIdMap.get(netId);
    if (!actor) return;
    actor.clearAllActions();
    actor.gmHostDriven = false;
    actor.gmNetTarget = undefined;
  }

  static getOwnedActor(peerId: string, netId: string): ModuleCreature | null {
    const actor = GMManager.netIdMap.get(netId);
    if (!actor || !GMObjectKind.isCreature(actor)) return null;
    if (actor.gmOwnerPeerId !== peerId) return null;
    return actor as ModuleCreature;
  }

  /**
   * Client-owned movement: the client is authoritative over its actor's position
   * except while the host is executing one of its intents.
   */
  static applyClientInputOnHost(peerId: string, payload: any) {
    if (!payload) return;
    const actor = this.getOwnedActor(peerId, payload.netId);
    if (!actor || actor.gmHostDriven) return;
    // Sent before the player's game had moved their character to where the GM teleported it
    if ((payload.teleportSeq ?? 0) < (actor.gmTeleportSeq || 0)) return;
    if (typeof payload.x === 'number' && typeof payload.y === 'number') {
      this.setNetTarget(actor, payload.x, payload.y, payload.z);
      if (typeof payload.facing === 'number') {
        actor.setFacing(payload.facing, false);
      }
    }
    if (typeof payload.stance === 'string' && (actor.heldStance || '') !== payload.stance) {
      actor.setHeldStance(payload.stance);
    }
  }

  /** Host only, and only for objects clients know about */
  static getHostFxNetId(obj: ModuleObject | undefined): string | null {
    if (!GameState.gmMode || GMNetworkManager.role !== 'host' || !obj || obj.gmHidden) return null;
    return obj.gmNetId || null;
  }

  /**
   * Host: a creature started a 2DA animation. Callers set the animation state index right after
   * (ATTACK, DAMAGE, DODGE...), so read it once the current call stack has finished.
   */
  static onHostTwoDAAnimation(cre: ModuleCreature, animation: ITwoDAAnimation) {
    const netId = this.getHostFxNetId(cre);
    if (!netId || !animation?.name) return;
    queueMicrotask(() => {
      if (cre.animationState?.animation !== animation) return;
      GMNetworkManager.broadcastFx({ kind: 'anim', netId, anim: animation.name, index: cre.animationState.index });
    });
  }

  static onHostTextSprite(obj: ModuleObject, text: string, style: number, timer: number) {
    const netId = this.getHostFxNetId(obj);
    if (!netId) return;
    GMNetworkManager.broadcastFx({ kind: 'text', netId, text, style, timer });
  }

  /** Host: a ranged attack fired a bolt; players draw it too */
  static onHostProjectile(caster: ModuleObject, target: ModuleObject, ammunition: number, hit: boolean, delay: number) {
    const netId = this.getHostFxNetId(caster);
    const targetNetId = this.getHostFxNetId(target);
    if (!netId || !targetNetId) return;
    GMNetworkManager.broadcastFx({ kind: 'projectile', netId, targetNetId, ammunition, hit, delay });
  }

  static onHostVisualEffectApplied(effect: GameEffect) {
    const netId = this.getHostFxNetId(effect.object);
    if (!netId) return;
    // A beam is drawn from its caster: players need to know who that is
    let beam: { casterNetId: string; bodyPart: number } | undefined;
    if (effect.type === GameEffectType.EffectBeam) {
      const casterNetId = this.getHostFxNetId(effect.getObject?.(0) as ModuleObject);
      if (!casterNetId) return;
      beam = { casterNetId, bodyPart: effect.getInt(1) };
    }
    const fxId = GMManager.getNextNetId('fx');
    (effect as any).gmFxId = fxId;
    GMNetworkManager.broadcastFx({
      kind: 'vfx.add',
      netId,
      fxId,
      vfx: effect.getInt(0),
      miss: effect.getInt(2),
      durationType: effect.getDurationType(),
      duration: effect.getDuration(),
      ...(beam ? { beam } : {}),
    });
  }

  static onHostVisualEffectRemoved(effect: GameEffect) {
    const fxId = (effect as any).gmFxId;
    const netId = this.getHostFxNetId(effect.object);
    // Instant effects finish on their own on every machine
    if (!fxId || !netId || effect.getDurationType() === GameEffectDurationType.INSTANT) return;
    GMNetworkManager.broadcastFx({ kind: 'vfx.remove', netId, fxId });
  }

  /**
   * Client: replay a host visual on our copy of the object
   */
  static applyFxEventOnClient(event: GMFxEvent) {
    const obj = GMManager.netIdMap.get(event?.netId);
    if (!obj) return;
    switch (event.kind) {
      case 'anim': {
        if (!GMObjectKind.isCreature(obj)) return;
        const cre = obj as ModuleCreature;
        const animation = OdysseyModelAnimation.GetAnimation2DA(event.anim);
        if (!animation || cre.isDead()) return;
        cre.playTwoDAAnimation(animation);
        cre.animationState.index = event.index;
        cre.gmFxAnimation = cre.animationState.animation;
        break;
      }
      case 'text':
        TextSprite3D.CreateOnObject(obj, event.text, event.style, event.timer);
        break;
      case 'vfx.add': {
        let effect: GameEffect;
        if (event.beam) {
          const caster = GMManager.netIdMap.get(event.beam.casterNetId);
          if (!caster) return;
          effect = new GameState.GameEffectFactory.EffectBeam();
          effect.setInt(1, event.beam.bodyPart);
          effect.setObject(0, caster);
        } else {
          effect = new GameState.GameEffectFactory.EffectVisualEffect();
        }
        effect.setInt(0, event.vfx);
        effect.setInt(2, event.miss);
        effect.setDurationType(event.durationType);
        effect.setDuration(event.duration);
        effect.initialize();
        (effect as any).gmFxId = event.fxId;
        obj.addEffect(effect);
        break;
      }
      case 'vfx.remove': {
        const effect = obj.effects.find((e) => (e as any).gmFxId === event.fxId);
        if (effect) obj.removeEffect(effect);
        break;
      }
      case 'projectile': {
        const target = GMManager.netIdMap.get(event.targetNetId);
        if (target) GameState.ProjectileManager?.Launch(obj, target, event.ammunition, event.hit, event.delay);
        break;
      }
    }
  }

  /**
   * Client: keep another player's or NPC's visible weapons and armor matching the host
   */
  static syncReplicaEquipment(cre: ModuleCreature, actor: GMSerializedActor) {
    const wanted: [string, string | undefined][] = [
      ['RIGHTHAND', actor.rightHandResRef],
      ['LEFTHAND', actor.leftHandResRef],
      ['ARMOR', actor.armorResRef],
    ];
    const loading: Record<string, boolean> = cre.gmEquipLoading || (cre.gmEquipLoading = {});
    for (const [slotName, resRef] of wanted) {
      if (resRef === undefined || loading[slotName]) continue;
      const current: ModuleItem | undefined = (cre.equipment as any)[slotName];
      const have = gmItemResRef(current);
      if (have === resRef) continue;
      const slot = (ModuleCreatureArmorSlot as any)[slotName] as number;
      if (!resRef) {
        cre.unequipSlot(slot);
        continue;
      }
      loading[slotName] = true;
      GMSpawner.createItemFromResRefAsync(resRef)
        .then((item) => cre.equipItem(slot, item))
        .catch((e) => console.warn('[GMManager] replica equip failed', resRef, e))
        .finally(() => { loading[slotName] = false; });
    }
  }

  /**
   * Host: hand position authority back to the owning client once its intent has finished
   */
  static updateHostDrivenActors() {
    for (const obj of GMManager.netIdMap.values()) {
      if (!obj.gmHostDriven) continue;
      const cre = obj as ModuleCreature;
      if (!cre.actionQueue?.length || cre.isDead()) {
        cre.gmHostDriven = false;
      }
    }
  }

  /**
   * True when this creature's logic (actions, AI, combat) is owned by another machine and must not run locally
   */
  static isNetReplica(cre: ModuleCreature): boolean {
    if (GMNetworkManager.role !== 'client') return false;
    if (!cre.gmNetId) return false;
    if (cre.gmNetId !== GMNetworkManager.assignedActorNetId) return true;
    return GMNetworkManager.awaitingHost;
  }

  /**
   * True when this creature's position is streamed from the network and smoothed locally
   */
  static isNetMotionDriven(cre: ModuleCreature): boolean {
    if (this.isNetReplica(cre)) return true;
    return GMNetworkManager.role === 'host' && !!cre.gmOwnerPeerId && !cre.gmHostDriven;
  }

  static setNetTarget(obj: ModuleObject, x: number, y: number, z: number) {
    let target = obj.gmNetTarget as THREE.Vector3 | undefined;
    if (!target) {
      target = new THREE.Vector3();
      obj.gmNetTarget = target;
    }
    target.set(x, y, z);
    // Snap on first sync or teleports instead of sliding across the map
    if (obj.position.distanceTo(target) > this.NET_SNAP_DISTANCE) {
      this.moveBox(obj, target.x - obj.position.x, target.y - obj.position.y, target.z - obj.position.z);
      obj.position.copy(target);
      obj.getCurrentRoom();
    }
  }

  /** A replica fights in step with the host's copy: its combat stance and powered weapons come and go with it */
  static syncCombatState(cre: ModuleCreature, combat: boolean | undefined) {
    if (combat === undefined || !cre.combatData) return;
    if (combat) cre.resetExcitedDuration();
    else if (cre.combatData.combatState) cre.cancelExcitedDuration();
    this.syncWeaponPower(cre, combat);
  }

  /**
   * Weapons light up (a lightsaber ignites) when their owner fights: the combat round powers them when it works
   * out an attack, and that runs only on the host. Here they power up and down with the host's combat state,
   * once each way (powering again restarts the "powered" loop).
   */
  static syncWeaponPower(cre: ModuleCreature, combat: boolean) {
    // While fighting, keep asking (the weapon goes from igniting to its lit loop); powering down, once
    if (!combat && !cre.gmNetPowered) return;
    cre.gmNetPowered = combat;
    cre.weaponPowered?.(combat);
  }

  /**
   * Keep a replica's bounding box with it. Its box is set where it spawned, and only the engine's own movement
   * (collision) moves it; a replica moves by network updates instead. The box decides whether its model is on
   * screen, so a stale one hid creatures that had walked away from their spawn whenever that spot was off camera.
   */
  static moveBox(obj: ModuleObject, dx: number, dy: number, dz: number) {
    const box = obj.box as THREE.Box3 | undefined;
    if (!box || box.isEmpty() || (!dx && !dy && !dz)) return;
    this.boxShift.set(dx, dy, dz);
    box.translate(this.boxShift);
  }

  static boxShift = new THREE.Vector3();

  /**
   * Smooth a network-driven creature toward its latest synced position and pick a locomotion animation from its speed
   */
  static updateNetMotion(cre: ModuleCreature, delta: number) {
    const target = cre.gmNetTarget as THREE.Vector3 | undefined;
    let speed = 0;
    if (target && delta > 0) {
      const alpha = 1 - Math.exp(-delta * this.NET_SMOOTHING);
      const dx = (target.x - cre.position.x) * alpha;
      const dy = (target.y - cre.position.y) * alpha;
      const dz = (target.z - cre.position.z) * alpha;
      cre.position.x += dx;
      cre.position.y += dy;
      cre.position.z += dz;
      this.moveBox(cre, dx, dy, dz);
      speed = Math.sqrt(dx * dx + dy * dy) / delta;
      if (speed > 0.05) {
        cre.getCurrentRoom();
      }
    }

    if (cre.isDead()) return;
    const anim = cre.animationState.index;
    const isLocomotion = anim === ModuleCreatureAnimState.RUNNING || anim === ModuleCreatureAnimState.WALKING;
    const hostAnim = cre.gmNetAnim as number | undefined;
    const hostIsLocomotion = hostAnim === ModuleCreatureAnimState.RUNNING || hostAnim === ModuleCreatureAnimState.WALKING;
    if (speed > 0.4) {
      // Walking or running is the host's call (smoothing slows the replica's apparent speed, so a running rancor
      // looked like it walked); from speed only when the host's state isn't locomotion yet
      const want = hostIsLocomotion ? hostAnim! : (speed > cre.getWalkSpeed() * 1.25 ? ModuleCreatureAnimState.RUNNING : ModuleCreatureAnimState.WALKING);
      if (anim !== want) cre.setAnimationState(want);
    } else {
      const hostIsFxDriven = this.FX_DRIVEN_ANIM_STATES.includes(hostAnim);
      // Let a replayed attack/reaction animation finish before applying the tick's state
      const fxPlaying = !!cre.gmFxAnimation && cre.animationState.animation === cre.gmFxAnimation;
      if (hostAnim && !hostIsLocomotion && !hostIsFxDriven && !fxPlaying && hostAnim !== anim) {
        cre.setAnimationState(hostAnim);
      } else if (isLocomotion && !hostIsLocomotion) {
        // Stopped here and there. While the host says it's still on the move, it is: between updates the
        // smoothing catches up with the last position and the replica pauses a moment, which isn't stopping
        cre.setAnimationState(cre.combatData.combatState ? ModuleCreatureAnimState.READY : ModuleCreatureAnimState.PAUSE);
      }
    }
  }
}

// What players' games need from the GM's world, and the world packets each side handles
GMNetworkManager.world = {
  buildWorldSnapshot: () => GMReplication.buildWorldSnapshot(),
  serializeActorsForTick: () => GMReplication.serializeActorsForTick(),
  getNetObject: (netId) => GMManager.netIdMap.get(netId),
};
GMNetworkManager.on('scene.load', 'client', async (packet) => {
  const { moduleResRef, keepDefaultCreatures, keepDefaultTriggers, keepDefaultPlaceables } = packet.payload || ({} as any);
  if (!moduleResRef) return;
  if (GMNetworkManager.joinState !== 'playing') GMNetworkManager.clearJoinTimer();
  GMNetworkManager.appendChat('GM', `Loading scene: ${moduleResRef}...`);
  await GMReplication.loadSceneFromNetwork(moduleResRef, !!keepDefaultCreatures, !!keepDefaultTriggers, keepDefaultPlaceables !== false);
}, 'to-me-or-all');
GMNetworkManager.on('world.snapshot', 'client', async (packet) => {
  if (packet.payload) await GMReplication.applyWorldSnapshotOnClient(packet.payload);
}, 'to-me-or-all');
GMNetworkManager.on('world.tick', 'client', (packet) => GMReplication.applyWorldTickOnClient(packet.payload?.actors || []));
GMNetworkManager.on('actor.spawn', 'client', async (packet) => {
  if (packet.payload?.actor) await GMReplication.spawnOrUpdateFromSerialized(packet.payload.actor);
});
GMNetworkManager.on('actor.update', 'client', async (packet) => {
  if (packet.payload?.actor) await GMReplication.spawnOrUpdateFromSerialized(packet.payload.actor);
});
GMNetworkManager.on('actor.teleport', 'client', (packet) => {
  if (packet.payload?.netId) GMReplication.applyTeleportOnClient(packet.payload);
});
GMNetworkManager.on('actor.remove', 'client', (packet) => {
  if (packet.payload?.netId) GMReplication.removeActorByNetId(packet.payload.netId);
});
GMNetworkManager.on('door.state', 'client', (packet) => {
  if (packet.payload) GMReplication.applyDoorStateOnClient(packet.payload);
});
GMNetworkManager.on('scene.atmosphere', 'client', async (packet) => {
  await GMAtmosphere.receive(packet.payload?.atmosphere);
});
GMNetworkManager.on('fx.event', 'client', (packet) => {
  if (packet.payload) GMReplication.applyFxEventOnClient(packet.payload);
});
GMNetworkManager.on('client.input', 'host', (packet) => {
  if (packet.payload) GMReplication.applyClientInputOnHost(packet.senderId, packet.payload);
});
// A player who left keeps their character, standing still until they rejoin
GMNetworkManager.on('peer.leave', 'host', (packet) => {
  const netId = GMReplication.findActorOwnedBy(packet.senderId);
  if (netId) GMReplication.releaseActor(netId);
});
