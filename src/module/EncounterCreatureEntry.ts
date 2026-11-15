import { GFFDataType } from "@/enums/resource/GFFDataType";
import { GFFField } from "@/resource/GFFField";
import { GFFStruct } from "@/resource/GFFStruct";

/**
 * EncounterCreatureEntry class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file EncounterCreatureEntry.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class EncounterCreatureEntry {

  appearance = 0;
  resref = '';
  cr = 0;
  singleSpawn = 0;

  save(){
    let struct = new GFFStruct();

    //struct.addInt('Appearance', this.appearance);
    struct.addRESREF('ResRef', this.resref);
    struct.addFloat('CR', this.cr);
    struct.addByte('SingleSpawn', this.singleSpawn);

    return struct;
  }

  static FromStruct( struct: GFFStruct ){
    if(struct instanceof GFFStruct){
      let entry = new EncounterCreatureEntry();
      entry.appearance = struct.get('Appearance', entry.appearance);

      entry.resref = struct.get('ResRef', entry.resref);

      entry.cr = struct.get('CR', entry.cr);
  
      entry.singleSpawn = struct.get('SingleSpawn', entry.singleSpawn);

      return entry;
    }
    return undefined;
  }

}