import { GFFDataType } from "@/enums/resource/GFFDataType";
import { GFFField } from "@/resource/GFFField";
import { GFFStruct } from "@/resource/GFFStruct";
import * as THREE from "three";

/**
 * EncounterSpawnPointEntry class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file EncounterSpawnPointEntry.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class EncounterSpawnPointEntry{

  position = new THREE.Vector3();
  orientation = 0.0;

  save(){
    let struct = new GFFStruct();

    struct.addFloat('X', this.position.x);
    struct.addFloat('Y', this.position.y);
    struct.addFloat('Z', this.position.z);
    struct.addFloat('Orientation', this.orientation);

    return struct;
  }

  static FromStruct( struct: GFFStruct ){
    if(struct instanceof GFFStruct){
      let entry = new EncounterSpawnPointEntry();
      entry.position.x = struct.get('X', entry.position.x);

      entry.position.y = struct.get('Y', entry.position.y);

      entry.position.z = struct.get('Z', entry.position.z);
  
      entry.orientation = struct.get('Orientation', entry.orientation);

      return entry;
    }
    return undefined;
  }

}
