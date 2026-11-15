import { GameEventType } from "@/enums/events/GameEventType";
import { GFFDataType } from "@/enums/resource/GFFDataType";
import { GFFField } from "@/resource/GFFField";
import { GFFStruct } from "@/resource/GFFStruct";
import { GameEvent } from "@/events/GameEvent";
import * as THREE from "three";

/**
 * EventSpawnBodyBag class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file EventSpawnBodyBag.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class EventSpawnBodyBag extends GameEvent {

  bodyBagId = 0;
  position = new THREE.Vector3;

  constructor(){
    super();

    //Event Type
    this.type = GameEventType.EventSpawnBodyBag;

  }

  eventDataFromStruct(struct: GFFStruct){
    if(struct instanceof GFFStruct){
      this.bodyBagId  = struct.getFieldByLabel('BodyBagId').getValue();
      this.position.x = struct.getFieldByLabel('PositionX').getValue();
      this.position.y = struct.getFieldByLabel('PositionY').getValue();
      this.position.z = struct.getFieldByLabel('PositionZ').getValue();
    }
  }

  execute(){

  }

  saveEventData(){
    let struct = new GFFStruct(0x5555);
    struct.addDWord('BodyBagId', this.bodyBagId);
    struct.addDWord('PositionX', this.position.x);
    struct.addDWord('PositionY', this.position.y);
    struct.addDWord('PositionZ', this.position.z);
    return struct;
  }

  export(){
    let struct = new GFFStruct( 0xABCD );

    struct.addDWord('CallerId',  this.callerId );
    struct.addDWord('Day', this.day);
    let eventData = struct.addField( new GFFField(GFFDataType.STRUCT, 'EventData') );
    eventData.addChildStruct( this.saveEventData() );
    struct.addDWord('EventId', this.id);
    struct.addDWord('ObjectId',  this.objectId );
    struct.addDWord('Time', this.time);

    return struct;
  }

}

