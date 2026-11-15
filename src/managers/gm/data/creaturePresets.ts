import type { GMCreatureSpawnConfig } from "@/managers/gm/GMTypes";

// Curated Creature Presets
/**
 * Creature presets: KotOR's own templates (.utc), so each keeps the game's look, stats, class, powers and gear.
 * The appearance, HP, level and class here are the template's (shown in the panel), and the fallback when a
 * template is missing (another game's data). A preset's weapon only fills a hand the template leaves empty.
 */
export const CREATURE_PRESETS: GMCreatureSpawnConfig[] = [
  // Hostile
  { name: 'Sith Trooper', templateResRef: 'g_sithtroop01', appearanceId: 28, appearanceLabel: 'Sith_Soldier_01', factionId: 1, hp: 25, level: 3, classId: 8, barkText: 'Halt! By order of the Sith!' },
  { name: 'Sith Elite Trooper', templateResRef: 'g_sithtroop02', appearanceId: 44, appearanceLabel: 'Sith_Soldier_02', factionId: 1, hp: 35, level: 5, classId: 0, barkText: 'For the Sith Empire!' },
  { name: 'Sith Heavy Trooper', templateResRef: 'g_sithtroop03', appearanceId: 44, appearanceLabel: 'Sith_Soldier_02', factionId: 1, hp: 48, level: 8, classId: 0, barkText: 'Open fire!' },
  { name: 'Sith Grenadier', templateResRef: 'g_sithtroop04', appearanceId: 28, appearanceLabel: 'Sith_Soldier_01', factionId: 1, hp: 30, level: 6, classId: 0, barkText: 'Grenade out!' },
  { name: 'Sith Assault Trooper', templateResRef: 'g_sithtroop07', appearanceId: 44, appearanceLabel: 'Sith_Soldier_02', factionId: 1, hp: 96, level: 12, classId: 0, barkText: 'Leave no survivors!' },
  { name: 'Sith Lieutenant', templateResRef: 'g_sithcomm01', appearanceId: 42, appearanceLabel: 'Sith_Female_Albino', factionId: 1, hp: 42, level: 5, classId: 1, barkText: 'Take them down!' },
  { name: 'Sith Captain', templateResRef: 'g_sithcomm02', appearanceId: 43, appearanceLabel: 'Sith_Male_Albino', factionId: 1, hp: 64, level: 8, classId: 1, barkText: 'You will answer to the Sith!' },
  { name: 'Dark Jedi Apprentice', templateResRef: 'g_darkjedi01', appearanceId: 20, appearanceLabel: 'Dark_Jedi_Male_01', factionId: 1, hp: 31, level: 4, classId: 3, barkText: 'The dark side will consume you!' },
  { name: 'Dark Jedi', templateResRef: 'g_darkjedi02', appearanceId: 19, appearanceLabel: 'Dark_Jedi_Female_01', factionId: 1, hp: 80, level: 8, classId: 3, barkText: 'Your feeble skills are no match for the dark side!' },
  { name: 'Dark Jedi Master', templateResRef: 'g_darkjedi03', appearanceId: 20, appearanceLabel: 'Dark_Jedi_Male_01', factionId: 1, hp: 110, level: 12, classId: 3, barkText: 'You know nothing of true power.' },
  { name: 'Darth Malak', templateResRef: 'n_darthmalak', appearanceId: 21, appearanceLabel: 'Unique_Darth_Malak', factionId: 1, hp: 114, level: 20, classId: 3, barkText: 'Wipe this pathetic planet from the face of the galaxy!' },
  { name: 'Darth Bandon', templateResRef: 'g_bandon', appearanceId: 184, appearanceLabel: 'Unique_Darth_Bandon', factionId: 1, hp: 40, level: 15, classId: 3, barkText: 'You will bow before the Sith!' },
  { name: 'Calo Nord', templateResRef: 'n_calonord', appearanceId: 13, appearanceLabel: 'Unique_Calo_Nord', factionId: 1, hp: 219, level: 13, classId: 0, barkText: 'One... Two... Three.' },
  { name: 'Mandalorian Warrior', templateResRef: 'g_mandalor01', appearanceId: 35, appearanceLabel: 'Alien_Mandalorian_01', factionId: 1, hp: 34, level: 4, classId: 8, barkText: 'For Mandalore!' },
  { name: 'Mandalorian Elite', templateResRef: 'g_mandalor02', appearanceId: 351, appearanceLabel: 'Alien_Mandalorian_02', factionId: 1, hp: 56, level: 8, classId: 0, barkText: 'This is the way of the warrior!' },
  { name: 'Sand People Warrior', templateResRef: 'g_tuskenmale01', appearanceId: 46, appearanceLabel: 'Alien_Sand_People_01', factionId: 1, hp: 16, level: 3, classId: 8, barkText: '*Aggressive Tusken war cry!*' },
  { name: 'Rodian Thug', templateResRef: 'g_thug01', appearanceId: 257, appearanceLabel: 'Alien_Rodian_03', factionId: 1, hp: 20, level: 3, classId: 8, barkText: 'Hand over your credits!' },
  { name: 'Gamorrean', templateResRef: 'g_gammorean01', appearanceId: 240, appearanceLabel: 'Alien_Gammorean_02', factionId: 1, hp: 6, level: 1, classId: 8, barkText: '*Gamorrean grunting*' },
  { name: 'War Droid Mark I', templateResRef: 'g_wardroid01', appearanceId: 66, appearanceLabel: 'Droid_War_01', factionId: 1, hp: 8, level: 1, classId: 8, barkText: 'Target acquired. Eliminating threat.' },
  { name: 'War Droid Mark II', templateResRef: 'c_drdwar', appearanceId: 236, appearanceLabel: 'Droid_War_02', factionId: 1, hp: 14, level: 3, classId: 8, barkText: 'Target acquired. Eliminating threat.' },
  { name: 'Assassin Droid', templateResRef: 'g_assassindrd01', appearanceId: 56, appearanceLabel: 'Droid_Assassin', factionId: 1, hp: 59, level: 6, classId: 6, barkText: 'Termination protocol engaged.' },
  { name: 'Kath Hound', templateResRef: 'c_khounda', appearanceId: 75, appearanceLabel: 'Creature_Kath_Hound_A01', factionId: 1, hp: 25, level: 3, classId: 8, barkText: '*Snarls menacingly*' },
  { name: 'Rakghoul', templateResRef: 'g_rakghoul01', appearanceId: 79, appearanceLabel: 'Creature_Rakghoul', factionId: 1, hp: 6, level: 1, classId: 8, barkText: '*Ferocious screech!*' },
  { name: 'Kinrath', templateResRef: 'c_kinrath', appearanceId: 88, appearanceLabel: 'Creature_Kinrath', factionId: 1, hp: 35, level: 4, classId: 8, barkText: '*Clicking mandibles*' },
  { name: 'Tuk\'ata', templateResRef: 'c_tukata', appearanceId: 89, appearanceLabel: 'Creature_Tukata', factionId: 1, hp: 56, level: 8, classId: 8, barkText: '*Low growl*' },
  { name: 'Terentatek', onlyIn: 'kotor', templateResRef: 'g_terantanak', appearanceId: 353, appearanceLabel: 'Creature_Terantanak', factionId: 1, hp: 150, level: 10, classId: 0, barkText: '*Earth-shaking roar!*' },
  { name: 'Rancor', templateResRef: 'g_rancor01', appearanceId: 80, appearanceLabel: 'Creature_Rancor', factionId: 1, hp: 350, level: 20, classId: 0, barkText: '*Deafening Rancor roar!*' },
  // Friendly: armed with what they carry, plus a weapon where the template has none
  { name: 'Republic Soldier', templateResRef: 'n_repsold', appearanceId: 38, appearanceLabel: 'Republic_Soldier_Mal_White', factionId: 2, hp: 8, level: 1, classId: 0, rightHandResRef: 'g_w_blstrrfl001', barkText: 'Reporting for duty! For the Republic!' },
  { name: 'Republic Officer', templateResRef: 'n_repoff', appearanceId: 37, appearanceLabel: 'Republic_Officer_Mal_White', factionId: 2, hp: 8, level: 1, classId: 0, rightHandResRef: 'g_w_blstrpstl001', barkText: 'Hold the line!' },
  { name: 'Jedi', templateResRef: 'n_jedicounm', appearanceId: 214, appearanceLabel: 'Jedi_White_Male_02', factionId: 2, hp: 8, level: 1, classId: 3, barkText: 'May the Force be with you.' },
  { name: 'Wookiee Warrior', templateResRef: 'g_wookiemale01', appearanceId: 272, appearanceLabel: 'Alien_Wookie_Male_03', factionId: 2, hp: 30, level: 4, classId: 0, barkText: '*Fierce Wookiee roar*' },
  { name: 'Bastila Shan', templateResRef: 'p_bastilla', appearanceId: 4, appearanceLabel: 'Party_NPC_Bastila', factionId: 2, hp: 27, level: 3, classId: 5, rightHandResRef: 'g_w_dblsbr001', barkText: 'Keep your guard up. The Force is with us.' },
  { name: 'Carth Onasi', templateResRef: 'p_carth', appearanceId: 6, appearanceLabel: 'Party_NPC_Carth', factionId: 2, hp: 44, level: 4, classId: 0, barkText: 'Down you go!' },
  { name: 'Canderous Ordo', templateResRef: 'p_cand', appearanceId: 5, appearanceLabel: 'Party_NPC_Cand', factionId: 2, hp: 65, level: 5, classId: 0, barkText: 'Yeah, this is what I live for!' },
  { name: 'HK-47', templateResRef: 'p_hk47', appearanceId: 3, appearanceLabel: 'Party_NPC_HK47', factionId: 2, hp: 66, level: 6, classId: 6, barkText: 'Statement: Ready to terminate any hostile meatbags, Master.' },
  { name: 'Jolee Bindo', templateResRef: 'p_jolee', appearanceId: 7, appearanceLabel: 'Party_NPC_Jolee', factionId: 2, hp: 42, level: 6, classId: 4, barkText: 'Get off my lawn, you kids!' },
  { name: 'Juhani', templateResRef: 'p_juhani', appearanceId: 8, appearanceLabel: 'Party_NPC_Juhani', factionId: 2, hp: 78, level: 6, classId: 3, barkText: 'I will be your doom!' },
  { name: 'Mission Vao', templateResRef: 'p_mission', appearanceId: 10, appearanceLabel: 'Party_NPC_Mission', factionId: 2, hp: 21, level: 3, classId: 2, barkText: 'Need something unlocked? I\'m on it!' },
  { name: 'Zaalbar', templateResRef: 'p_zaalbar', appearanceId: 9, appearanceLabel: 'Party_NPC_Zaalbar', factionId: 2, hp: 52, level: 4, classId: 1, rightHandResRef: 'g_w_bowcstr001', barkText: '*Loyal Wookiee growl*' },
  { name: 'T3-M4', templateResRef: 'p_t3m4', appearanceId: 2, appearanceLabel: 'Party_NPC_T3M3', factionId: 2, hp: 30, level: 3, classId: 7, barkText: '*Cheerful astromech binary whistle*' },
  // Neutral
  { name: 'Protocol Droid', templateResRef: 'c_drdprot', appearanceId: 63, appearanceLabel: 'Droid_Protocol_01', factionId: 5, hp: 9, level: 1, classId: 7, barkText: 'Greetings! How may I be of assistance today?' },
  { name: 'Selkath', templateResRef: 'n_selkath', appearanceId: 40, appearanceLabel: 'Alien_Selkath_01', factionId: 5, hp: 9, level: 1, classId: 8, barkText: 'Obey the neutrality laws of Ahto City.' },
  { name: 'Twi\'lek', templateResRef: 'n_twilekf', appearanceId: 47, appearanceLabel: 'Alien_Twilek_Female_01', factionId: 5, hp: 8, level: 1, classId: 0, barkText: 'Welcome, traveler! Looking for rare goods?' },
  { name: 'Rodian', templateResRef: 'n_rodian', appearanceId: 39, appearanceLabel: 'Alien_Rodian_01', factionId: 5, hp: 8, level: 1, classId: 2, barkText: 'Keep moving, outsider.' },
  { name: 'Commoner', templateResRef: 'n_commm', appearanceId: 17, appearanceLabel: 'Commoner_01_Mal_Asian', factionId: 5, hp: 8, level: 1, classId: 0, barkText: 'Can I help you?' },
  { name: 'Jawa', templateResRef: 'c_jawa', appearanceId: 73, appearanceLabel: 'Alien_Jawa', factionId: 5, hp: 8, level: 1, classId: 2, barkText: 'Utinni!' },
  { name: 'Dewback', templateResRef: 'g_dewback01', appearanceId: 55, appearanceLabel: 'Creature_Dewback', factionId: 5, hp: 42, level: 5, classId: 0, barkText: '*Placid snort*' },
];
