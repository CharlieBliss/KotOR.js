import { GameState } from "@/GameState";
import { CAREERS_BY_ID, CAREERS_SPECIES_BY_ID } from "@/managers/gm/careers/data";
import { CareersRules } from "@/managers/gm/careers/rules";
import { CAREER_ABILITIES } from "@/managers/gm/careers/skills";
import type { GMCareersCharacter } from "@/managers/gm/careers/types";
import type { GMPlayerSpawnConfig } from "@/managers/gm/GMTypes";

const STORAGE_KEY = 'kotorjs.gm.careers.characters.tsl';

/**
 * Saved Careers characters (separate from classic GMCharacters): stored in localStorage,
 * exported/imported as JSON files tagged with `ruleset: 'careers'`, and converted into
 * GMPlayerSpawnConfig for spawning in KotOR II GM sessions.
 */
export class GMCareersCharacters {

  static listeners = new Set<() => void>();

  static list(): GMCareersCharacter[] {
    try {
      if (typeof localStorage === 'undefined') return [];
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return (Array.isArray(parsed) ? parsed : [])
        .filter((c) => this.isCareersCharacter(c))
        .sort((a, b) => b.updated - a.updated);
    } catch (e) {
      return [];
    }
  }

  static get(id: string): GMCareersCharacter | undefined {
    return this.list().find((c) => c.id === id);
  }

  static save(character: GMCareersCharacter): GMCareersCharacter {
    const derived = CareersRules.derive(character);
    const saved: GMCareersCharacter = {
      ...character,
      id: character.id || this.newId(),
      version: 1,
      ruleset: 'careers',
      game: 'tsl',
      startingXpSpent: derived.startingXpUsed,
      updated: Date.now(),
    };
    const others = this.list().filter((c) => c.id !== saved.id);
    this.write([saved, ...others]);
    return saved;
  }

  static remove(id: string) {
    this.write(this.list().filter((c) => c.id !== id));
  }

  static write(list: GMCareersCharacter[]) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn('[GMCareersCharacters] Could not save characters:', e);
    }
    for (const listener of this.listeners) listener();
  }

  static newId(): string {
    return `car_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  // --- Files ---------------------------------------------------------------------------------------

  static toFileText(character: GMCareersCharacter): string {
    return JSON.stringify({ format: 'kotorjs-gm-careers-character', ...character }, null, 2);
  }

  static download(character: GMCareersCharacter) {
    const blob = new Blob([this.toFileText(character)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(character.name || 'character').replace(/[^\w-]+/g, '_')}.kotorjs-careers.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  static fromFileText(text: string): { character: GMCareersCharacter | null; problem?: string } {
    let parsed: any;
    try { parsed = JSON.parse(text); } catch (e) { return { character: null, problem: 'The file isn\'t valid JSON.' }; }
    const { format, ...rest } = parsed || {};
    if (format && format !== 'kotorjs-gm-careers-character') {
      return { character: null, problem: 'That file isn\'t a Careers character (classic KotOR characters can\'t be imported here).' };
    }
    if (!this.isCareersCharacter({ ...rest, id: rest.id || 'x', updated: rest.updated || 0 })) {
      return { character: null, problem: 'The file is missing parts of a Careers character.' };
    }
    return { character: { ...rest, id: this.newId(), updated: Date.now() } };
  }

  /** Shape check for a saved Careers character (rules are checked by CareersRules.validate) */
  static isCareersCharacter(c: any): c is GMCareersCharacter {
    return !!c && typeof c === 'object'
      && c.ruleset === 'careers'
      && typeof c.id === 'string'
      && typeof c.name === 'string'
      && typeof c.speciesId === 'string'
      && typeof c.careerId === 'string'
      && typeof c.startingSpecId === 'string'
      && Array.isArray(c.specializations)
      && !!c.characteristics && CAREER_ABILITIES.every((k) => Number.isFinite(c.characteristics[k]))
      && (typeof c.appearanceLabel === 'string' || Number.isFinite(c.appearanceId));
  }

  /** Create a fresh Careers character starting from a species and career */
  static blank(speciesId: string = 'human', careerId: string = 'soldier'): GMCareersCharacter {
    const species = CAREERS_SPECIES_BY_ID.get(speciesId) || CAREERS_SPECIES_BY_ID.get('human')!;
    const career = CAREERS_BY_ID.get(careerId) || CAREERS_BY_ID.get('soldier')!;
    const startingSpecId = career.specializations[0];
    const appearanceId = species.defaultAppearanceId;
    const appearanceLabel = GameState.AppearanceManager?.appearances?.get(appearanceId)?.label || '';
    return {
      id: '',
      version: 1,
      ruleset: 'careers',
      game: 'tsl',
      name: '',
      speciesId: species.id,
      appearanceLabel,
      appearanceId,
      portraitId: species.defaultPortraitId,
      gender: 0,
      careerId: career.id,
      startingSpecId,
      specializations: [startingSpecId],
      characteristics: { ...species.characteristics },
      freeCareerSkills: [],
      freeSpecSkills: [],
      freeSpeciesSkills: [],
      boughtSkillRanks: {},
      nodes: { [startingSpecId]: [] },
      powers: [],
      alignment: 'light',
      startingXpSpent: 0,
      campaignXpEarned: 0,
      campaignXpSpent: 0,
      gear: {
        rightHand: career.startingKit.rightHand || '',
        leftHand: career.startingKit.leftHand || '',
        armor: career.startingKit.armor || '',
      },
      updated: 0,
    };
  }

  /** Resolve appearanceId by label on this machine, falling back to saved appearanceId */
  static resolveAppearance(character: Pick<GMCareersCharacter, 'appearanceLabel' | 'appearanceId'>): number {
    const wanted = String(character.appearanceLabel || '').toLowerCase();
    if (wanted) {
      for (const [id, appearance] of GameState.AppearanceManager?.appearances || new Map()) {
        if (String(appearance?.label || '').toLowerCase() === wanted) return id;
      }
    }
    return character.appearanceId;
  }

  /**
   * Convert a Careers character into a GMPlayerSpawnConfig the engine can spawn directly:
   * - Hidden placeholder class (0 Soldier or 3 Jedi Guardian for Force-sensitives) at the XP-derived level
   * - KotOR ability scores (6 + 2 * FFG), HP/FP overrides, raw save fields (FortSaveThrow / RefSaveThrow / WillSaveThrow)
   * - NaturalAC 0, Race 5 for droids / 6 for organics, SubraceIndex 0, alignment from sheet
   * - Baseline weapon/armour proficiencies + KotOR feats from owned tree nodes (skipping KotOR prereqs)
   */
  static toSpawnConfig(character: GMCareersCharacter): GMPlayerSpawnConfig {
    const species = CAREERS_SPECIES_BY_ID.get(character.speciesId) || CAREERS_SPECIES_BY_ID.get('human')!;
    const career = CAREERS_BY_ID.get(character.careerId) || CAREERS_BY_ID.get('soldier')!;
    const derived = CareersRules.derive(character);
    const a = derived.kotorAttributes;
    const gear = character.gear || {};
    const kit = career.startingKit;

    return {
      ruleset: 'careers',
      name: character.name || `${species.name} ${career.name}`,
      appearanceId: this.resolveAppearance(character),
      portraitId: character.portraitId,
      gender: character.gender,
      // Hidden placeholder class: Jedi Guardian (3) when Force-sensitive so the engine's spell list holds Force powers
      classId: derived.forceSensitive ? 3 : 0,
      level: derived.level,
      hp: derived.maxHp,
      fp: derived.maxFp,
      alignment: character.alignment,
      goodEvil: character.alignment === 'dark' ? 25 : 75,
      naturalAC: 0,
      race: species.race,
      subraceIndex: species.subraceIndex,
      saves: { ...derived.saveRanks },
      str: a.str,
      dex: a.dex,
      con: a.con,
      int: a.int,
      wis: a.wis,
      cha: a.cha,
      rightHandResRef: gear.rightHand ?? kit.rightHand ?? '',
      leftHandResRef: gear.leftHand ?? kit.leftHand ?? '',
      armorResRef: gear.armor ?? kit.armor ?? '',
      featIds: derived.featIds,
      spellIds: derived.spellIds,
      skillRanks: derived.engineSkills,
      careers: { ...character },
    };
  }
}
