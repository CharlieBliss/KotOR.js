import { GMObjectKind } from "@/managers/gm/GMObjectKind";
import * as THREE from "three";
import { GameState } from "@/GameState";
import type { GMSerializedMine } from "@/managers/GMNetworkManager";
import { ModuleTriggerType } from "@/enums/module/ModuleTriggerType";
import type { ModuleTrigger } from "@/module/ModuleTrigger";
import { ModuleObject, ModuleCreature } from "@/module";
import { ActionParameterType } from "@/enums/actions/ActionParameterType";
import { SkillType } from "@/enums/nwscript/SkillType";
import { GMNetworkManager, GMClientIntent } from "@/managers/GMNetworkManager";
import { GMManager } from "@/managers/GMManager";
import { GMSpawner } from "@/managers/gm/GMSpawner";
import { GMPlayers } from "@/managers/gm/GMPlayers";
import { GMChecks } from "@/managers/gm/GMChecks";

/** Mines (Demolitions) in GM sessions: the GM's machine owns them and tells players. */
export class GMMines {
  /** traps.2da row the GM's mine tool places */
  static pendingMineType: number = 4;

  static isMine(obj: ModuleObject | undefined): obj is ModuleTrigger {
    return !!obj && GMObjectKind.isTrigger(obj) && (obj as ModuleTrigger).type === ModuleTriggerType.TRAP;
  }

  static getMines(): ModuleTrigger[] {
    return (GameState.module?.area?.triggers || []).filter((t) => this.isMine(t)) as ModuleTrigger[];
  }

  /**
   * A mine's network id. The module's own mines get one from where they are, the same on every machine;
   * mines laid during the session get one from the GM's machine.
   */
  static mineNetId(mine: ModuleTrigger | undefined): string {
    if (!mine) return '';
    if (!mine.gmNetId) {
      const p = mine.position;
      const id = `trap_${Math.round(p.x * 10)}_${Math.round(p.y * 10)}_${mine.trapType}`;
      mine.gmNetId = GMNetworkManager.role === 'client' ? id : (GMManager.netIdMap.has(id) ? GMManager.getNextNetId('mine') : id);
      GMManager.registerNetObject(mine.gmNetId, mine);
    }
    return mine.gmNetId;
  }

  static serializeMine(mine: ModuleTrigger): GMSerializedMine {
    return {
      netId: this.mineNetId(mine),
      trapType: mine.trapType,
      x: mine.position.x, y: mine.position.y, z: mine.position.z,
      factionId: mine.factionId,
      detected: !!mine.trapDetected,
    };
  }

  /** On a player's machine, mines only mirror the GM's: they don't go off, and nobody spots them there */
  static isMineReplica(_mine?: ModuleTrigger): boolean {
    return GMNetworkManager.role === 'client';
  }

  /** Host: a mine was laid or spotted */
  static onMineChanged(mine: ModuleTrigger) {
    if (GMNetworkManager.role !== 'host') return;
    GMNetworkManager.send('mine.state', this.serializeMine(mine));
  }

  /** Host: a mine went off, was disarmed or recovered */
  static onMineRemoved(mine: ModuleTrigger) {
    const netId = mine.gmNetId;
    if (!netId) return;
    GMManager.netIdMap.delete(netId);
    if (GMNetworkManager.role === 'host') {
      GMNetworkManager.send('mine.remove', { netId });
    }
  }

  static applyMineOnClient(state: GMSerializedMine) {
    const area = GameState.module?.area;
    if (!area || !state) return;
    // Match the module's own mines by their id, which every machine works out the same way
    for (const mine of this.getMines()) this.mineNetId(mine);
    let mine = GMManager.netIdMap.get(state.netId) as ModuleTrigger | undefined;
    if (!mine) {
      mine = GameState.Module.ModuleArea.ModuleTrigger.CreateMine(area, new THREE.Vector3(state.x, state.y, state.z), state.trapType, undefined, state.factionId);
      if (!mine) return;
      mine.gmNetId = state.netId;
      GMManager.registerNetObject(state.netId, mine);
    }
    if (state.detected) mine.trapDetected = true;
  }

  static removeMineOnClient(netId: string) {
    const mine = GMManager.netIdMap.get(netId) as ModuleTrigger | undefined;
    GMManager.netIdMap.delete(netId);
    if (mine && this.isMine(mine) && mine.area) mine.destroy();
  }

  /** GM: place a mine (hostile to the players) */
  static placeMine(trapType: number, position: THREE.Vector3): ModuleTrigger | undefined {
    const mine = GameState.Module.ModuleArea.ModuleTrigger.CreateMine(GameState.module?.area, position.clone(), trapType, undefined, 1);
    if (mine) this.onMineChanged(mine);
    GMManager.notifyChange();
    return mine;
  }

  /** The mine kinds the GM can place: traps.2da rows with a mine item */
  static getMineTypes(): { id: number; label: string }[] {
    const rows = GameState.TwoDAManager?.datatables.get('traps')?.rows || {};
    return Object.values(rows).filter((r: any) => r.resref && r.resref !== '****').map((r: any) => ({
      id: Number(r.__index),
      label: GameState.TLKManager?.GetStringById(Number(r.name))?.Value || String(r.label),
    }));
  }

  /** Host: a player's Demolitions pick (lay, set on a door or container, disarm, recover) */
  static async useMineOnHost(actor: ModuleCreature, intent: GMClientIntent): Promise<boolean> {
    if (!actor || actor.isDead()) return false;
    if ((actor.getSkillRanks?.(SkillType.DEMOLITIONS) ?? 0) < 1) return false;
    const target = intent.targetNetId ? GMManager.netIdMap.get(intent.targetNetId) : undefined;
    switch (intent.mine) {
      case 'lay':
      case 'set': {
        const resRef = String(intent.resRef || '');
        if (!resRef || !GMPlayers.getPlayerInventory(actor).some((e) => e.resRef === resRef)) return false;
        const item = await GMSpawner.createItemFromResRefAsync(resRef);
        if (!item) return false;
        const onTarget = intent.mine === 'set' ? target : actor;
        if (!onTarget) return false;
        const action = new GameState.ActionFactory.ActionSetMine();
        action.setOwner(actor);
        action.setParameter(0, ActionParameterType.DWORD, item);
        action.setParameter(1, ActionParameterType.DWORD, onTarget);
        action.setParameter(2, ActionParameterType.FLOAT, onTarget.position.x);
        action.setParameter(3, ActionParameterType.FLOAT, onTarget.position.y);
        action.setParameter(4, ActionParameterType.FLOAT, onTarget.position.z);
        actor.actionQueue.add(action);
        return true;
      }
      case 'disarm':
      case 'recover': {
        if (!this.isMine(target) || !target.trapDetected) return false;
        const action = intent.mine === 'disarm' ? new GameState.ActionFactory.ActionDisarmMine() : new GameState.ActionFactory.ActionRecoverMine();
        action.setOwner(actor);
        action.setParameter(0, ActionParameterType.DWORD, target);
        actor.actionQueue.add(action);
        return true;
      }
    }
    return false;
  }

  /** Host: a recovered mine goes into a GM session player's inventory (true when it did) */
  static giveRecoveredMine(owner: ModuleObject, resRef: string): boolean {
    if (!GameState.gmMode || GMNetworkManager.role !== 'host' || !owner?.gmOwnerPeerId) return false;
    GMPlayers.addToPlayerInventory(owner, [{ resRef, stack: 1 }]);
    return true;
  }

  /** A Demolitions roll, said in chat in a GM session */
  static announceSkillRoll(owner: ModuleObject, label: string, roll: number, bonus: number, dc: number, success: boolean) {
    if (!GameState.gmMode) return;
    const text = GMChecks.describeCheck({ name: owner?.getName?.() || 'Someone', label, roll, bonus, total: roll + bonus, dc, success });
    if (GMNetworkManager.role === 'host') GMNetworkManager.sendChat('Check', text);
    else GMNetworkManager.appendChat('Check', text);
  }
}

// Mines are the host's: players are told where they are
GMNetworkManager.on('mine.state', 'client', (packet) => {
  if (packet.payload) GMMines.applyMineOnClient(packet.payload);
});
GMNetworkManager.on('mine.remove', 'client', (packet) => {
  if (packet.payload?.netId) GMMines.removeMineOnClient(packet.payload.netId);
});
