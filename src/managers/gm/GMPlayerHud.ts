import { GameState } from "@/GameState";
import { CharacterRules } from "@/engine/rules/CharacterRules";
import { ActionType } from "@/enums/actions/ActionType";
import { GMNetworkManager } from "@/managers/GMNetworkManager";
import { GMManager } from "@/managers/GMManager";
import { GMObjectKind } from "@/managers/gm/GMObjectKind";
import { GMCombatAI } from "@/managers/gm/GMCombatAI";
import type { GMPowerTargetRule } from "@/managers/gm/GMCombatAI";
import { GMSeats } from "@/managers/gm/GMSeats";
import { SkillType } from "@/enums/nwscript/SkillType";
import { ActionParameterType } from "@/enums/actions/ActionParameterType";
import { ModuleObjectConstant } from "@/enums/module/ModuleObjectConstant";
import { ModuleTriggerType } from "@/enums/module/ModuleTriggerType";
import type { ModuleObject, ModuleCreature, ModuleItem } from "@/module";

/** Who an ability goes to: the enemy target, an ally (or you), or only you */
export type GMHudAim = 'enemy' | 'ally' | 'self';

/** What something in the world is to the player: colours the target frame and the ring under it */
export type GMHudRelation = 'enemy' | 'ally' | 'neutral' | 'object' | 'self';

/** One thing the player can use from the power bar or the wheel */
export interface GMHudAbility {
  /** Stable across sessions, for the saved bar: 'power:12', 'feat:30', 'item:g_i_medeqpmnt01', 'attack' */
  key: string;
  kind: 'power' | 'feat' | 'item' | 'attack';
  name: string;
  icon: string;
  aim: GMHudAim;
  /** Force points it costs (powers) */
  cost: number;
  /** How many are carried (items) */
  count?: number;
  /** Can it be used right now, and if not, why not */
  usable: boolean;
  why?: string;
  /** The action-menu entry it runs (ActionMenuManager.runMenuItem sends it to the host) */
  entry: any;
  /** Works only on droids, or only on Force users (Disable Droid): GMCombatAI.powerTargetRule */
  onlyOn?: GMPowerTargetRule;
}

/** Something the player can do to the target besides fighting it (GMPlayerHud.targetActions) */
export interface GMHudTargetAction {
  id: 'attack' | 'talk' | 'search' | 'open' | 'use' | 'sit' | 'unlock' | 'tunneler' | 'disarm' | 'recover';
  label: string;
  /** What it does, for the tooltip */
  title: string;
  /** Can it be done now, and if not, why not */
  usable: boolean;
  why?: string;
  /** The main one: R does it, as a click on the target does */
  primary?: boolean;
}

/** Where an ability would land now (GMPlayerHud.landsOn) */
export interface GMHudLanding {
  how: 'target' | 'nearest' | 'self' | 'none';
  who?: ModuleObject;
  /** Nothing to land on because it only works on droids or Force users, and the target (or everyone near) isn't */
  wrongKind?: boolean;
}

/** Combat feat categories (feat.2da): melee and ranged attacks */
const MELEE_FEAT = 0x1104;
const RANGED_FEAT = 0x1111;
/** Weapon types (baseitems.2da weapontype): what getEquippedWeaponType returns for a ranged weapon */
const RANGED_WEAPON_TYPE = 4;

/**
 * A GM session player's combat HUD, the part that isn't drawing (the panel's PlayerHud draws it):
 * - what the character can use, and whether it can now (Force, items left, the right weapon);
 * - who each use goes to: hostile things to the enemy target (the nearest enemy when there isn't one), friendly
 *   powers to the selected ally or yourself, personal ones to yourself;
 * - Tab / Shift+Tab: the next enemy or ally, nearest first;
 * - the power bar's eight slots, saved per character name;
 * - the wheel: under the GM's tactical pause rule, an open wheel holds the world.
 * Uses go through KotOR's action menu (ActionMenuManager.runMenuItem), which sends them to the host.
 */
export class GMPlayerHud {
  static SLOTS: number = 8;

  /** Bar slots the default keeps for helping powers and items, when the character has them */
  static HELP_SLOTS: number = 3;

  /** How far (metres) Tab and the automatic enemy pick look */
  static TARGET_RANGE: number = 35;

  /** The HUD can be turned off (KotOR's own then comes back) */
  static enabled: boolean = true;

  /** Whether the wheel is open on this machine (told to the host once per open/close) */
  static wheelOpen: boolean = false;

  /** The latest thing the host told this player about what they asked for (GMPlayers.tellPlayer), for the HUD */
  static lastNotice: { text: string; at: number } | null = null;

  static notice(text: string) {
    this.lastNotice = { text, at: Date.now() };
    GMManager.notifyChange();
  }

  /** Our HUD replaces KotOR's: a player in a GM session, once they have their character */
  static active(): boolean {
    return !!(
      this.enabled && GameState.gmMode && GMNetworkManager.role === 'client' && GMNetworkManager.joinState === 'playing' &&
      GMNetworkManager.assignedActorNetId && GameState.getCurrentPlayer()
    );
  }

  static player(): ModuleCreature | undefined {
    return GameState.getCurrentPlayer() as ModuleCreature | undefined;
  }

  // ---------------------------------------------------------------------------
  // What the player can use
  // ---------------------------------------------------------------------------

  /** Everything the character can use in a fight: attack, combat feats, powers, then items */
  static abilities(pc: ModuleCreature | undefined = this.player()): GMHudAbility[] {
    if (!pc) return [];
    const out: GMHudAbility[] = [];
    const fp = Number(pc.getFP?.() ?? 0);
    const ranged = pc.getEquippedWeaponType?.() === RANGED_WEAPON_TYPE;

    out.push({
      key: 'attack', kind: 'attack', name: 'Attack', icon: 'i_attack', aim: 'enemy', cost: 0, usable: true,
      entry: { action: { type: ActionType.ActionPhysicalAttacks } },
    });

    // Combat feats: the best rank of each chain (Power Attack, not also its lesser ranks)
    for (const feat of GMCombatAI.bestRanks<any>(pc.getFeats?.() || [])) {
      if (feat?.category != MELEE_FEAT && feat?.category != RANGED_FEAT) continue;
      const forRanged = feat.category == RANGED_FEAT;
      const usable = forRanged === ranged;
      out.push({
        key: `feat:${feat.id}`, kind: 'feat', name: CharacterRules.text(feat.name, feat.label || 'Combat feat'),
        icon: String(feat.icon || '').toLowerCase(), aim: 'enemy', cost: 0, usable,
        why: usable ? undefined : (forRanged ? 'Needs a ranged weapon in hand' : 'Needs a melee weapon in hand'),
        entry: { talent: feat },
      });
    }

    // Powers: hostile ones first, then friendly. Personal ones (range P: Battle Meditation, Force Speed) are cast on
    // yourself whatever else they do
    const spells: any[] = pc.getSpells?.() || [];
    const seen = new Set<number>();
    const powers = spells.filter((s) => s && !seen.has(s.id) && seen.add(s.id));
    // spells.2da's empty cells ('****') load as -1: a power is hostile or friendly when its column is 0 or more
    const marked = (v: any) => { const n = parseInt(v); return !isNaN(n) && n >= 0; };
    const isHostile = (s: any) => marked(s.forcehostile);
    const isFriendly = (s: any) => marked(s.forcefriendly);
    for (const spell of [...powers.filter(isHostile), ...powers.filter((s) => !isHostile(s) && isFriendly(s))]) {
      const cost = Number(spell.getForcePointCost?.(pc) ?? spell.forcepoints ?? 0) || 0;
      const usable = cost <= fp;
      const personal = String(spell.range || '').toUpperCase() === 'P';
      out.push({
        onlyOn: GMCombatAI.powerTargetRule(spell.forcehostile),
        key: `power:${spell.id}`, kind: 'power', name: CharacterRules.text(spell.name, spell.label || `Power ${spell.id}`),
        icon: String(spell.iconresref || '').toLowerCase(), aim: personal ? 'self' : isHostile(spell) ? 'enemy' : 'ally',
        cost, usable, why: usable ? undefined : `Needs ${cost} Force (you have ${Math.floor(fp)})`,
        entry: { talent: spell },
      });
    }

    // Items that cast something: grenades at the enemy; medpacs, stims and shields on yourself
    const counts = new Map<string, { item: ModuleItem; count: number }>();
    const items = [...(pc.getInventory?.() || []), ...Object.values(pc.equipment || {})] as ModuleItem[];
    for (const item of items) {
      const use = item?.getUseTargeting?.();
      if (use !== 'self' && use !== 'hostile') continue;
      const resRef = item.getItemResRef();
      const had = counts.get(resRef);
      const n = Math.max(1, Number(item.getStackSize?.() || 1));
      if (had) had.count += n;
      else counts.set(resRef, { item, count: n });
    }
    const itemsBy = (use: 'hostile' | 'self') => [...counts.values()].filter(({ item }) => item.getUseTargeting() === use);
    for (const { item, count } of [...itemsBy('hostile'), ...itemsBy('self')]) {
      const hostile = item.getUseTargeting() === 'hostile';
      out.push({
        key: `item:${item.getItemResRef()}`, kind: 'item', name: item.getName?.() || item.getItemResRef(),
        icon: String(item.getIcon?.() || '').toLowerCase(), aim: hostile ? 'enemy' : 'self', cost: 0, count, usable: true,
        entry: { item },
      });
    }
    return out;
  }

  /** The bar a character starts with: powers and grenades first, then combat feats, then what heals */
  static defaultLoadout(abilities: GMHudAbility[]): (string | null)[] {
    const rank = (a: GMHudAbility) =>
      a.kind === 'attack' ? 9 :
      a.kind === 'power' && a.aim === 'enemy' ? 0 :
      a.kind === 'item' && a.aim === 'enemy' ? 1 :
      a.kind === 'feat' ? (a.usable ? 2 : 6) :
      a.kind === 'power' ? 3 : 4;
    const sorted = abilities.filter((a) => a.kind !== 'attack').sort((a, b) => rank(a) - rank(b));
    // Room kept for what helps (heals, medpacs, buffs): a Force user's attack powers filled the whole bar, and with
    // a friend targeted nothing on it could help them
    const helping = sorted.filter((a) => a.aim !== 'enemy');
    const attacking = sorted.filter((a) => a.aim === 'enemy');
    const keepForHelp = Math.min(this.HELP_SLOTS, helping.length);
    const keys = [...attacking.slice(0, this.SLOTS - keepForHelp), ...helping].slice(0, this.SLOTS).map((a) => a.key);
    return Array.from({ length: this.SLOTS }, (_, i) => keys[i] || null);
  }

  static loadoutStorageKey(pc: ModuleCreature | undefined): string {
    return `gm.hud.bar.${GameState.GameKey}.${(pc?.getName?.() || 'player').toLowerCase()}`;
  }

  /** The bar's eight slots (ability keys or empty): the player's own arrangement, or the default */
  static loadout(pc: ModuleCreature | undefined = this.player(), abilities: GMHudAbility[] = this.abilities(pc)): (string | null)[] {
    try {
      const saved = JSON.parse(localStorage.getItem(this.loadoutStorageKey(pc)) || 'null');
      if (Array.isArray(saved)) return Array.from({ length: this.SLOTS }, (_, i) => (typeof saved[i] === 'string' ? saved[i] : null));
    } catch (e) { /* no storage: the default */ }
    return this.defaultLoadout(abilities);
  }

  /** Put an ability in a bar slot (it leaves any other slot it was in), or empty the slot */
  static assignSlot(slot: number, key: string | null, pc: ModuleCreature | undefined = this.player()) {
    if (slot < 0 || slot >= this.SLOTS) return;
    const bar = this.loadout(pc).map((k) => (key && k === key ? null : k));
    bar[slot] = key;
    try { localStorage.setItem(this.loadoutStorageKey(pc), JSON.stringify(bar)); } catch (e) { /* not saved */ }
    GMManager.notifyChange();
  }

  /** Back to the default bar */
  static resetLoadout(pc: ModuleCreature | undefined = this.player()) {
    try { localStorage.removeItem(this.loadoutStorageKey(pc)); } catch (e) { /* nothing saved */ }
    GMManager.notifyChange();
  }

  // ---------------------------------------------------------------------------
  // Targets
  // ---------------------------------------------------------------------------

  static relation(obj: ModuleObject | undefined | null, pc: ModuleCreature | undefined = this.player()): GMHudRelation | null {
    if (!obj || !pc) return null;
    if (obj === pc) return 'self';
    if (!GMObjectKind.isCreature(obj) || obj.isDead?.()) return 'object';
    if (obj.isHostile?.(pc)) return 'enemy';
    if (GameState.hooks.isPlayerCharacter(obj) || obj.isFriendly?.(pc)) return 'ally';
    return 'neutral';
  }

  /** Living creatures of one side within reach, nearest first */
  static creaturesNear(side: 'enemy' | 'ally', pc: ModuleCreature | undefined = this.player()): ModuleCreature[] {
    if (!pc) return [];
    const all = (GameState.module?.area?.creatures || []) as ModuleCreature[];
    return all
      .filter((c) => c && c !== pc && !c.gmHidden && !c.isDead?.() && this.relation(c, pc) === side)
      .map((c) => ({ c, d: c.position.distanceTo(pc.position) }))
      .filter((e) => e.d <= this.TARGET_RANGE)
      .sort((a, b) => a.d - b.d)
      .map((e) => e.c);
  }

  static selected(): ModuleObject | undefined {
    return GameState.CursorManager?.selectedObject as ModuleObject | undefined;
  }

  /** Make obj the target: KotOR's reticle, and the frame and ring of our HUD */
  static select(obj: ModuleObject | undefined) {
    if (!obj) return;
    GameState.CursorManager.setReticleSelectedObject(obj);
    GameState.CursorManager.setReticleHoveredObject(obj);
    GMManager.notifyChange();
  }

  /** Tab / Shift+Tab: the next enemy or ally after the current target, nearest first, wrapping round */
  static cycle(side: 'enemy' | 'ally'): ModuleCreature | undefined {
    const list = this.creaturesNear(side);
    if (!list.length) return undefined;
    const at = list.indexOf(this.selected() as ModuleCreature);
    const next = list[(at + 1) % list.length];
    this.select(next);
    return next;
  }

  /**
   * Who a use goes to: an enemy (the target, else the nearest, which becomes the target), an ally (the selected
   * ally, else yourself) or yourself. Undefined when there's no enemy to aim at.
   */
  static targetFor(aim: GMHudAim, pc: ModuleCreature | undefined = this.player(), onlyOn?: GMPowerTargetRule): ModuleObject | undefined {
    if (!pc) return undefined;
    if (aim === 'self') return pc;
    const current = this.selected();
    if (aim === 'ally') return this.relation(current, pc) === 'ally' ? current : pc;
    if (this.relation(current, pc) === 'enemy') return GMCombatAI.worksOn(onlyOn, current) ? current : undefined;
    const nearest = this.creaturesNear('enemy', pc).find((c) => GMCombatAI.worksOn(onlyOn, c));
    if (nearest) this.select(nearest);
    return nearest;
  }

  /** Use an ability (from the bar or the wheel). Returns what to tell the player when it can't be done */
  static use(ability: GMHudAbility | undefined): { ok: boolean; message?: string; target?: ModuleObject } {
    const pc = this.player();
    if (!pc || !ability) return { ok: false };
    if (GMManager.isPlayerFrozen(pc)) return { ok: false, message: 'The GM has you watching' };
    if (!ability.usable) return { ok: false, message: ability.why || "Can't use that now" };
    const target = this.targetFor(ability.aim, pc, ability.onlyOn);
    if (!target) {
      if (!ability.onlyOn) return { ok: false, message: 'No enemy in sight' };
      const current = this.selected();
      const who = GMCombatAI.ruleText(ability.onlyOn);
      return { ok: false, message: this.relation(current, pc) === 'enemy' ? `${ability.name} only works on ${who}` : `No ${who === 'droids' ? 'droid' : 'Force user'} in sight` };
    }
    GameState.ActionMenuManager.SetPC(pc);
    GameState.ActionMenuManager.runMenuItem(ability.entry, target);
    return { ok: true, target };
  }

  /**
   * The enemy we were fighting fell: the next nearest becomes the target, so the next key press goes somewhere
   * sensible (KotOR leaves the reticle on the body, or on whatever door is in front of you).
   */
  static retargetAfterKill(): ModuleCreature | undefined {
    const pc = this.player();
    const current = this.selected();
    const alive = !!current && GMObjectKind.isCreature(current) && !current.isDead?.();
    // Only when it died while targeted: a body the player picks on purpose (to search it) stays picked
    const fell = !!pc && !!current && this.watched.target === current && this.watched.alive && !alive &&
      GMObjectKind.isCreature(current) && !!current.isHostile?.(pc);
    this.watched = { target: current, alive };
    if (!fell) return undefined;
    const next = this.creaturesNear('enemy', pc)[0];
    if (next) {
      this.select(next);
      this.watched = { target: next, alive: true };
    }
    return next;
  }

  /** The target as last seen, and whether it was alive then (retargetAfterKill) */
  static watched: { target?: ModuleObject; alive: boolean } = { alive: false };

  // ---------------------------------------------------------------------------
  // What the target allows
  // ---------------------------------------------------------------------------

  /**
   * What the player can do to the target, in plain words, the main one first (R, or a click on the target does
   * the same). Combat powers and items are on the bar and wheel; this is the rest: talk, search, open, unlock,
   * sit, disarm. Each one sends the GM's machine the same request a click or KotOR's own target menu sends.
   */
  static targetActions(target: ModuleObject | undefined = this.selected(), pc: ModuleCreature | undefined = this.player()): GMHudTargetAction[] {
    if (!pc || !target || target === pc || target.gmHidden) return [];
    const out: GMHudTargetAction[] = [];
    const ranks = (skill: SkillType) => Number(pc.getSkillRanks?.(skill) ?? 0);
    const carried = (baseItemId: number) => (pc.getInventory?.() || []).find((i: any) => i?.baseItemId === baseItemId);
    const unlock = () => {
      if (!(target as any).isLocked?.()) return;
      if (ranks(SkillType.SECURITY) >= 1) {
        out.push({ id: 'unlock', label: 'Unlock', title: 'Pick the lock (Security skill)', usable: true });
      }
      const tunneler = carried(this.TUNNELER_BASE_ITEM);
      if (tunneler) {
        out.push({ id: 'tunneler', label: 'Unlock (tunneler)', title: `Open the lock with a ${tunneler.getName?.() || 'security tunneler'}`, usable: true });
      }
      if (!out.some((a) => a.id === 'unlock' || a.id === 'tunneler')) {
        out.push({ id: 'unlock', label: 'Locked', title: 'Locked: you need the Security skill or a security tunneler', usable: false, why: 'Locked' });
      }
    };

    if (GMObjectKind.isCreature(target)) {
      const cre = target as ModuleCreature;
      if (cre.isDead()) {
        out.push({ id: 'search', label: 'Search', title: 'Search the body', usable: true, primary: true });
      } else if (cre.isHostile(pc)) {
        out.push({ id: 'attack', label: 'Attack', title: 'Attack it with what you have in hand', usable: true, primary: true });
      } else if (GameState.GMConversationManager?.canTalkTo?.(cre, pc)) {
        out.push({ id: 'talk', label: 'Talk', title: 'Walk over and talk (the GM speaks for them)', usable: true, primary: true });
      }
      return out;
    }
    if (GMObjectKind.isDoor(target)) {
      const door = target as any;
      if (!door.isOpen?.()) {
        const locked = !!door.isLocked?.();
        out.push({ id: 'open', label: 'Open', title: locked ? 'Try the door (it is locked)' : 'Open the door', usable: !locked, why: locked ? 'Locked' : undefined, primary: !locked });
        unlock();
      }
      return this.markPrimary(out);
    }
    if (GMObjectKind.isPlaceable(target)) {
      const plc = target as any;
      if (GameState.GMConversationManager?.canTalkTo?.(plc, pc)) {
        out.push({ id: 'use', label: 'Use', title: 'Use it (the GM speaks for it)', usable: true, primary: true });
      } else if (GMSeats.seatsOf(plc).length) {
        out.push({ id: 'sit', label: 'Sit', title: 'Sit down here', usable: true, primary: true });
      } else if (plc.hasInventory) {
        const locked = !!plc.isLocked?.();
        out.push({ id: 'search', label: 'Search', title: locked ? 'It is locked' : 'Open it and take what you want', usable: !locked, why: locked ? 'Locked' : undefined, primary: !locked });
        unlock();
      } else if (plc.isUseable?.()) {
        out.push({ id: 'use', label: 'Use', title: 'Use it', usable: true, primary: true });
      }
      return this.markPrimary(out);
    }
    if (GMObjectKind.isTrigger(target) && (target as any).type === ModuleTriggerType.TRAP) {
      if (ranks(SkillType.DEMOLITIONS) >= 1) {
        out.push({ id: 'disarm', label: 'Disarm', title: 'Disarm the mine (Demolitions skill)', usable: !!(target as any).trapDisarmable, primary: true });
        out.push({ id: 'recover', label: 'Recover', title: 'Recover the mine to use yourself (Demolitions skill; harder)', usable: true });
      } else {
        out.push({ id: 'disarm', label: 'Mine', title: 'A mine: you need the Demolitions skill to disarm it', usable: false, why: 'Needs Demolitions' });
      }
    }
    return out;
  }

  /** Security tunnelers (baseitems.2da row) */
  static TUNNELER_BASE_ITEM = 59;

  /** When the usual first action can't be done (a locked door), the first that can is the main one */
  static markPrimary(list: GMHudTargetAction[]): GMHudTargetAction[] {
    if (list.length && !list.some((a) => a.primary && a.usable)) {
      list.forEach((a) => { a.primary = false; });
      const first = list.find((a) => a.usable);
      if (first) first.primary = true;
    }
    return list;
  }

  /** Do one of the target's actions (targetActions). Returns what to tell the player when it can't be done */
  static runTargetAction(id: GMHudTargetAction['id'], target: ModuleObject | undefined = this.selected()): { ok: boolean; message?: string } {
    const pc = this.player();
    if (!pc || !target) return { ok: false, message: 'Nothing targeted' };
    if (GMManager.isPlayerFrozen(pc)) return { ok: false, message: 'The GM has you watching' };
    const action = this.targetActions(target, pc).find((a) => a.id === id);
    if (!action) return { ok: false, message: "Can't do that to it" };
    if (!action.usable) return { ok: false, message: action.why || action.title };
    const menu = (entry: any) => {
      GameState.ActionMenuManager.SetPC(pc);
      GameState.ActionMenuManager.runMenuItem(entry, target);
      return { ok: true };
    };
    const engineAction = (factory: string, params: [number, any][]) => {
      const a = new (GameState.ActionFactory as any)[factory]();
      a.setOwner?.(pc);
      for (const [i, v] of params) a.setParameter(i, ActionParameterType.DWORD, v);
      return a;
    };
    switch (id) {
      case 'unlock':
        return menu({ action: engineAction('ActionUnlockObject', [[0, target], [1, ModuleObjectConstant.OBJECT_INVALID]]) });
      case 'tunneler': {
        const tool = (pc.getInventory?.() || []).find((i: any) => i?.baseItemId === this.TUNNELER_BASE_ITEM);
        return menu({ action: engineAction('ActionUnlockObject', [[0, target], [1, tool]]) });
      }
      case 'disarm':
        return menu({ action: engineAction('ActionDisarmMine', [[0, target]]) });
      case 'recover':
        return menu({ action: engineAction('ActionRecoverMine', [[0, target]]) });
      default:
        // Attack, talk, search, open, use, sit: what clicking it does
        return GameState.hooks.interceptInteraction(pc, target) ? { ok: true } : { ok: false, message: "Can't reach it from here" };
    }
  }

  /**
   * Where an ability would land now, without changing the target: the target, the nearest enemy (no enemy
   * targeted), you, or nowhere (no enemy in reach). The bar and wheel show it on each slot.
   */
  static landsOn(ability: GMHudAbility, pc: ModuleCreature | undefined = this.player()): GMHudLanding {
    if (!pc) return { how: 'none' };
    if (ability.aim === 'self') return { how: 'self', who: pc };
    const current = this.selected();
    if (ability.aim === 'ally') {
      return this.relation(current, pc) === 'ally' ? { how: 'target', who: current } : { how: 'self', who: pc };
    }
    if (this.relation(current, pc) === 'enemy') {
      return GMCombatAI.worksOn(ability.onlyOn, current) ? { how: 'target', who: current } : { how: 'none', wrongKind: true };
    }
    const nearest = this.creaturesNear('enemy', pc).find((c) => GMCombatAI.worksOn(ability.onlyOn, c));
    return nearest ? { how: 'nearest', who: nearest } : { how: 'none', wrongKind: !!ability.onlyOn };
  }

  /** The wheel's order for the target: helping powers first when a friend is targeted, attacks first otherwise */
  static orderForTarget(abilities: GMHudAbility[], pc: ModuleCreature | undefined = this.player()): GMHudAbility[] {
    const friendly = this.relation(this.selected(), pc) === 'ally';
    const rank = (a: GMHudAbility) => friendly ? (a.aim === 'enemy' ? 1 : 0) : (a.aim === 'enemy' ? 0 : 1);
    return abilities.map((a, i) => ({ a, i })).sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i).map((e) => e.a);
  }

  /** Stealth: whether the character can sneak, and whether it is */
  static stealth(pc: ModuleCreature | undefined = this.player()): { can: boolean; on: boolean } {
    const on = !!(pc as any)?.stealthMode;
    return { can: on || !!(pc as any)?.canEnterStealth?.(), on };
  }

  static toggleStealth(): { ok: boolean; message?: string } {
    const pc = this.player();
    if (!pc) return { ok: false };
    if (GMManager.isPlayerFrozen(pc)) return { ok: false, message: 'The GM has you watching' };
    const s = this.stealth(pc);
    if (!s.can) return { ok: false, message: "You can't sneak (no Stealth, or an enemy sees you)" };
    GMNetworkManager.sendIntent('stealth');
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // The wheel and the tactical pause
  // ---------------------------------------------------------------------------

  static tacticalPauseOn(): boolean {
    return !!GMNetworkManager.sessionRules?.tacticalPause?.enabled;
  }

  /** Who is holding the world with their wheel open (tactical pause), as the host last said */
  static heldBy(): string[] {
    return GMNetworkManager.sessionRules?.tacticalPause?.by || [];
  }

  /** Whether the host was told this wheel is open (so closing it tells the host too) */
  static wheelHoldAsked: boolean = false;

  static setWheelOpen(open: boolean) {
    if (this.wheelOpen === open) return;
    this.wheelOpen = open;
    if (open && this.tacticalPauseOn()) {
      this.wheelHoldAsked = true;
      GMNetworkManager.sendIntent('wheel', undefined, { open: true });
    } else if (!open && this.wheelHoldAsked) {
      this.wheelHoldAsked = false;
      GMNetworkManager.sendIntent('wheel', undefined, { open: false });
    }
    GMManager.notifyChange();
  }
}
