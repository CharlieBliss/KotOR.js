import { GameState } from "@/GameState";
import { GameMenu } from "@/gui";
import type { GUIListBox, GUILabel, GUIButton } from "@/gui";
import type { ModuleCreature } from "@/module/ModuleCreature";
import type { TalentSkill } from "@/talents/TalentSkill";
import { GUIFeatItem } from "@/game/kotor/gui/GUIFeatItem";
import { GUISpellItem } from "@/game/tsl/gui/GUISpellItem";
import { GUICreatureSkill } from "@/game/tsl/gui/GUICreatureSkill";
import { AbilityChains } from "@/engine/rules/AbilityChains";
import { TextureLoader } from "@/loaders";

export enum AbilityFilter {
  SKILLS = 1,
  POWERS = 2,
  FEATS = 3
}

/**
 * MenuAbilities class.
 *
 * The character sheet's Abilities screen: the character's skills (rank, ability bonus and total), Force
 * powers and feats, each grouped into its chain (e.g. Power Attack → Improved → Master), with the selected
 * one's name and description.
 *
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 *
 * @file MenuAbilities.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class MenuAbilities extends GameMenu {

  LBL_INFOBG: GUILabel;
  LB_DESC: GUIListBox;
  LBL_PORTRAIT: GUILabel;
  LB_ABILITY: GUIListBox;
  LBL_NAME: GUILabel;
  LBL_SKILLRANK: GUILabel;
  LBL_RANKVAL: GUILabel;
  LBL_BONUS: GUILabel;
  LBL_BONUSVAL: GUILabel;
  LBL_TOTAL: GUILabel;
  LBL_TOTALVAL: GUILabel;
  BTN_POWERS: GUIButton;
  BTN_SKILLS: GUIButton;
  BTN_FEATS: GUIButton;
  BTN_EXIT: GUIButton;
  BTN_CHANGE1: GUIButton;
  BTN_CHANGE2: GUIButton;

  filter: AbilityFilter = AbilityFilter.SKILLS;

  constructor(){
    super();
    this.gui_resref = 'abilities';
    this.background = '1600x1200back';
    this.voidFill = true;
  }

  async menuControlInitializer(skipInit: boolean = false) {
    await super.menuControlInitializer();
    if(skipInit) return;
    return new Promise<void>((resolve, reject) => {
      this.BTN_EXIT.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
      });
      this._button_b = this.BTN_EXIT;

      this.BTN_SKILLS.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setFilter(AbilityFilter.SKILLS);
      });

      this.BTN_POWERS.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setFilter(AbilityFilter.POWERS);
      });

      this.BTN_FEATS.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setFilter(AbilityFilter.FEATS);
      });

      this.LB_ABILITY.onSelected = (node: any) => {
        if(this.filter == AbilityFilter.SKILLS) this.showSkill(node as TalentSkill);
      };

      resolve();
    });
  }

  show() {
    super.show();
    this.manager.MenuTop.LBLH_ABI.onHoverIn();
    const creature = this.getCreature();
    const portrait = creature?.getPortraitResRef?.();
    if(portrait && this.LBL_PORTRAIT) this.LBL_PORTRAIT.setFillTextureName(portrait);
    this.setFilter(this.filter);
  }

  /** The character the sheet is showing: the one being played */
  getCreature(): ModuleCreature {
    return GameState.getCurrentPlayer() as ModuleCreature;
  }

  setFilter(filter: AbilityFilter){
    this.filter = filter;
    const creature = this.getCreature();
    this.showDetails('', '');
    this.showRanks(false);
    if(!creature) return;

    this.LBL_NAME?.setText('');
    switch(filter){
      case AbilityFilter.SKILLS: {
        this.LB_ABILITY.setProtoBuilder(GUICreatureSkill);
        this.LB_ABILITY.padding = 0;
        const skills = (creature.skills || []).filter(Boolean);
        this.LB_ABILITY.setItems(skills, { selectIndex: skills.length ? 0 : -1 });
        if(skills[0]) this.showSkill(skills[0]);
        break;
      }
      case AbilityFilter.POWERS: {
        this.LB_ABILITY.setProtoBuilder(GUISpellItem);
        this.LB_ABILITY.padding = 5.5;
        const chains = AbilityChains.powerChains(creature);
        this.LB_ABILITY.setItems(chains);
        TextureLoader.LoadQueue();
        const first = chains.flat().find((s: any) => creature.getHasSpell(s.__index));
        if(first) this.showPower(first);
        else this.showDetails('', 'This character knows no Force powers.');
        break;
      }
      case AbilityFilter.FEATS: {
        this.LB_ABILITY.setProtoBuilder(GUIFeatItem);
        this.LB_ABILITY.padding = 5.5;
        const chains = AbilityChains.featChains(creature);
        this.LB_ABILITY.setItems(chains);
        TextureLoader.LoadQueue();
        const first = chains.flat().find((f: any) => creature.getHasFeat(f.__index));
        if(first) this.showFeat(first);
        else this.showDetails('', 'This character has no feats.');
        break;
      }
    }
  }

  /** A feat or power icon in a chain was clicked or hovered */
  onAbilityPicked(row: any){
    if(!row) return;
    if(this.filter == AbilityFilter.POWERS) this.showPower(row);
    else if(this.filter == AbilityFilter.FEATS) this.showFeat(row);
  }

  showSkill(skill: TalentSkill){
    const creature = this.getCreature();
    if(!skill || !creature) return;
    const rank = skill.getRank();
    const total = creature.getSkillLevel(skill.id);
    this.showRanks(true);
    this.LBL_SKILLRANK?.setText('Skill Rank');
    this.LBL_BONUS?.setText('Bonus');
    this.LBL_TOTAL?.setText('Total Rank');
    this.LBL_RANKVAL?.setText(String(rank));
    this.LBL_BONUSVAL?.setText(String(total - rank));
    this.LBL_TOTALVAL?.setText(String(total));
    this.showDetails(skill.getName(), skill.getDescription());
  }

  showPower(row: any){
    const creature = this.getCreature();
    const known = !!creature?.getHasSpell(row.__index);
    const cost = parseInt(row.forcepoints);
    const name = GameState.TLKManager.GetStringById(parseInt(row.name))?.Value || row.label;
    const desc = GameState.TLKManager.GetStringById(parseInt(row.spelldesc))?.Value || '';
    const header = [
      known ? '' : '(Not learned)',
      cost > 0 ? `Force points: ${cost}` : '',
    ].filter(Boolean).join('  ');
    this.showRanks(false);
    this.showDetails(name, header ? `${header}\n\n${desc}` : desc);
  }

  showFeat(row: any){
    const creature = this.getCreature();
    const known = !!creature?.getHasFeat(row.__index);
    const name = GameState.TLKManager.GetStringById(parseInt(row.name))?.Value || row.label;
    const desc = GameState.TLKManager.GetStringById(parseInt(row.description))?.Value || '';
    this.showRanks(false);
    this.showDetails(name, known ? desc : `(Not learned)\n\n${desc}`);
  }

  showRanks(visible: boolean){
    for(const label of [this.LBL_SKILLRANK, this.LBL_RANKVAL, this.LBL_BONUS, this.LBL_BONUSVAL, this.LBL_TOTAL, this.LBL_TOTALVAL]){
      if(!label) continue;
      if(visible) label.show(); else label.hide();
    }
  }

  showDetails(name: string, description: string){
    this.LBL_NAME?.setText(name || '');
    this.LB_DESC?.setItem(description || null);
  }

  triggerControllerBumperLPress() {
    this.manager.MenuTop.BTN_CHAR.click();
  }

  triggerControllerBumperRPress() {
    this.manager.MenuTop.BTN_MSG.click();
  }

}
