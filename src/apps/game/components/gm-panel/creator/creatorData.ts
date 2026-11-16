import * as KotOR from "@/apps/game/KotOR";

export type ModelGroup = 'player' | 'humanoid' | 'droid' | 'creature';

export const MODEL_GROUPS: { id: ModelGroup; label: string }[] = [
  { id: 'player', label: 'Player bodies' },
  { id: 'humanoid', label: 'Humanoids' },
  { id: 'droid', label: 'Droids' },
  { id: 'creature', label: 'Creatures' },
];

/** A model a character can take (an appearance.2da row) */
export interface CreatorModel {
  id: number;
  label: string;
  group: ModelGroup;
  /** What the model can't do as a player character */
  notes: string[];
}

export interface CreatorPortrait {
  id: number;
  texture: string;
  gender: number;
  appearances: number[];
}

let models: CreatorModel[] | null = null;
let portraits: CreatorPortrait[] | null = null;

/** Every creature model, grouped, with notes; built once */
export function creatorModels(): CreatorModel[] {
  if (models) return models;
  const players = KotOR.CharacterRules.playerAppearances();
  const out: CreatorModel[] = [];
  for (const [id, a] of KotOR.AppearanceManager.appearances as Map<number, any>) {
    const label = String(a?.label || '').trim();
    if (!label || label === '****') continue;
    const modelType = String(a.modeltype || 'B').toUpperCase();
    const group: ModelGroup = players.has(id) ? 'player' : /droid/i.test(label) ? 'droid' : modelType === 'B' || modelType === 'F' ? 'humanoid' : 'creature';
    const notes: string[] = [];
    if (!players.has(id)) notes.push('No portrait of its own.');
    if (modelType !== 'B') notes.push('Armour doesn\'t change how it looks.');
    if (modelType === 'S' || modelType === 'L') notes.push('May not hold weapons, and lacks most stances and gestures.');
    out.push({ id, label, group, notes });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  models = out;
  return out;
}

/** The player portraits (portraits.2da rows for PCs) */
export function creatorPortraits(): CreatorPortrait[] {
  if (portraits) return portraits;
  const rows = Object.entries(KotOR.GameState.TwoDAManager.datatables.get('portraits')?.rows || {}) as [string, any][];
  portraits = rows
    .filter(([, r]) => Number(r.forpc) === 1 && r.baseresref && r.baseresref !== '****')
    .map(([id, r]) => ({
      id: Number(id),
      texture: String(r.baseresref).toLowerCase(),
      gender: Number(r.sex) || 0,
      appearances: ['appearancenumber', 'appearance_s', 'appearance_l'].map((c) => Number(r[c])).filter((n) => Number.isFinite(n) && n >= 0),
    }));
  return portraits;
}

/** The portrait that belongs to a player body, if any */
export function portraitForModel(appearanceId: number): CreatorPortrait | undefined {
  return creatorPortraits().find((p) => p.appearances.includes(appearanceId));
}

export const ABILITY_NAMES: Record<string, string> = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
};
