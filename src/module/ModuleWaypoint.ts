import { ModuleObject } from "@/module/ModuleObject";
import { GFFObject } from "@/resource/GFFObject";
import * as THREE from "three";
import { OdysseyModel3D } from "@/three/odyssey";
import { ResourceTypes } from "@/resource/ResourceTypes";
import { GFFField } from "@/resource/GFFField";
import { GFFDataType } from "@/enums/resource/GFFDataType";
import { GFFStruct } from "@/resource/GFFStruct";
import { CExoLocString } from "@/resource/CExoLocString";
import { ResourceLoader } from "@/loaders";
import { GameState } from "@/GameState";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";

/**
* ModuleWaypoint class.
* 
* Class representing a waypoint object found in modules areas.
* 
* KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
* 
* @file ModuleWaypoint.ts
* @author KobaltBlu <https://github.com/KobaltBlu>
* @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
* @memberof KotOR
*/
export class ModuleWaypoint extends ModuleObject {

  constructor ( gff = new GFFObject() ) {
    super(gff);
    this.objectType |= ModuleObjectType.ModuleWaypoint;

    this.template = gff;
    this.initProperties();

  }

  setFacingVector(facing = new THREE.Vector3()){
    if(this.model instanceof OdysseyModel3D)
      this.model.quaternion.setFromAxisAngle(new THREE.Vector3(0,0,1), -Math.atan2(this.getXOrientation(), this.getYOrientation()));
  }

  getFacingVector(){
    if(this.model instanceof OdysseyModel3D){
      let facing = new THREE.Vector3(0, 1, 0);
      facing.applyQuaternion(this.model.quaternion);
      return facing;
    }
    return new THREE.Vector3(0, 0, 0);
  }

  getXOrientation(){
    return this.xOrientation;
  }

  getYOrientation(){
    return this.yOrientation;
  }

  getZOrientation(){
    return this.zOrientation;
  }

  getTag(){
    return this.tag;
  }

  getTemplateResRef(){
    return this.templateResRef;
  }

  load(){
    if(this.getTemplateResRef()){
      //Load template and merge fields
      const buffer = ResourceLoader.loadCachedResource(ResourceTypes['utw'], this.getTemplateResRef());
      if(buffer){
        const gff = new GFFObject(buffer);
        this.template.merge(gff);
        this.initProperties();
      }else{
        console.error('Failed to load ModuleWaypoint template');
        if(this.template instanceof GFFObject){
          this.initProperties();
        }
      }
    }else{
      //We already have the template (From SAVEGAME)
      this.initProperties();
    }
  }

  save(){
    let gff = new GFFObject();
    gff.FileType = 'UTW ';
    gff.RootNode.type = 5;

    gff.RootNode.addField( this.actionQueueToActionList() );
    gff.RootNode.addByte('Commandable', 1);
    gff.RootNode.addByte('HasMapNote', 1);
    gff.RootNode.addFloat('LocalizedName', this.locName);
    gff.RootNode.addDWord('ObjectId', this.id);

    //SWVarTable
    let swVarTable = gff.RootNode.addField( new GFFField(GFFDataType.STRUCT, 'SWVarTable') );
    swVarTable.addChildStruct( this.getSWVarTableSaveStruct() );

    gff.RootNode.addCExoString('Tag', this.tag);
    gff.RootNode.addField( new GFFField(GFFDataType.LIST,  'VarTable') );
    
    if(this.template.RootNode.hasField('XOrientation')){
      gff.RootNode.addFloat('XOrientation', this.template.RootNode.getFieldByLabel('XOrientation').getValue());
    }else{
      gff.RootNode.addFloat('XOrientation', 0);
    }

    gff.RootNode.addFloat('XPosition', this.position.x);
    
    if(this.template.RootNode.hasField('YOrientation')){
      gff.RootNode.addFloat('YOrientation', this.template.RootNode.getFieldByLabel('YOrientation').getValue());
    }else{
      gff.RootNode.addFloat('YOrientation', 0);
    }
    
    gff.RootNode.addFloat('YPosition', this.position.y);
    
    if(this.template.RootNode.hasField('ZOrientation'))
      gff.RootNode.addFloat('ZOrientation', this.template.RootNode.getFieldByLabel('ZOrientation').getValue());
    
    gff.RootNode.addFloat('ZPosition', this.position.z);

    this.template = gff;
    return gff;
  }

  destroy(): void {
    super.destroy();
    if(this.area) this.area.detachObject(this);

    if(this.hasMapNote){
      if(GameState.module){
        GameState.module.area.areaMap.removeMapNote(this);
      }
    }
  }

}
