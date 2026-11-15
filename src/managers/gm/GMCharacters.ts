import { GameState } from "@/GameState";
import { GameEngineType } from "@/enums/engine/GameEngineType";
import { CharacterBuilder } from "@/engine/rules/CharacterBuilder";
import { ABILITIES } from "@/engine/rules/CharacterRules";
import type { GMCharacter, GMPlayerSpawnConfig } from "@/managers/gm/GMTypes";

const STORAGE_PREFIX = 'kotorjs.gm.characters.';

/**
 * The characters a player has made for GM sessions: kept in this browser (per game), exported and imported
 * as files, and turned into the spawn config a session admits a player with.
 */
export class GMCharacters {

  /** Listeners told when the saved list changes */
  static listeners = new Set<() => void>();

  static game(): 'kotor' | 'tsl' {
    return GameState.GameKey === GameEngineType.TSL ? 'tsl' : 'kotor';
  }

  static storageKey(game = this.game()): string {
    return STORAGE_PREFIX + game;
  }

  /** The saved characters, most recently changed first */
  static list(game = this.game()): GMCharacter[] {
    try {
      if (typeof localStorage === 'undefined') return [];
      const parsed = JSON.parse(localStorage.getItem(this.storageKey(game)) || '[]');
      return (Array.isArray(parsed) ? parsed : []).filter((c) => this.isCharacter(c)).sort((a, b) => b.updated - a.updated);
    } catch (e) {
      return [];
    }
  }

  static get(id: string): GMCharacter | undefined {
    return this.list().find((c) => c.id === id);
  }

  /** Save a character (new, or replacing the one with its id); returns what was saved */
  static save(character: GMCharacter): GMCharacter {
    const saved: GMCharacter = { ...character, id: character.id || this.newId(), version: 1, updated: Date.now() };
    const others = this.list(saved.game).filter((c) => c.id !== saved.id);
    this.write(saved.game, [saved, ...others]);
    return saved;
  }

  static remove(id: string) {
    this.write(this.game(), this.list().filter((c) => c.id !== id));
  }

  static write(game: 'kotor' | 'tsl', list: GMCharacter[]) {
    try {
      localStorage.setItem(this.storageKey(game), JSON.stringify(list));
    } catch (e) {
      console.warn('[GMCharacters] Could not save characters:', e);
    }
    for (const listener of this.listeners) listener();
  }

  static newId(): string {
    return `chr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  // --- Files ---------------------------------------------------------------------------------------

  /** A character as a file's text */
  static toFileText(character: GMCharacter): string {
    return JSON.stringify({ format: 'kotorjs-gm-character', ...character }, null, 2);
  }

  /** Offer a character as a file download (in the browser) */
  static download(character: GMCharacter) {
    const blob = new Blob([this.toFileText(character)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(character.name || 'character').replace(/[^\w-]+/g, '_')}.kotorjs-character.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * A character from a file's text, with a fresh id so it doesn't replace one already saved; null (and why)
   * when the text isn't one
   */
  static fromFileText(text: string): { character: GMCharacter | null, problem?: string } {
    let parsed: any;
    try { parsed = JSON.parse(text); } catch (e) { return { character: null, problem: 'The file isn\'t valid JSON.' }; }
    const { format, ...rest } = parsed || {};
    if (format && format !== 'kotorjs-gm-character') return { character: null, problem: 'The file isn\'t a KotOR.js character.' };
    if (!this.isCharacter({ ...rest, id: rest.id || 'x', updated: rest.updated || 0 })) return { character: null, problem: 'The file is missing parts of a character.' };
    return { character: { ...rest, id: this.newId(), updated: Date.now() } };
  }

  /** The shape of a saved character (not its rules: CharacterRules.validate checks those) */
  static isCharacter(c: any): c is GMCharacter {
    return !!c && typeof c === 'object' && typeof c.id === 'string' && typeof c.name === 'string'
      && (c.game === 'kotor' || c.game === 'tsl')
      && Number.isFinite(c.classId) && Number.isFinite(c.level)
      && !!c.attributes && ABILITIES.every((k) => Number.isFinite(c.attributes[k]))
      && (typeof c.appearanceLabel === 'string' || Number.isFinite(c.appearanceId));
  }

  // --- Into a session ------------------------------------------------------------------------------

  /** The appearance id for a character's model: by label on this machine, else its saved id */
  static resolveAppearance(character: Pick<GMCharacter, 'appearanceLabel' | 'appearanceId'>): number {
    const wanted = String(character.appearanceLabel || '').toLowerCase();
    if (wanted) {
      for (const [id, appearance] of GameState.AppearanceManager?.appearances || new Map()) {
        if (String(appearance?.label || '').toLowerCase() === wanted) return id;
      }
    }
    return character.appearanceId;
  }

  /** What a session spawns for a character */
  static toSpawnConfig(character: GMCharacter): GMPlayerSpawnConfig {
    const a = character.attributes;
    return {
      name: character.name,
      appearanceId: this.resolveAppearance(character),
      portraitId: character.portraitId,
      gender: character.gender,
      classId: character.classId,
      level: character.level,
      alignment: character.alignment,
      str: a.str, dex: a.dex, con: a.con, int: a.int, wis: a.wis, cha: a.cha,
      rightHandResRef: character.gear?.rightHand || '',
      leftHandResRef: character.gear?.leftHand || '',
      armorResRef: character.gear?.armor || '',
      featIds: character.feats,
      spellIds: character.powers,
      skillRanks: character.skillRanks,
    };
  }

  /** A new character to start editing from: a preset if given, else a level-1 soldier */
  static blank(preset?: GMPlayerSpawnConfig): GMCharacter {
    const p = preset;
    const appearanceId = p?.appearanceId ?? 136;
    return {
      id: '',
      version: 1,
      game: this.game(),
      name: p?.name || 'New character',
      appearanceId,
      appearanceLabel: GameState.AppearanceManager?.appearances?.get(appearanceId)?.label || '',
      portraitId: p?.portraitId ?? 0,
      gender: p?.gender ?? 0,
      classId: p?.classId ?? 0,
      level: p ? Math.max(1, p.level) : 1,
      attributes: p ? { str: p.str, dex: p.dex, con: p.con, int: p.int, wis: p.wis, cha: p.cha } : { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 },
      alignment: p?.alignment,
      gear: p ? { rightHand: p.rightHandResRef, leftHand: p.leftHandResRef, armor: p.armorResRef } : {},
      updated: 0,
    };
  }

  /** The recommended feats, powers and skills for a character's class, level and abilities (CharacterBuilder) */
  static recommended(character: Pick<GMCharacter, 'classId' | 'level' | 'attributes' | 'alignment'>) {
    return CharacterBuilder.build({ classId: character.classId, level: character.level, attributes: character.attributes, alignment: character.alignment });
  }

}
