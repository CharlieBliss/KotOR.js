import { GFFDataType } from "@/enums/resource/GFFDataType";
import { GMItems } from "@/managers/gm/GMItems";
import { ModuleCreatureArmorSlot } from "@/enums/module/ModuleCreatureArmorSlot";
import { CExoLocString } from "@/resource/CExoLocString";
import { GFFField } from "@/resource/GFFField";
import { GFFObject } from "@/resource/GFFObject";
import { GFFStruct } from "@/resource/GFFStruct";
import { ResourceLoader } from "@/loaders";

/** A creature's hands and armour, as item resrefs ('' for empty, undefined for "leave as is") */
export interface GMGear {
  rightHandResRef?: string;
  leftHandResRef?: string;
  armorResRef?: string;
}

/** What a class gives a character at a level (CharacterBuilder.build) */
export interface GMBuildAbilities {
  powers: number[];
  feats: number[];
  skillRanks: number[];
  maxFp: number;
}

/**
 * Building the GFF templates GM mode spawns from: creatures, player characters and placeables, from a
 * game template (.utc / .utp / .uti) or from nothing.
 */
export class GMTemplates {
  /** A game template's bytes by resref: from the resource cache, else loaded; undefined when the game has none */
  static async loadBuffer(resType: number, resRef: string | undefined): Promise<Uint8Array | undefined> {
    const key = String(resRef || '').toLowerCase().trim();
    if (!key) return undefined;
    let buffer = ResourceLoader.loadCachedResource(resType, key);
    if (!buffer) {
      try {
        buffer = await ResourceLoader.loadResource(resType, key);
      } catch (e) {
        buffer = undefined;
      }
    }
    return buffer || undefined;
  }

  /** A game template as a GFF, or null when the game has none */
  static async load(resType: number, resRef: string | undefined): Promise<GFFObject | null> {
    const buffer = await this.loadBuffer(resType, resRef);
    return buffer ? new GFFObject(buffer) : null;
  }

  /** Set a field, adding it when the template doesn't have it */
  static set(root: GFFStruct, type: GFFDataType, label: string, value: any) {
    if (root.hasField(label)) {
      root.getFieldByLabel(label).setValue(value);
    } else {
      root.addField(new GFFField(type, label)).setValue(value);
    }
  }

  /** Set a localized-string field (a name) to plain text */
  static setText(root: GFFStruct, label: string, text: string) {
    const loc = new CExoLocString();
    if (text) loc.addSubString(text, 0);
    if (root.hasField(label)) {
      root.getFieldByLabel(label).setCExoLocString(loc);
    } else {
      root.addField(new GFFField(GFFDataType.CEXOLOCSTRING, label, loc));
    }
  }

  /** Replace a list field with a fresh, empty one */
  static newList(root: GFFStruct, label: string) {
    root.removeFieldByLabel(label);
    return root.addField(new GFFField(GFFDataType.LIST, label));
  }

  /**
   * A character's class at a level and what it gives: the class list with its known Force powers, the feat
   * list, skill ranks and Force points
   */
  static writeBuild(root: GFFStruct, abilities: GMBuildAbilities, classId: number, level: number) {
    const classList = this.newList(root, 'ClassList');
    const classStruct = new GFFStruct();
    classStruct.addInt('Class', classId);
    classStruct.addShort('ClassLevel', level);
    const knownList = classStruct.addField(new GFFField(GFFDataType.LIST, 'KnownList0'));
    for (const spellId of abilities.powers) {
      const sp = new GFFStruct();
      sp.addWord('Spell', spellId);
      knownList.addChildStruct(sp);
    }
    classList.addChildStruct(classStruct);

    const featList = this.newList(root, 'FeatList');
    for (const featId of abilities.feats) {
      const ft = new GFFStruct();
      ft.addWord('Feat', featId);
      featList.addChildStruct(ft);
    }

    const skillList = this.newList(root, 'SkillList');
    for (let i = 0; i < Math.max(8, abilities.skillRanks.length); i++) {
      const sk = new GFFStruct();
      sk.addByte('Rank', abilities.skillRanks[i] || 0);
      skillList.addChildStruct(sk);
    }

    this.set(root, GFFDataType.WORD, 'ForcePoints', abilities.maxFp);
    this.set(root, GFFDataType.WORD, 'CurrentForce', abilities.maxFp);
    this.set(root, GFFDataType.WORD, 'MaxForcePoints', abilities.maxFp);
  }

  /**
   * Set a template's hands and armour. replace: each slot the gear names becomes exactly that ('' empties it).
   * Otherwise the gear only fills slots the template leaves empty. Slots the gear doesn't name (creature
   * claws and hides, belts, implants) always stay.
   */
  static writeGear(root: GFFStruct, gear: GMGear, replace: boolean) {
    let list = root.getFieldByLabel('Equip_ItemList');
    if (!list) list = root.addField(new GFFField(GFFDataType.LIST, 'Equip_ItemList'));
    const slots: [number, string | undefined][] = [
      [ModuleCreatureArmorSlot.ARMOR, gear.armorResRef],
      [ModuleCreatureArmorSlot.RIGHTHAND, gear.rightHandResRef],
      [ModuleCreatureArmorSlot.LEFTHAND, gear.leftHandResRef],
    ];
    for (const [slot, resRef] of slots) {
      if (resRef === undefined) continue;
      const existing = list.getChildStructs().find((st) => st.type === slot);
      if (!replace) {
        if (existing || !resRef) continue;
      } else if (existing) {
        list.removeChildStruct(existing);
      }
      if (!resRef) continue;
      const st = new GFFStruct(slot);
      st.addRESREF('EquippedRes', GMItems.forThisGame(resRef));
      list.addChildStruct(st);
    }
  }
}
