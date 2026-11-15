import { GFFDataType } from "@/enums/resource/GFFDataType";
import { GFFField } from "@/resource/GFFField";
import { GFFStruct } from "@/resource/GFFStruct";

/**
 * EncounterSpawnEntry class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file EncounterSpawnEntry.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class EncounterSpawnEntry {

  spawnResref = '';
  spawnCR = 0;

  save(){
    let struct = new GFFStruct();

    struct.addRESREF('SpawnResRef', this.spawnResref);
    struct.addFloat('SpawnCR', this.spawnCR);

    return struct;
  }

  static FromStruct( struct: GFFStruct ){
    if(struct instanceof GFFStruct){
      let entry = new EncounterSpawnEntry();

      entry.spawnResref = struct.get('SpawnResRef', entry.spawnResref);

      entry.spawnCR = struct.get('SpawnCR', entry.spawnCR);

      return entry;
    }
    return undefined;
  }

}