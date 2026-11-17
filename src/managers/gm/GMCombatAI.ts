import { GameState } from "@/GameState";
import { GMLog } from "@/managers/gm/GMLog";
import { GMSpawner } from "@/managers/gm/GMSpawner";
import { gmItemResRef } from "@/managers/gm/GMVocab";
import { ModuleItem } from "@/module/ModuleItem";
import { ModuleCreatureArmorSlot } from "@/enums/module/ModuleCreatureArmorSlot";
import { ActionType } from "@/enums/actions/ActionType";
import { GMNpcOrders } from "@/managers/GMNpcOrders";
import type { ModuleCreature } from "@/module/ModuleCreature";
import type { ModuleObject } from "@/module/ModuleObject";
import { GMObjectKind } from "@/managers/gm/GMObjectKind";
import type { TalentSpell } from "@/talents/TalentSpell";
import type { TalentFeat } from "@/talents/TalentFeat";

/** How an NPC may fight (GM's choice per NPC, in the Inspector) */
export type GMCombatStyle = 'all' | 'weapons' | 'attack';

/** A power, combat feat or usable item, sorted by what it's for */
export interface GMCombatTalent {
  /** The power or feat itself, or the item that casts it */
  spell?: TalentSpell;
  feat?: TalentFeat;
  item?: ModuleItem;
  /** spells.2da row the power or item casts */
  spellId: number;
  label: string;
  /** Force points it costs this NPC (0 for items and feats) */
  cost: number;
  /** Metres it reaches (Infinity: on itself or by touch, walking there) */
  range: number;
  /** Area (hits around the target) and, for an area, whether it spares allies */
  area: boolean;
  discriminate: boolean;
  /** Only works on droids (Droid Disable, ion grenades) or on Force users (Force Breach) */
  droidsOnly: boolean;
  forceUsersOnly: boolean;
}

/** What an NPC has to fight with, sorted (GMCombatKit.of) */
export interface GMCombatKit {
  heals: GMCombatTalent[];
  buffs: GMCombatTalent[];
  harms: GMCombatTalent[];
  grenades: GMCombatTalent[];
  meleeFeats: TalentFeat[];
  rangedFeats: TalentFeat[];
  /** Weapons it carries but isn't holding */
  meleeWeapons: ModuleItem[];
  rangedWeapons: ModuleItem[];
}

/** One decision's view of the fight */
export interface GMCombatSituation {
  npc: ModuleCreature;
  target: ModuleCreature;
  distance: number;
  /** Enemies within AREA_RADIUS of the target (the target included), and allies within it */
  clustered: ModuleCreature[];
  alliesNearTarget: ModuleCreature[];
  /** The most hurt ally in reach, if anyone's under the heal threshold */
  hurtAlly: ModuleCreature | null;
  hpRatio: number;
  fp: number;
  /** An enemy already within melee reach of the NPC */
  enemyInMelee: boolean;
  kit: GMCombatKit;
  now: number;
}

/** A small rule: whether it applies and how much it's worth now (score), and what it does (act) */
export interface GMCombatTactic {
  id: string;
  /** Allowed for an NPC set to this style */
  styles: GMCombatStyle[];
  /** Seconds before this tactic can be picked again by the same NPC */
  cooldown: number;
  score(s: GMCombatSituation): { score: number; choice?: any } | null;
  act(s: GMCombatSituation, choice: any): string;
}

const HEAL_BELOW = 0.4;
const SPELL_ROW = (id: number) => GameState.TwoDAManager.datatables.get('spells')?.rows?.[id] || {};
const isSet = (v: any) => v !== undefined && v !== null && v !== '' && v !== '****';
// A plain function: the dev build reads .ts as TSX, where a generic arrow would parse as JSX
function pick<T>(list: T[]): T | undefined {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * GMCombatAI: how GM NPCs fight, on the GM's machine. Each combat round an NPC that's free decides from what it
 * has (GMCombatKit): heal itself or an ally, buff up, throw a grenade or an area power at a cluster, use a power
 * on its target, get the right weapon out, or attack (with a combat feat when it has one). The tactics are a
 * list of small rules (TACTICS); the best-scoring one wins, with a little chance among close scores.
 *
 * It acts through the engine as players' abilities do: TalentSpell.useTalentOnObject (spends Force points),
 * TalentFeat.useTalentOnObject (an attack with the feat), ModuleItem.useItemOnObject (uses up the item).
 */
export class GMCombatAI {

  /** Metres around the target an area power or grenade is worth throwing at */
  static AREA_RADIUS = 5;
  /** Past this, a melee-armed NPC with a ranged weapon carried gets it out */
  static RANGED_DISTANCE = 6;
  /** Within this, an enemy is in melee reach */
  static MELEE_DISTANCE = 2.5;
  /** Scores this close to the best are picked between at random */
  static SCORE_SPREAD = 8;

  static STYLES: { id: GMCombatStyle; label: string; title: string }[] = [
    { id: 'all', label: 'Everything', title: 'Powers, combat feats, grenades, medpacs and the right weapon for the distance' },
    { id: 'weapons', label: 'Weapons only', title: 'Attacks and combat feats, switching weapons; no powers or items' },
    { id: 'attack', label: 'Just attacks', title: 'Plain attacks with whatever it holds' },
  ];

  /** The GM chooses what an NPC fights with */
  static setStyle(npc: ModuleCreature, style: GMCombatStyle) {
    if (!npc) return;
    npc.gmCombatStyle = style === 'all' ? undefined : style;
    GameState.GMManager?.notifyChange?.();
  }

  /**
   * Host: a GM NPC finished a combat round. Choose its next one: carry on attacking, or something else from its
   * kit. The engine keeps an attack going round after round, so this is where the NPC gets to change its mind.
   */
  static onRoundEnd(npc: ModuleCreature) {
    // The AI closing a round itself (startFresh) isn't a round to decide on
    if (npc.gmCombatClosingRound) return;
    const GM = GameState.GMManager;
    if (!GameState.gmMode || !GM || GameState.GMNetworkManager?.role === 'client' || GM.worldHeld()) return;
    if (!GM.isAutonomousNpc(npc)) return;
    // With the GM's NPC AI off, only NPCs under an order fight on
    if (!GM.npcAiEnabled && !GMNpcOrders.getOrder(npc)) return;
    const target = GM.attackTargetOf(npc);
    if (!target || target.isDead?.() || !npc.isHostile(target)) return;
    const area = GameState.module?.area;
    const everyone: ModuleCreature[] = [...(area?.creatures || []), ...(GameState.PartyManager?.party || [])];
    this.engage(npc, target, everyone);
  }

  /** Seconds an NPC is left to finish a power, item or weapon swap before it decides again */
  static ACTING_SECONDS = 2.5;

  /**
   * In the middle of something it chose: a power or item queued (they wait for the combat round), or a weapon
   * swap. Deciding again now would start an attack, which clears what it was about to do.
   */
  static isActing(npc: ModuleCreature): boolean {
    if ((npc.gmCombatActingUntil || 0) > performance.now()) return true;
    return (npc.actionQueue || []).some((a: any) => a?.type === ActionType.ActionCastSpell || a?.type === ActionType.ActionItemCastSpell);
  }

  /** The NPC's own AI scripts asking it to attack wait while it uses a power or an item the GM AI chose */
  static holdsScriptAttack(npc: ModuleCreature): boolean {
    if (!GameState.gmMode || !GameState.GMManager?.isAutonomousNpc?.(npc)) return false;
    // Told to stand down or run: its scripts don't send it back into the fight
    const order = npc.gmOrder?.kind;
    if (order === 'standDown' || order === 'flee') return true;
    if ((npc.gmCombatHoldUntil || 0) > performance.now()) return true;
    return this.isActing(npc);
  }

  /**
   * Who runs a creature's behaviour: the GM's AI, or its own scripts (ScriptControl). The GM's AI does for an NPC
   * while the NPC AI is on or it has a GM order, unless the GM left it to its own scripts (a boss or plot NPC);
   * its story and rules scripts run either way. The two used to run side by side and pull it different ways
   * (k_ai_master turning it about after every fight, attacking someone else mid-power). On a player's machine
   * the GM's machine runs every copied creature, scripts and all
   */
  static runsBehaviourScripts(npc: ModuleCreature): boolean {
    const GM = GameState.GMManager;
    if (!GameState.gmMode || !GM) return true;
    if (GameState.hooks.isNetReplica(npc)) return false;
    if (GameState.GMNetworkManager?.role === 'client') return true;
    if (!GM.isAutonomousNpc(npc) || npc.gmScripted) return true;
    return !(GM.npcAiEnabled || npc.gmOrder);
  }

  /** The GM leaves an NPC's behaviour to its own scripts (true), or to the GM's AI (the default) */
  static setScripted(npc: ModuleCreature, scripted: boolean) {
    if (!npc) return;
    npc.gmScripted = scripted ? true : undefined;
    GameState.GMManager?.notifyChange?.();
  }

  /** Seconds walking towards a target without getting closer before an NPC gives up on reaching it */
  static STUCK_SECONDS = 2.5;
  /** Seconds a target it couldn't reach stays out of its melee plans */
  static UNREACHABLE_SECONDS = 10;

  /**
   * Host, each NPC AI tick: an NPC walking to its target that hasn't got anywhere (blocked by someone or
   * something) stops, counts that target as out of reach for a while, and decides again: a power at range,
   * or someone else to fight. Without this it walks on the spot, and its combat rounds never start.
   */
  static checkStuck(npc: ModuleCreature, everyone: ModuleCreature[]) {
    const now = performance.now();
    // A combat round holding an action that never started, with nothing queued to start it: nothing will.
    // (It counts as busy, so the NPC would never decide again.)
    const round = npc.combatRound;
    if (round && round.action && !round.roundStarted && !(npc.actionQueue || []).length) {
      if (!npc.gmCombatIdleSince) npc.gmCombatIdleSince = now;
      else if (now - npc.gmCombatIdleSince > 1500) {
        npc.gmCombatIdleSince = undefined;
        const was = round.action.target as ModuleCreature | undefined;
        round.clearActions();
        GMLog.info('ai', `${npc.getName()} was waiting on a round that never started; deciding again`);
        if (was && !was.isDead?.() && npc.isHostile(was)) this.engage(npc, was, everyone);
        return;
      }
    } else {
      npc.gmCombatIdleSince = undefined;
    }
    const walking = (npc.actionQueue?.[0] as any)?.type === ActionType.ActionMoveToPoint;
    const target = GameState.GMManager?.attackTargetOf(npc);
    if (!walking || !target || target.isDead?.()) {
      npc.gmCombatProgress = undefined;
      return;
    }
    const p = npc.gmCombatProgress;
    if (!p || p.targetId !== target.id || npc.position.distanceTo(target.position) < p.distance - 0.25) {
      npc.gmCombatProgress = { targetId: target.id, distance: npc.position.distanceTo(target.position), since: now };
      return;
    }
    if (now - p.since < this.STUCK_SECONDS * 1000) return;
    npc.gmCombatProgress = undefined;
    npc.gmCombatUnreachable = { targetId: target.id, until: now + this.UNREACHABLE_SECONDS * 1000 };
    npc.clearAllActions();
    GMLog.info('ai', `${npc.getName()} can't reach ${target.getName()}; deciding again`);
    this.engage(npc, target, everyone);
  }

  /** Seconds a melee NPC with no way through stands ready before looking again */
  static HOLD_SECONDS = 1.5;
  /** Someone this close to the straight line between them is in the way */
  static IN_THE_WAY = 0.75;

  /**
   * Nobody stands in the straight line from the NPC to that creature (within melee reach of it, someone close to
   * it doesn't count: they're fighting it, there may be room beside them)
   */
  static clearWay(npc: ModuleCreature, to: ModuleCreature, everyone: ModuleCreature[]): boolean {
    const ax = npc.position.x, ay = npc.position.y;
    const dx = to.position.x - ax, dy = to.position.y - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 < 0.01) return true;
    const len = Math.sqrt(len2);
    for (const c of everyone) {
      if (!c || c === npc || c === to || c.isDead?.()) continue;
      const t = ((c.position.x - ax) * dx + (c.position.y - ay) * dy) / len2;
      if (t <= 0 || t >= 1) continue;
      // Beside the target, within reach of it: not in the way
      if ((1 - t) * len < 1.5) continue;
      const px = ax + t * dx - c.position.x, py = ay + t * dy - c.position.y;
      if (px * px + py * py < this.IN_THE_WAY * this.IN_THE_WAY) return false;
    }
    return true;
  }

  /** It couldn't get to this target lately (checkStuck) */
  static isUnreachable(npc: ModuleCreature, target: ModuleCreature): boolean {
    const u = npc.gmCombatUnreachable;
    return !!u && u.targetId === target.id && u.until > performance.now();
  }

  /** Attacking this target already (an attack action in its queue, or one in its combat round) */
  static isAttacking(npc: ModuleCreature, target: ModuleCreature): boolean {
    const queued = (npc.actionQueue || []).some((a: any) => a?.type === ActionType.ActionPhysicalAttacks && a.getParameter?.(0) === target);
    return queued || npc.combatRound?.action?.target === target;
  }

  /** Fight with what it has: decide one round's action against this target and start it */
  static engage(npc: ModuleCreature, target: ModuleCreature, everyone: ModuleCreature[]): string {
    // Nobody fights a body
    if (!npc || !target || target.isDead?.()) return '';
    if (this.isActing(npc)) return 'acting';
    // Standing ready for an opening (no way through to anyone it could swing at)
    if ((npc.gmCombatHoldUntil || 0) > performance.now()) return 'hold';
    const style: GMCombatStyle = npc.gmCombatStyle || 'all';
    const attack = () => {
      // Already swinging at them: let the attack carry on
      if (!this.isAttacking(npc, target)) npc.attackCreature(target, undefined);
      return 'attack';
    };
    if (style === 'attack') return attack();
    const s = this.situation(npc, target, everyone);
    let choice = this.choose(s, style);
    // Can't get to them to swing: fight someone it has a clear way to (powers and shots still go to the target).
    // With nobody, it stands ready for an opening: walking at the back of a melee, it slid from side to side
    // behind its own front line and ran in circles
    const melee = !npc.isRangedEquipped?.();
    if (melee && this.isUnreachable(npc, target) && (!choice || choice.tactic.id === 'attack' || choice.tactic.id === 'feat')) {
      const other = everyone
        .filter((c) => c && c !== target && c !== npc && !c.isDead?.() && !c.gmHidden && npc.isHostile(c) && !this.isUnreachable(npc, c))
        .filter((c) => this.clearWay(npc, c, everyone))
        .sort((a, b) => a.position.distanceTo(npc.position) - b.position.distanceTo(npc.position))[0];
      if (other) {
        GMLog.info('ai', `${npc.getName()} turns on ${other.getName()} instead`);
        return this.engage(npc, other, everyone);
      }
      npc.clearAllActions();
      npc.gmCombatHoldUntil = s.now + this.HOLD_SECONDS * 1000;
      GMLog.info('ai', `${npc.getName()} waits for an opening at ${target.getName()}`);
      return 'hold';
    }
    if (!choice || choice.tactic.id === 'attack') return attack();
    const cooldowns: Record<string, number> = npc.gmCombatCooldowns || (npc.gmCombatCooldowns = {});
    cooldowns[choice.tactic.id] = s.now + choice.tactic.cooldown * 1000;
    // Something else this round: stop the attack that's going, so it isn't stuck behind it
    npc.clearAllActions();
    npc.gmCombatActingUntil = s.now + this.ACTING_SECONDS * 1000;
    const what = choice.tactic.act(s, choice.choice);
    GMLog.info('ai', `${npc.getName()} ${what}`);
    return choice.tactic.id;
  }

  /** The best tactic now (with a little chance among close scores), or null to just attack */
  static choose(s: GMCombatSituation, style: GMCombatStyle): { tactic: GMCombatTactic; choice: any } | null {
    const cooldowns: Record<string, number> = s.npc.gmCombatCooldowns || {};
    const options: { tactic: GMCombatTactic; score: number; choice: any }[] = [];
    for (const tactic of this.TACTICS) {
      if (!tactic.styles.includes(style)) continue;
      if ((cooldowns[tactic.id] || 0) > s.now) continue;
      let result: { score: number; choice?: any } | null = null;
      try { result = tactic.score(s); } catch (e) { GMLog.warn('ai', `${tactic.id} failed for ${s.npc.getName()}`, e); }
      if (result && result.score > 0) options.push({ tactic, score: result.score, choice: result.choice });
    }
    if (!options.length) return null;
    options.sort((a, b) => b.score - a.score);
    const close = options.filter((o) => o.score >= options[0].score - this.SCORE_SPREAD);
    const chosen = pick(close)!;
    return { tactic: chosen.tactic, choice: chosen.choice };
  }

  /** What the NPC sees this round */
  static situation(npc: ModuleCreature, target: ModuleCreature, everyone: ModuleCreature[]): GMCombatSituation {
    const alive = everyone.filter((c) => c && c !== npc && !c.isDead?.() && !c.gmHidden);
    const enemies = alive.filter((c) => npc.isHostile(c));
    const allies = alive.filter((c) => !npc.isHostile(c) && !c.isHostile?.(npc));
    const near = (list: ModuleCreature[], point: any, r: number) => list.filter((c) => c.position.distanceTo(point) <= r);
    const hpRatio = (c: ModuleCreature) => { const max = Number(c.getMaxHP?.()) || 0; return max > 0 ? (Number(c.getHP?.()) || 0) / max : 1; };
    const hurt = allies
      .filter((c) => c.position.distanceTo(npc.position) <= 15 && hpRatio(c) < HEAL_BELOW)
      .sort((a, b) => hpRatio(a) - hpRatio(b))[0] || null;
    return {
      npc,
      target,
      distance: npc.position.distanceTo(target.position),
      clustered: [target, ...near(enemies.filter((c) => c !== target), target.position, this.AREA_RADIUS)],
      alliesNearTarget: near(allies, target.position, this.AREA_RADIUS),
      hurtAlly: hurt,
      hpRatio: hpRatio(npc),
      fp: Number(npc.getFP?.()) || 0,
      enemyInMelee: enemies.some((c) => c.position.distanceTo(npc.position) <= (c.getMeleeRange?.(npc) ?? 2) + this.MELEE_DISTANCE - 2),
      kit: this.kitOf(npc),
      now: performance.now(),
    };
  }

  // --- The kit ---------------------------------------------------------------------------------------------

  /** Sort what an NPC has: its powers (by spells.2da's columns), combat feats, usable items and spare weapons */
  static kitOf(npc: ModuleCreature): GMCombatKit {
    const kit: GMCombatKit = { heals: [], buffs: [], harms: [], grenades: [], meleeFeats: [], rangedFeats: [], meleeWeapons: [], rangedWeapons: [] };

    for (const spell of (npc.getSpells?.() || []) as TalentSpell[]) {
      const entry = this.describeSpell(spell.id, { spell, cost: spell.getForcePointCost?.(npc) ?? 0 });
      this.sort(kit, entry, SPELL_ROW(spell.id));
    }

    // Combat feats: the highest of each chain (Power Attack -> Improved -> Master)
    const feats = (npc.getFeats?.() || []) as TalentFeat[];
    const ids = new Set(feats.map((f) => f.id));
    for (const feat of feats) {
      if (feat.successor >= 0 && ids.has(feat.successor)) continue;
      if (feat.category === 0x1104) kit.meleeFeats.push(feat);
      else if (feat.category === 0x1111) kit.rangedFeats.push(feat);
    }

    // Carried items: medpacs, shots and shields, grenades; and weapons it isn't holding
    const seen = new Set<string>();
    for (const item of [...(npc.inventory || []), npc.equipment?.LEFTARMBAND, npc.equipment?.RIGHTARMBAND].filter(Boolean) as ModuleItem[]) {
      if (this.isSpareWeapon(npc, item)) {
        (item.isRangedWeapon() ? kit.rangedWeapons : kit.meleeWeapons).push(item);
        continue;
      }
      const property = item.getUsableCastSpellProperties?.()[0];
      if (!property) continue;
      const spellId = ModuleItem.GetCastSpellId(property);
      const key = `${gmItemResRef(item)}:${spellId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.sort(kit, this.describeSpell(spellId, { item, cost: 0 }), SPELL_ROW(spellId));
    }
    return kit;
  }

  static describeSpell(spellId: number, from: { spell?: TalentSpell; item?: ModuleItem; cost: number }): GMCombatTalent {
    const row = SPELL_ROW(spellId);
    const category = parseInt(String(row.category || ''), 16) || 0;
    const grenade = String(row.impactscript || '').toLowerCase() === 'k_sup_grenade';
    const range = from.spell?.getCastRange?.() ?? ({ L: 28, M: 15, S: 10, W: 15 } as Record<string, number>)[String(row.range || '').toUpperCase()] ?? Infinity;
    const label = String(row.label || `spell ${spellId}`);
    return {
      ...from,
      spellId,
      label,
      range: grenade ? 15 : range,
      // Area powers' talent category starts 0x2... (Death Field, Storm, Wave, Insanity, Mass Stasis); grenades burst
      area: grenade || (category >> 12) === 2,
      // Grenades hit everyone; area Force powers in KotOR pick out the caster's enemies
      discriminate: !grenade,
      // Droid powers, and ion grenades (GRENADE_ION, not every name with ION in it, like FRAGMENTATION)
      droidsOnly: String(row.forcehostile) === '1' || /(^|_)ION($|_)/.test(label),
      forceUsersOnly: String(row.forcehostile) === '8',
    };
  }

  /** Put one power or item in the kit by what it does */
  static sort(kit: GMCombatKit, t: GMCombatTalent, row: any) {
    const script = String(row.impactscript || '').toLowerCase();
    if (script === 'k_sup_grenade') kit.grenades.push(t);
    else if (script === 'k_sup_healing' || String(row.forcefriendly) === '0') kit.heals.push(t);
    else if (isSet(row.forcehostile)) kit.harms.push(t);
    else if (isSet(row.forcefriendly) || script === 'k_sup_comshots' || script === 'k_sup_bands') kit.buffs.push(t);
  }

  /** A weapon it carries (not one in its hands) that goes in the right hand */
  static isSpareWeapon(npc: ModuleCreature, item: ModuleItem): boolean {
    if (!item || item === npc.equipment?.RIGHTHAND || item === npc.equipment?.LEFTHAND) return false;
    const slots = Number(item.getBaseItem?.()?.equipableSlots) || 0;
    return (slots & ModuleCreatureArmorSlot.RIGHTHAND) !== 0 && (item.getWeaponType?.() || 0) > 0;
  }

  // --- Helpers for the tactics -------------------------------------------------------------------------------

  static hasEffectFrom(cre: ModuleCreature, spellId: number): boolean {
    return (cre?.effects || []).some((e: any) => e && e.spellId === spellId);
  }

  static isDroid(cre: ModuleCreature): boolean {
    return Number(cre?.getRace?.()) === 5;
  }

  static isForceUser(cre: ModuleCreature): boolean {
    return (Number(cre?.getMaxFP?.()) || 0) > 0;
  }

  /** It can use this on that target now: affordable, in reach, on a target it works on */
  static usableOn(s: GMCombatSituation, t: GMCombatTalent, on: ModuleCreature): boolean {
    if (t.cost > s.fp) return false;
    if (on !== s.npc && on.position.distanceTo(s.npc.position) > t.range) return false;
    if (t.droidsOnly && !this.isDroid(on)) return false;
    if (t.forceUsersOnly && !this.isForceUser(on)) return false;
    return true;
  }

  /**
   * Close the combat round it's in, so what comes next starts a round of its own. An item used mid-round (an
   * attack's round, started and paused) waits on that round and never goes off.
   */
  static startFresh(npc: ModuleCreature) {
    const round = npc.combatRound;
    if (!round?.roundStarted) return;
    npc.gmCombatClosingRound = true;
    try { round.endCombatRound(); } finally { npc.gmCombatClosingRound = false; }
  }

  /** Use a power or item: the engine queues the cast in the combat round and pays for it */
  static use(s: GMCombatSituation, t: GMCombatTalent, on: ModuleCreature): string {
    if (t.item) {
      this.startFresh(s.npc);
      // Closing the round runs its OnEndRound script, which queues the next attack: that goes too
      s.npc.clearAllActions();
      t.item.possessor = s.npc;
      t.item.useItemOnObject(s.npc, on);
      return `uses ${t.label} on ${on === s.npc ? 'itself' : on.getName()}`;
    }
    t.spell?.useTalentOnObject(on, s.npc);
    return `casts ${t.label} on ${on === s.npc ? 'itself' : on.getName()}`;
  }

  /**
   * Swap the weapon in its hand for one it carries (the one it puts away goes back in its pack). One swap at a time:
   * a second one decided while the first was still loading items worked from the wrong weapon in hand, and lost
   * or doubled weapons (a body dropped two rifles and no sword)
   */
  static equipWeapon(npc: ModuleCreature, weapon: ModuleItem): Promise<void> {
    if (npc.gmWeaponSwap) return npc.gmWeaponSwap;
    npc.gmWeaponSwap = this.swapWeapon(npc, weapon).finally(() => { npc.gmWeaponSwap = undefined; });
    return npc.gmWeaponSwap;
  }

  private static async swapWeapon(npc: ModuleCreature, wanted: ModuleItem): Promise<void> {
    const old = npc.equipment?.RIGHTHAND;
    const oldResRef = old ? gmItemResRef(old) : '';
    const list = npc.inventory || [];
    // The one in its pack now: the kit may hold an item that was put away and came back as a fresh one. Equipping
    // the old object left the fresh one in the pack too
    let i = list.indexOf(wanted);
    if (i < 0) {
      const resRef = gmItemResRef(wanted);
      i = list.findIndex((item) => gmItemResRef(item) === resRef);
      if (i < 0) return;
    }
    const weapon = list[i];
    list.splice(i, 1);
    // A two-handed or paired setup: the left hand's weapon goes away too when switching to ranged
    if (weapon.isRangedWeapon() && npc.equipment?.LEFTHAND?.getWeaponType?.()) {
      const leftResRef = gmItemResRef(npc.equipment.LEFTHAND);
      npc.unequipSlot(ModuleCreatureArmorSlot.LEFTHAND);
      if (leftResRef) list.push(await GMSpawner.createItemFromResRefAsync(leftResRef));
    }
    await npc.equipItem(ModuleCreatureArmorSlot.RIGHTHAND, weapon);
    // Unequipping destroys the item it held: put a fresh one of the same back in its pack
    if (oldResRef) {
      const back = await GMSpawner.createItemFromResRefAsync(oldResRef).catch((): null => null);
      if (back) list.push(back);
    }
  }

  // --- The tactics -------------------------------------------------------------------------------------------

  static TACTICS: GMCombatTactic[] = [
    {
      id: 'heal-self',
      styles: ['all'],
      cooldown: 6,
      score: (s) => {
        if (s.hpRatio >= HEAL_BELOW) return null;
        const heal = s.kit.heals.find((t) => GMCombatAI.usableOn(s, t, s.npc));
        return heal ? { score: 95 - s.hpRatio * 50, choice: heal } : null;
      },
      act: (s, heal: GMCombatTalent) => GMCombatAI.use(s, heal, s.npc),
    },
    {
      id: 'heal-ally',
      styles: ['all'],
      cooldown: 6,
      score: (s) => {
        const ally = s.hurtAlly;
        if (!ally) return null;
        // Items heal their user; powers reach others
        const heal = s.kit.heals.find((t) => t.spell && GMCombatAI.usableOn(s, t, ally));
        // Worth more the closer they are to dropping: a caster with someone a little hurt nearby (most of a big
        // fight) kept healing instead of using its attack powers
        const ratio = (Number(ally.getHP?.()) || 0) / Math.max(1, Number(ally.getMaxHP?.()) || 1);
        return heal ? { score: 55 + (HEAL_BELOW - ratio) * 100, choice: { heal, ally } } : null;
      },
      act: (s, c: { heal: GMCombatTalent; ally: ModuleCreature }) => GMCombatAI.use(s, c.heal, c.ally),
    },
    {
      id: 'buff',
      styles: ['all'],
      cooldown: 4,
      score: (s) => {
        if (s.distance > 25) return null;
        const buffs = s.kit.buffs.filter((t) => !GMCombatAI.hasEffectFrom(s.npc, t.spellId) && GMCombatAI.usableOn(s, t, s.npc));
        const buff = pick(buffs);
        // Most worth it while the fight is young; still useful once a buff has run out
        return buff ? { score: 62, choice: buff } : null;
      },
      act: (s, buff: GMCombatTalent) => GMCombatAI.use(s, buff, s.npc),
    },
    {
      id: 'area',
      styles: ['all'],
      cooldown: 8,
      score: (s) => {
        if (s.clustered.length < 2) return null;
        const options = [...s.kit.harms.filter((t) => t.area), ...s.kit.grenades]
          .filter((t) => GMCombatAI.usableOn(s, t, s.target))
          // A grenade would catch allies standing there too
          .filter((t) => t.discriminate || !s.alliesNearTarget.length)
          // Not in its own blast
          .filter((t) => t.discriminate || s.distance > GMCombatAI.AREA_RADIUS);
        const choice = pick(options);
        return choice ? { score: 70 + 6 * (s.clustered.length - 2), choice } : null;
      },
      act: (s, t: GMCombatTalent) => `${GMCombatAI.use(s, t, s.target)} (${s.clustered.length} enemies close together)`,
    },
    {
      id: 'power',
      styles: ['all'],
      cooldown: 3,
      score: (s) => {
        const options = s.kit.harms
          .filter((t) => !t.area && GMCombatAI.usableOn(s, t, s.target))
          // Not again on a target still under it (stun, slow, fear...)
          .filter((t) => !GMCombatAI.hasEffectFrom(s.target, t.spellId));
        const choice = pick(options);
        return choice ? { score: 64 + Math.random() * 12, choice } : null;
      },
      act: (s, t: GMCombatTalent) => GMCombatAI.use(s, t, s.target),
    },
    {
      id: 'weapon',
      styles: ['all', 'weapons'],
      cooldown: 8,
      score: (s) => {
        const holding = s.npc.equipment?.RIGHTHAND;
        const ranged = !!holding && s.npc.isRangedEquipped?.();
        if (!holding) {
          // Nothing out: whichever suits the distance, else whatever it has
          const weapon = (s.distance > GMCombatAI.RANGED_DISTANCE ? s.kit.rangedWeapons[0] : s.kit.meleeWeapons[0]) || s.kit.rangedWeapons[0] || s.kit.meleeWeapons[0];
          return weapon ? { score: 98, choice: weapon } : null;
        }
        if (!ranged && s.distance > GMCombatAI.RANGED_DISTANCE && !s.enemyInMelee && s.kit.rangedWeapons[0]) return { score: 80, choice: s.kit.rangedWeapons[0] };
        if (ranged && s.enemyInMelee && s.kit.meleeWeapons[0]) return { score: 80, choice: s.kit.meleeWeapons[0] };
        return null;
      },
      act: (s, weapon: ModuleItem) => {
        void GMCombatAI.equipWeapon(s.npc, weapon).catch((e) => GMLog.warn('ai', `${s.npc.getName()} couldn't switch weapons`, e));
        return `gets out ${weapon.getName?.() || gmItemResRef(weapon)}`;
      },
    },
    {
      id: 'feat',
      styles: ['all', 'weapons'],
      cooldown: 0,
      score: (s) => {
        const feats = s.npc.isRangedEquipped?.() ? s.kit.rangedFeats : s.kit.meleeFeats;
        const feat = pick(feats);
        return feat ? { score: 45 + Math.random() * 15, choice: feat } : null;
      },
      act: (s, feat: TalentFeat) => {
        feat.useTalentOnObject(s.target, s.npc);
        return `attacks ${s.target.getName()} with ${feat.label || `feat ${feat.id}`}`;
      },
    },
    {
      id: 'attack',
      styles: ['all', 'weapons'],
      cooldown: 0,
      score: () => ({ score: 40 }),
      act: (s) => {
        s.npc.attackCreature(s.target, undefined);
        return `attacks ${s.target.getName()}`;
      },
    },
  ];
}
