import { ModuleCreatureArmorSlot } from "@/enums/module/ModuleCreatureArmorSlot";
import type { ModuleItem } from "@/module/ModuleItem";

/** A creature equipment slot, named as in ModuleCreatureArmorSlot */
export type EquipmentSlotKey =
  'ARMOR' | 'ARMS' | 'BELT' | 'CLAW1' | 'CLAW2' | 'CLAW3' | 'HEAD' | 'HIDE' | 'IMPLANT' |
  'LEFTARMBAND' | 'LEFTHAND' | 'LEFTHAND2' | 'RIGHTARMBAND' | 'RIGHTHAND' | 'RIGHTHAND2';

/** What a creature has equipped: an item, or nothing, in each slot */
export type CreatureEquipment = Record<EquipmentSlotKey, ModuleItem | undefined>;

/**
 * The creature equipment slots, and the groups of them the engine treats alike.
 */
export class EquipmentSlots {

  /** Every slot, in the order a save lists them */
  static readonly ALL: readonly EquipmentSlotKey[] = [
    'ARMOR', 'ARMS', 'BELT', 'CLAW1', 'CLAW2', 'CLAW3', 'HEAD', 'HIDE', 'IMPLANT',
    'LEFTARMBAND', 'LEFTHAND', 'LEFTHAND2', 'RIGHTARMBAND', 'RIGHTHAND', 'RIGHTHAND2',
  ];

  /** The slots a creature is wearing or wielding: all but TSL's second weapon set, which is held in reserve */
  static readonly WORN: readonly EquipmentSlotKey[] = EquipmentSlots.ALL.filter((key) => key !== 'LEFTHAND2' && key !== 'RIGHTHAND2');

  /** The slots that can hold a weapon in use: the hands and a creature's natural weapons */
  static readonly WEAPONS: readonly EquipmentSlotKey[] = ['RIGHTHAND', 'LEFTHAND', 'CLAW1', 'CLAW2', 'CLAW3'];

  /** Equipping or removing these changes the creature's own model (the body and head are rebuilt) */
  static readonly MODEL: readonly EquipmentSlotKey[] = ['ARMOR', 'HEAD'];

  /** An empty set of equipment */
  static empty(): CreatureEquipment {
    const equipment = {} as CreatureEquipment;
    for(const key of EquipmentSlots.ALL){ equipment[key] = undefined; }
    return equipment;
  }

  /** The slot key for a ModuleCreatureArmorSlot value; undefined when the value isn't a slot */
  static keyOf(slot: number): EquipmentSlotKey | undefined {
    const key = ModuleCreatureArmorSlot[slot] as EquipmentSlotKey | undefined;
    return key && EquipmentSlots.ALL.includes(key) ? key : undefined;
  }

  /** The ModuleCreatureArmorSlot value for a slot key */
  static slotOf(key: EquipmentSlotKey): ModuleCreatureArmorSlot {
    return ModuleCreatureArmorSlot[key];
  }

}
