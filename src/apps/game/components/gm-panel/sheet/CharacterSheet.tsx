import React, { useEffect, useMemo, useReducer, useState } from "react";
import * as KotOR from "@/apps/game/KotOR";
import { GameImage } from "@/apps/game/components/gm-panel/creator/GameImage";
import { ModelPreview } from "@/apps/game/components/gm-panel/creator/ModelPreview";
import { Panel } from "@/apps/game/components/gm-panel/creator/sections";
import {
  EffectsSection, FeatsSection, OverviewSection, PowersSection, SkillsSection,
  type SheetActions, type SheetSectionProps,
} from "@/apps/game/components/gm-panel/sheet/sections";
import { CareersSheetSection } from "@/apps/game/components/gm-panel/sheet/CareersSheetSection";
import "@/apps/game/components/gm-panel/creator/creator.scss";
import "@/apps/game/components/gm-panel/sheet/sheet.scss";

export type SheetSectionId = 'overview' | 'skills' | 'feats' | 'powers' | 'effects' | 'careers';

/** The sheet's tabs, in order. A new tab is one entry here and a section component. */
export const SHEET_SECTIONS: { id: SheetSectionId; label: string; Section: React.FC<SheetSectionProps> }[] = [
  { id: 'overview', label: 'Character', Section: OverviewSection },
  { id: 'skills', label: 'Skills', Section: SkillsSection },
  { id: 'feats', label: 'Feats', Section: FeatsSection },
  { id: 'powers', label: 'Powers', Section: PowersSection },
  { id: 'effects', label: 'Effects', Section: EffectsSection },
];

/** How often an open sheet re-reads the character (the host's sheet updates arrive about once a second) */
const REFRESH_MS = 500;

const itemResRef = (item: any) => item?.getEquippedRes?.() || item?.getInventoryRes?.() || '';

/**
 * A character sheet for GM sessions, in place of the game's Character and Abilities screens: a player's own
 * character, or (from the Players tab) the GM's view of a player's. It never changes the character itself: a
 * player's buttons ask the host (GMPlayerRequests), the GM's act on the host's character.
 */
export const CharacterSheet: React.FC<{
  creature: any;
  initialSection?: SheetSectionId;
  gmView?: boolean;
  onClose: () => void;
}> = ({ creature, initialSection = 'overview', gmView = false, onClose }) => {
  const [section, setSection] = useState<SheetSectionId>(initialSection);
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const game = KotOR.GameState.GameKey === KotOR.GameEngineType.TSL ? 'tsl' : 'kotor';

  useEffect(() => { setSection(initialSection); }, [initialSection]);

  // Keep up with the character while open
  useEffect(() => {
    const timer = window.setInterval(tick, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  // Esc closes it; other keys don't reach the game (no walking off while reading the sheet)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (!KotOR.IngameControls.isTypingInPageField(e)) e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const actions: SheetActions = useMemo(() => gmView
    ? {
      who: 'gm',
      roll: (check) => KotOR.GMChecks.rollForPlayer(creature, check),
      levelUp: () => KotOR.GMPlayers.levelUpOnHost(creature),
    }
    : {
      who: 'player',
      roll: (check) => KotOR.GMPlayerRequests.roll(check),
      levelUp: () => KotOR.GMPlayerRequests.levelUp(),
    }, [creature, gmView]);

  if (!creature) return null;

  // XP toward the next level (exptable.2da: the total XP each level starts at)
  const careersChar = creature.careersRules?.character || creature.gmPlayerConfig?.careers;
  const careersDerived = careersChar && KotOR.CareersRules ? KotOR.CareersRules.derive(careersChar) : null;
  const level = careersDerived ? careersDerived.level : (Number(creature.getTotalClassLevel?.()) || 1);
  const expRows = KotOR.GameState.TwoDAManager.datatables.get('exptable')?.rows || {};
  const xp = Number(creature.experience) || 0;
  const thisLevelXp = Number(expRows[level - 1]?.xp) || 0;
  const nextLevelXp = Number(expRows[level]?.xp) || 0;
  const progress = careersDerived
    ? ((careersChar.campaignXpSpent || 0) % 50) / 50
    : (nextLevelXp > thisLevelXp ? Math.max(0, Math.min(1, (xp - thisLevelXp) / (nextLevelXp - thisLevelXp))) : 1);
  const canLevelUp = !careersDerived && !!creature.canLevelUp?.();
  // Hide the engine's placeholder class name on Careers characters
  const classes = careersChar
    ? `${KotOR.CAREERS_SPECIES_BY_ID?.get(careersChar.speciesId)?.name || careersChar.speciesId} ${KotOR.CAREERS_BY_ID?.get(careersChar.careerId)?.name || careersChar.careerId}`
    : (creature.classes || []).map((c: any) => `${c.getName?.() || 'Class'} ${c.level}`).join(' / ');
  const goodEvil = Number(creature.getGoodEvil?.() ?? 50);

  const preview = {
    appearanceId: Number(creature.appearance) || 0,
    appearanceLabel: '',
    portraitId: Number(creature.portraitId) || 0,
    gender: Number(creature.gender) || 0,
    alignment: goodEvil < 50 ? 'dark' as const : 'light' as const,
    gear: {
      rightHand: itemResRef(creature.equipment?.RIGHTHAND),
      leftHand: itemResRef(creature.equipment?.LEFTHAND),
      armor: itemResRef(creature.equipment?.ARMOR),
    },
  };
  const tabs = careersChar
    ? [...SHEET_SECTIONS, { id: 'careers' as SheetSectionId, label: 'Careers & XP', Section: OverviewSection }]
    : SHEET_SECTIONS;
  const Section = (SHEET_SECTIONS.find((s) => s.id === section) || SHEET_SECTIONS[0]).Section;

  return (
    <div className="cc-backdrop sheet-backdrop" data-game={game} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cc-frame wide sheet-frame" role="dialog" aria-label={`Character sheet: ${creature.getName?.()}`}>
        <div className="cc-titlebar">{gmView ? `Character sheet · ${creature.getName?.()}` : 'Character sheet'}</div>
        <nav className="cc-tabs" aria-label="Sections">
          {tabs.map((s) => (
            <button key={s.id} className={`cc-tab ${section === s.id ? 'on' : ''}`} aria-current={section === s.id} onClick={() => setSection(s.id)}>{s.label}</button>
          ))}
        </nav>
        <div className="cc-body">
          <div className="cc-main">
            {section === 'careers' && careersChar
              ? <CareersSheetSection creature={creature} gmView={gmView} />
              : <Section creature={creature} actions={actions} />}
          </div>
          <aside className="cc-side" aria-label="Summary">
            <ModelPreview character={preview} />
            <Panel title={creature.getName?.() || 'Character'}>
              <div className="cc-summary-head">
                <GameImage texture={String(creature.getPortraitResRef?.() || '').toLowerCase()} alt="Portrait" className="cc-summary-portrait" />
                <div>
                  <div className="cc-big">{classes || 'No class'}</div>
                  <div className="cc-hint">Level {level}</div>
                </div>
              </div>
              {careersDerived ? (
                <div className="sheet-xp" aria-label={`Available XP ${careersDerived.totalXpRemaining}`}>
                  <div className="sheet-xp-bar"><div style={{ width: `${progress * 100}%` }} /></div>
                  <div className="cc-hint">{careersDerived.totalXpRemaining} XP available · {careersChar.campaignXpSpent || 0} spent</div>
                </div>
              ) : (
                <div className="sheet-xp" aria-label={`Experience ${xp} of ${nextLevelXp}`}>
                  <div className="sheet-xp-bar"><div style={{ width: `${progress * 100}%` }} /></div>
                  <div className="cc-hint">{xp.toLocaleString()} / {nextLevelXp ? nextLevelXp.toLocaleString() : 'max'} XP</div>
                </div>
              )}
              {canLevelUp && (
                <button className="cc-button primary" onClick={() => actions.levelUp()} title={gmView ? 'Level this player up (the class\'s recommended picks)' : 'Level up with your class\'s recommended picks'}>
                  Auto level up
                </button>
              )}
            </Panel>
          </aside>
        </div>
        <div className="cc-buttons">
          <button className="cc-button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};
