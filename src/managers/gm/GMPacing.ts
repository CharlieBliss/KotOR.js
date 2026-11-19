import { GameState } from "@/GameState";
import { GMLog } from "@/managers/gm/GMLog";
import { CombatRound } from "@/combat/CombatRound";
import { CombatActionType } from "@/enums/combat/CombatActionType";
import { ActionType } from "@/enums/actions/ActionType";
import type { ModuleCreature } from "@/module/ModuleCreature";

/** When the world holds for everyone to plan: every round, every 2 or 3 rounds, only on events, or never */
export type GMPacingMode = 'off' | 'every' | 'every2' | 'every3' | 'events';

/** off: real time (no fight, or pacing is off) · plan: the world holds while everyone chooses · play: one round runs */
export type GMPacingPhase = 'off' | 'plan' | 'play';

/** What players need to know about the pacing (sent in the session rules) */
export interface GMPacingState {
  mode: GMPacingMode;
  phase: GMPacingPhase;
  /** The round being planned or played (1 = the fight's first) */
  round: number;
  /** Players who are ready, and those still choosing (names) */
  ready: string[];
  waiting: string[];
  /** Seconds left to plan when sent (a time limit), or undefined */
  secondsLeft?: number;
  timeLimit: number;
  showIntents: boolean;
}

/** One look at the scene for the pacing (GMPacing.scan, or a test's) */
export interface GMPacingScan {
  /** A fight is on: a player character, or an NPC hostile to one, is in combat */
  fighting: boolean;
  /** NPCs hostile to the players that are in combat now */
  hostilesInCombat: Set<unknown>;
  /** Player characters: an id, and their health (0 to 1) */
  players: { id: string; health: number }[];
  /** Players (peer ids) who plan: connected, with a living character in the scene */
  planners: string[];
}

export const GM_PACING_MODES: { id: GMPacingMode; label: string; title: string }[] = [
  { id: 'off', label: 'Real time', title: 'Fights run in real time' },
  { id: 'every', label: 'Every round', title: 'The world holds before every round while everyone plans' },
  { id: 'every2', label: 'Every 2 rounds', title: 'The world holds every second round' },
  { id: 'every3', label: 'Every 3 rounds', title: 'The world holds every third round' },
  { id: 'events', label: 'On events', title: 'The world holds when the fight starts, a new enemy joins, a player falls or gets badly hurt' },
];

/**
 * Plan-then-play fights (the host's): the world holds, everyone picks what to do, one round (3 s) plays, and the
 * world holds again. The rounds line up by themselves: everyone's round is decided in the hold and starts at Go,
 * so they all end together a round later.
 */
export class GMPacing {
  static mode: GMPacingMode = 'off';
  /** Seconds to plan before the round plays anyway (0: no limit) */
  static timeLimit: number = 0;
  static showIntents: boolean = true;

  static phase: GMPacingPhase = 'off';
  static round: number = 0;
  /** World seconds played in this window */
  static windowTime: number = 0;
  /** Windows played since the last hold */
  static windowsSinceHold: number = 0;
  /** World seconds with no fight (the fight ends after FIGHT_END_SECONDS) */
  static quietTime: number = 0;
  /** When planning ends anyway (clock ms; 0: no limit) */
  static deadline: number = 0;
  /** Players (peer ids) who are ready */
  static ready: Set<string> = new Set();
  /** Players planning this hold */
  static planners: string[] = [];

  // What the events mode watches: the hostiles already in the fight, and players already hurt or down
  static seenHostiles: Set<unknown> = new Set();
  static hurtPlayers: Set<string> = new Set();
  static downPlayers: Set<string> = new Set();

  static FIGHT_END_SECONDS = 4;
  /** How near (metres) a living enemy keeps a player's fight going */
  static FIGHT_RANGE = 30;
  static LOW_HEALTH = 0.25;
  static now: () => number = () => Date.now();

  static configure(settings: { mode?: GMPacingMode; timeLimit?: number; showIntents?: boolean }) {
    if (settings.mode && GM_PACING_MODES.some((m) => m.id === settings.mode)) this.mode = settings.mode;
    if (typeof settings.timeLimit === 'number' && settings.timeLimit >= 0) {
      this.timeLimit = settings.timeLimit;
      if (this.phase === 'plan') this.deadline = this.timeLimit ? this.now() + this.timeLimit * 1000 : 0;
    }
    if (typeof settings.showIntents === 'boolean') this.showIntents = settings.showIntents;
    if (this.mode === 'off' && this.phase !== 'off') this.stop('pacing is off');
    else this.changed();
  }

  /** Rounds played between holds (events mode holds only on its events) */
  static windowsPerHold(): number {
    return this.mode === 'every' ? 1 : this.mode === 'every2' ? 2 : this.mode === 'every3' ? 3 : Infinity;
  }

  /** The host, each frame: delta in seconds; heldOtherwise when the GM's pause or a power wheel holds the world */
  static update(delta: number, scan?: GMPacingScan, heldOtherwise = false) {
    if (this.mode === 'off') {
      if (this.phase !== 'off') this.stop('pacing is off');
      return;
    }
    const s = scan ?? this.scan();
    if (this.phase === 'off') {
      if (s.fighting) this.hold('the fight starts', s);
      return;
    }
    if (this.phase === 'plan') {
      this.updatePlanners(s.planners);
      if (this.planners.length && this.planners.every((p) => this.ready.has(p))) this.go('everyone is ready');
      else if (this.deadline && this.now() >= this.deadline) this.go('time is up');
      return;
    }
    // Playing: world time only (the GM's pause or an open wheel stops the clock too)
    if (heldOtherwise) return;
    if (!s.fighting) {
      this.quietTime += delta;
      if (this.quietTime >= this.FIGHT_END_SECONDS) this.stop('the fight is over');
      return;
    }
    this.quietTime = 0;
    const event = this.mode === 'events' ? this.eventIn(s) : '';
    this.remember(s);
    if (event) {
      this.hold(event, s);
      return;
    }
    this.windowTime += delta;
    if (this.windowTime * 1000 >= CombatRound.ROUND_LENGTH) {
      this.windowTime = 0;
      this.windowsSinceHold++;
      this.round++;
      if (this.windowsSinceHold >= this.windowsPerHold()) this.hold(`round ${this.round}`, s);
    }
  }

  /** What in this look holds the world in events mode: a new enemy, a player down, a player badly hurt */
  static eventIn(scan: GMPacingScan): string {
    for (const h of scan.hostilesInCombat) if (!this.seenHostiles.has(h)) return `${this.nameOf(h)} joins the fight`;
    for (const p of scan.players) {
      if (p.health <= 0 && !this.downPlayers.has(p.id)) return `${p.id} is down`;
    }
    for (const p of scan.players) {
      if (p.health > 0 && p.health < this.LOW_HEALTH && !this.hurtPlayers.has(p.id)) return `${p.id} is badly hurt`;
    }
    return '';
  }

  static remember(scan: GMPacingScan) {
    for (const h of scan.hostilesInCombat) this.seenHostiles.add(h);
    for (const p of scan.players) {
      if (p.health <= 0) this.downPlayers.add(p.id);
      else this.downPlayers.delete(p.id);
      // Hurt once a fight (healed above it and hurt again doesn't hold again)
      if (p.health < this.LOW_HEALTH) this.hurtPlayers.add(p.id);
    }
  }

  /** Hold the world for everyone to plan */
  static hold(reason: string, scan?: GMPacingScan) {
    const starting = this.phase === 'off';
    if (starting) {
      this.round = 1;
      this.seenHostiles.clear();
      this.hurtPlayers.clear();
      this.downPlayers.clear();
    }
    if (scan) {
      this.remember(scan);
      this.updatePlanners(scan.planners);
    }
    // The enemies decide the coming round now, so what they're about to do shows while players plan
    this.decideEnemies();
    this.phase = 'plan';
    this.ready.clear();
    this.windowTime = 0;
    this.windowsSinceHold = 0;
    this.quietTime = 0;
    this.deadline = this.timeLimit ? this.now() + this.timeLimit * 1000 : 0;
    GMLog.info('pacing', `round ${this.round}: planning (${reason})`);
    this.changed();
  }

  /** Play the planned round */
  static go(reason: string) {
    if (this.phase !== 'plan') return;
    this.phase = 'play';
    this.ready.clear();
    this.deadline = 0;
    GMLog.info('pacing', `round ${this.round}: go (${reason})`);
    this.changed();
  }

  static stop(reason: string) {
    if (this.phase === 'off') return;
    this.phase = 'off';
    this.ready.clear();
    this.planners = [];
    this.deadline = 0;
    this.windowTime = 0;
    this.windowsSinceHold = 0;
    this.quietTime = 0;
    GMLog.info('pacing', `back to real time (${reason})`);
    this.changed();
  }

  /** A player is ready (or not) to play the round */
  static setReady(peerId: string, ready: boolean) {
    if (this.phase !== 'plan') return;
    if (ready === this.ready.has(peerId)) return;
    if (ready) this.ready.add(peerId);
    else this.ready.delete(peerId);
    this.changed();
  }

  static updatePlanners(planners: string[]) {
    const changed = planners.length !== this.planners.length || planners.some((p, i) => p !== this.planners[i]);
    this.planners = planners.slice();
    for (const p of [...this.ready]) if (!planners.includes(p)) this.ready.delete(p);
    if (changed && this.phase === 'plan') this.changed();
  }

  /** The pacing as players see it */
  static state(): GMPacingState {
    const name = (peerId: string) => GameState.GMNetworkManager?.peers?.get(peerId)?.name || peerId;
    return {
      mode: this.mode,
      phase: this.phase,
      round: this.round,
      ready: this.planners.filter((p) => this.ready.has(p)).map(name),
      waiting: this.planners.filter((p) => !this.ready.has(p)).map(name),
      secondsLeft: this.phase === 'plan' && this.deadline ? Math.max(0, Math.ceil((this.deadline - this.now()) / 1000)) : undefined,
      timeLimit: this.timeLimit,
      showIntents: this.showIntents,
    };
  }

  /** Tell everyone (the session rules carry the pacing), and redraw the GM's panel */
  static changed() {
    const GM = GameState.GMManager;
    if (!GM) return;
    if (GameState.GMNetworkManager?.role === 'host') GameState.GMNetworkManager.broadcastSessionRules(GM.sessionRules());
    GM.notifyChange?.();
  }

  static decideEnemies() {
    const GM = GameState.GMManager;
    if (!GM || GameState.GMNetworkManager?.role === 'client') return;
    try {
      GM.updateNpcCombat?.(GM.npcAiEnabled);
    } catch (e) {
      console.warn('[GM pacing] the enemies could not decide', e);
    }
  }

  /** The host's look at the scene */
  static scan(): GMPacingScan {
    const GM = GameState.GMManager;
    const area = GameState.module?.area;
    const out: GMPacingScan = { fighting: false, hostilesInCombat: new Set(), players: [], planners: [] };
    if (!GM || !area) return out;
    const players: ModuleCreature[] = (GM.spawnedPlayers || []).filter((p: any) => p && !p.destroyed);
    let playerInCombat = false;
    for (const p of players) {
      const max = p.getMaxHP?.() || 1;
      out.players.push({ id: p.getName?.() || String(p.gmNetId), health: (p.getHP?.() ?? max) / max });
      if (p.combatData?.combatState) playerInCombat = true;
      if (p.gmOwnerPeerId && !p.isDead?.() && GameState.GMNetworkManager?.peers?.has(p.gmOwnerPeerId)) {
        if (!out.planners.includes(p.gmOwnerPeerId)) out.planners.push(p.gmOwnerPeerId);
      }
    }
    // A player still in their combat stance after the last enemy fell isn't a fight: one needs a living enemy near
    let enemyNear = false;
    for (const c of (area.creatures || []) as ModuleCreature[]) {
      if (!c || c.destroyed || c.gmHidden || c.isDead?.() || players.includes(c)) continue;
      const foes = players.filter((p) => c.isHostile?.(p) && !p.isDead?.());
      if (!foes.length) continue;
      if (foes.some((p) => c.position?.distanceTo?.(p.position) <= this.FIGHT_RANGE)) enemyNear = true;
      if (!c.combatData?.combatState) continue;
      out.hostilesInCombat.add(c);
    }
    out.fighting = out.hostilesInCombat.size > 0 || (playerInCombat && enemyNear);
    out.planners.sort();
    return out;
  }

  static nameOf(obj: any): string {
    return obj?.getName?.() || obj?.name || 'someone';
  }

  /**
   * What a creature is about to do, in a few words ("attacking Mira", "Force Lightning → Mira", "moving"), from
   * its combat round and its action queue
   */
  static describeIntent(cre: ModuleCreature | undefined): string {
    if (!cre) return '';
    const on = (t: any) => (t && t !== cre ? this.nameOf(t) : '');
    const round: any = (cre as any).combatRound;
    const action = round?.action || round?.scheduledActionList?.[0];
    if (action) {
      const target = on(action.target);
      switch (action.actionType) {
        case CombatActionType.ATTACK:
          return target ? `attacking ${target}` : 'attacking';
        case CombatActionType.ATTACK_USE_FEAT:
          return target ? `special attack → ${target}` : 'special attack';
        case CombatActionType.CAST_SPELL:
          return `${this.spellName(action.spell)}${target ? ` → ${target}` : ''}`;
        case CombatActionType.ITEM_CAST_SPELL:
          return `using an item${target ? ` → ${target}` : ''}`;
      }
    }
    const next: any = (cre as any).actionQueue?.[0] || (cre as any).action;
    if (next) {
      const target = on(next.target);
      switch (next.type) {
        case ActionType.ActionPhysicalAttacks:
          return target ? `attacking ${target}` : 'attacking';
        case ActionType.ActionCastSpell:
          return `using a power${target ? ` → ${target}` : ''}`;
        case ActionType.ActionItemCastSpell:
          return `using an item${target ? ` → ${target}` : ''}`;
        case ActionType.ActionMoveToPoint:
          return 'moving';
        case ActionType.ActionUseObject:
          return target ? `using ${target}` : 'using something';
      }
    }
    return '—';
  }

  static spellName(spell: any): string {
    if (!spell) return 'a power';
    try {
      const text = GameState.TLKManager?.GetStringById?.(spell.name)?.Value;
      if (text) return text;
    } catch (e) {
      // No talk table: its label instead
    }
    return String(spell.label || 'a power').replace(/_/g, ' ');
  }

  /** A planned move kept within one round's run of the character (x, y in metres) */
  static clampMove(from: { x: number; y: number }, to: { x: number; y: number }, maxDistance: number): { x: number; y: number } {
    const dx = to.x - from.x, dy = to.y - from.y;
    const d = Math.hypot(dx, dy);
    if (!(d > maxDistance) || d === 0) return { x: to.x, y: to.y };
    const k = maxDistance / d;
    return { x: from.x + dx * k, y: from.y + dy * k };
  }
}
