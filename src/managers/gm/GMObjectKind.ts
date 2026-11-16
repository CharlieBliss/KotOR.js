import { BitWise } from "@/utility/BitWise";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import type { ModuleObject, ModuleCreature, ModulePlaceable, ModuleDoor, ModulePlayer, ModuleTrigger } from "@/module";

/** What kind of world object something is, as type guards */
export class GMObjectKind {
  static is(obj: ModuleObject | null | undefined, type: ModuleObjectType): boolean {
    return !!obj && BitWise.InstanceOf(obj.objectType, type);
  }
  static isCreature(obj: ModuleObject | null | undefined): obj is ModuleCreature {
    return this.is(obj, ModuleObjectType.ModuleCreature);
  }
  static isPlayer(obj: ModuleObject | null | undefined): obj is ModulePlayer {
    return this.is(obj, ModuleObjectType.ModulePlayer);
  }
  static isPlaceable(obj: ModuleObject | null | undefined): obj is ModulePlaceable {
    return this.is(obj, ModuleObjectType.ModulePlaceable);
  }
  static isDoor(obj: ModuleObject | null | undefined): obj is ModuleDoor {
    return this.is(obj, ModuleObjectType.ModuleDoor);
  }
  static isTrigger(obj: ModuleObject | null | undefined): obj is ModuleTrigger {
    return this.is(obj, ModuleObjectType.ModuleTrigger);
  }
}
