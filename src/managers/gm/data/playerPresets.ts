import type { GMPlayerSpawnConfig } from "@/managers/gm/GMTypes";

// Curated Player Character Presets
export const PLAYER_PRESETS: GMPlayerSpawnConfig[] = [
  {
    name: 'Jedi Guardian',
    appearanceId: 136,
    portraitId: 15,
    gender: 0,
    classId: 3, // Jedi Guardian
    level: 10,
    str: 18,
    dex: 14,
    con: 15,
    int: 10,
    wis: 14,
    cha: 12,
    rightHandResRef: 'g_w_lghtsbr01',
    leftHandResRef: '',
    armorResRef: 'g_a_jedirobe01',
    possessImmediately: true
  },
  {
    name: 'Jedi Consular (Force Master)',
    appearanceId: 166,
    portraitId: 21,
    gender: 1,
    classId: 4, // Jedi Consular
    level: 10,
    str: 12,
    dex: 14,
    con: 14,
    int: 14,
    wis: 18,
    cha: 16,
    rightHandResRef: 'g_w_lghtsbr03',
    leftHandResRef: '',
    armorResRef: 'g_a_mstrrobe01',
    possessImmediately: true
  },
  {
    name: 'Jedi Sentinel (Dual Saber)',
    appearanceId: 121,
    portraitId: 12,
    gender: 0,
    classId: 5, // Jedi Sentinel
    level: 10,
    str: 14,
    dex: 17,
    con: 14,
    int: 14,
    wis: 15,
    cha: 12,
    rightHandResRef: 'g_w_dblsbr001',
    leftHandResRef: '',
    armorResRef: 'g_a_kghtrobe01',
    possessImmediately: true
  },
  {
    name: 'Sith Marauder (Dark Side)',
    alignment: 'dark',
    appearanceId: 138,
    portraitId: 16,
    gender: 0,
    classId: 3, // Jedi Guardian
    level: 12,
    str: 18,
    dex: 15,
    con: 16,
    int: 10,
    wis: 15,
    cha: 14,
    rightHandResRef: 'g_w_lghtsbr02',
    leftHandResRef: 'g_w_lghtsbr02',
    armorResRef: 'g_a_mstrrobe02',
    possessImmediately: true
  },
  {
    name: 'Republic Heavy Soldier',
    appearanceId: 91,
    portraitId: 7,
    gender: 0,
    classId: 0, // Soldier
    level: 8,
    str: 16,
    dex: 16,
    con: 16,
    int: 12,
    wis: 12,
    cha: 10,
    rightHandResRef: 'g_w_hvrptbltr01',
    leftHandResRef: '',
    armorResRef: 'g_a_class8001',
    possessImmediately: true
  },
  {
    name: 'Smuggler Scoundrel',
    appearanceId: 151,
    portraitId: 18,
    gender: 1,
    classId: 2, // Scoundrel
    level: 8,
    str: 12,
    dex: 18,
    con: 13,
    int: 15,
    wis: 13,
    cha: 15,
    rightHandResRef: 'g_w_blstrpstl001',
    leftHandResRef: 'g_w_blstrpstl001',
    armorResRef: 'g_a_class4001',
    possessImmediately: true
  }
];
