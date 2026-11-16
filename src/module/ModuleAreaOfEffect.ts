import { GFFDataType } from "@/enums/resource/GFFDataType";
import { NWScriptInstance } from "@/nwscript/NWScriptInstance";
import { GFFField } from "@/resource/GFFField";
import { GFFObject } from "@/resource/GFFObject";
import { ModuleObject } from "@/module/ModuleObject";
import { AreaOfEffectShape } from "@/enums/module/AreaOfEffectShape";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { ModuleObjectConstant } from "@/enums/module/ModuleObjectConstant";
import { GameEffectFactory } from "@/effects/GameEffectFactory";
import { GameState } from "@/GameState";

/**
 * ModuleAreaOfEffect class.
 * 
 * Class representing an area of effect.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file ModuleAreaOfEffect.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class ModuleAreaOfEffect extends ModuleObject {

  areaEffectId: number;
  duration: number;
  durationType: number;

  creator: ModuleObject;
  creatorId: number;

  linkedToObjectId: number;

  lastEnteredId: number;
  lastEntered: ModuleObject;

  lastLeftId: number;
  lastLeft: ModuleObject;

  radius: number;
  shape: AreaOfEffectShape;
  length: number;
  width: number;

  spellId: number;
  metaMagicType: number;
  spellSaveDC: number;
  spellLevel: number;

  onHeartbeat: NWScriptInstance;
  onUserDefined: NWScriptInstance;
  onObjectEnter: NWScriptInstance;
  onObjectExit: NWScriptInstance;

  //modulecalendar time
  lastHeartBeatDay: number;
  lastHeartbeatTime: number;

  constructor ( gff = new GFFObject() ) {
    super(gff);
    this.objectType |= ModuleObjectType.ModuleAreaOfEffect;
  }

  load(){
    //We already have the template (From SAVEGAME)
    this.initProperties();
  }

  initProperties(): void {
    this.areaEffectId = this.template.RootNode.get('AreaEffectId', this.areaEffectId);

    this.creatorId = this.template.RootNode.get('CreatorId', this.creatorId);

    this.commandable = this.template.RootNode.get('Commandable', this.commandable);

    this.duration = this.template.RootNode.get('Duration', this.duration);

    this.durationType = this.template.RootNode.get('DurationType', this.durationType);
  
    this.lastEnteredId = this.template.RootNode.get('LastEntered', this.lastEnteredId);

    this.lastLeftId = this.template.RootNode.get('LastLeft', this.lastLeftId);

    this.lastHeartBeatDay = this.template.RootNode.get('LastHrtbtDay', this.lastHeartBeatDay);

    this.lastHeartbeatTime = this.template.RootNode.get('LastHrtbtTime', this.lastHeartbeatTime);

    this.linkedToObjectId = this.template.RootNode.get('LinkedToObject', this.linkedToObjectId);
  
    this.metaMagicType = this.template.RootNode.get('MetaMagicType', this.metaMagicType);

    this.shape = this.template.RootNode.get('Shape', this.shape);

    //RECT
    if(this.shape == AreaOfEffectShape.RECTANGLE){
      this.length = this.template.RootNode.get('Length', this.length);

      if(this.template.RootNode.hasField('Width'))
        this.width = this.template.getFieldByLabel('Width').getValue();
    }
    //CIRCLE
    else
    {
      if(this.template.RootNode.hasField('Radius'))
        this.radius = this.template.getFieldByLabel('Radius').getValue();
    }
  
    this.spellId = this.template.RootNode.get('SpellId', this.spellId);
  
    this.spellLevel = this.template.RootNode.get('SpellLevel', this.spellLevel);
  
    this.spellSaveDC = this.template.RootNode.get('SpellSaveDC', this.spellSaveDC);

    this.xOrientation = this.template.RootNode.get('OrientationX', this.xOrientation);
    
    this.yOrientation = this.template.RootNode.get('OrientationY', this.yOrientation);
    
    this.zOrientation = this.template.RootNode.get('OrientationZ', this.zOrientation);
      
    this.position.x = this.template.RootNode.get('PositionX', this.position.x);
    
    this.position.y = this.template.RootNode.get('PositionY', this.position.y);
    
    this.position.z = this.template.RootNode.get('PositionZ', this.position.z);

    //ActionList
    try{
      if(this.template.RootNode.hasField('ActionList')){
        let actionStructs = this.template.RootNode.getFieldByLabel('ActionList').getChildStructs();
        for(let i = 0, len = actionStructs.length; i < len; i++){
          let action = GameState.ActionFactory.FromStruct(actionStructs[i]);
          if(action){
            this.actionQueue.add(action);
          }
        }
      }
    }catch(e: any){
      console.error(e);
    }

    //SWVarTable
    if(this.template.RootNode.hasField('SWVarTable')){
      let localBools = this.template.RootNode.getFieldByLabel('SWVarTable').getChildStructs()[0].getFieldByLabel('BitArray').getChildStructs();
      for(let i = 0, len = localBools.length; i < len; i++){
        let data = localBools[i].getFieldByLabel('Variable').getValue();
        for(let bit = 0; bit < 32; bit++){
          this._locals.Booleans[bit + (i*32)] = ( (data>>bit) % 2 != 0);
        }
      }
      let localNumbers = this.template.RootNode.getFieldByLabel('SWVarTable').getChildStructs()[0].getFieldByLabel('ByteArray').getChildStructs();
      for(let i = 0, len = localNumbers.length; i < len; i++){
        let data = localNumbers[i].getFieldByLabel('Variable').getValue();
        this.setLocalNumber(i, data);
      }
    }
    
    if(this.template.RootNode.hasField('EffectList')){
      let effects = this.template.RootNode.getFieldByLabel('EffectList').getChildStructs() || [];
      for(let i = 0, len = effects.length; i < len; i++){
        let effect = GameEffectFactory.EffectFromStruct(effects[i]);
        if(effect){
          effect.setAttachedObject(this);
          effect.loadModel();
          this.effects.push(effect);
        }
      }
    }
  }

  save(): GFFObject {
    let gff = new GFFObject();
    gff.FileType = 'AOE ';

    gff.RootNode.addDWord('ObjectId', this.id);

    gff.RootNode.addInt('AreaEffectId', this.areaEffectId); // vfx_persist id

    gff.RootNode.addDWord('LinkedToObject',  this.linkedToObject instanceof ModuleObject ? this.linkedToObject.id : ModuleObjectConstant.OBJECT_INVALID );

    gff.RootNode.addDWord('CreatorId',  this.creator instanceof ModuleObject ? this.creator.id : ModuleObjectConstant.OBJECT_INVALID );

    gff.RootNode.addDWord('LastEntered',  this.lastEntered instanceof ModuleObject ? this.lastEntered.id : ModuleObjectConstant.OBJECT_INVALID );

    gff.RootNode.addDWord('LastLeft',  this.lastLeft instanceof ModuleObject ? this.lastLeft.id : ModuleObjectConstant.OBJECT_INVALID );

    
    gff.RootNode.addDWord('Duration', this.duration);
    gff.RootNode.addByte('DurationType', this.durationType);
    gff.RootNode.addDWord('LastHrtbtDay', this.lastHeartBeatDay);
    gff.RootNode.addDWord('LastHrtbtTime', this.lastHeartBeatDay);

    gff.RootNode.addCExoString('OnHeartbeat', this.onHeartbeat.name);

    if(this.onHeartbeat instanceof NWScriptInstance){
      gff.RootNode.addCExoString('OnHeartbeat', this.onHeartbeat.name);
    }else{
      gff.RootNode.addCExoString('OnHeartbeat', '');
    }

    if(this.onUserDefined instanceof NWScriptInstance){
      gff.RootNode.addCExoString('OnUserDefined', this.onUserDefined.name);
    }else{
      gff.RootNode.addCExoString('OnUserDefined', '');
    }

    if(this.onObjectEnter instanceof NWScriptInstance){
      gff.RootNode.addCExoString('OnObjEnter', this.onObjectEnter.name);
    }else{
      gff.RootNode.addCExoString('OnObjEnter', '');
    }

    if(this.onObjectExit instanceof NWScriptInstance){
      gff.RootNode.addCExoString('OnObjExit', this.onObjectExit.name);
    }else{
      gff.RootNode.addCExoString('OnObjExit', '');
    }

    gff.RootNode.addCExoString('Tag', this.tag); // vfx_persist label

    gff.RootNode.addDWord('SpellId', this.spellId);
    gff.RootNode.addByte('Shape', this.shape);
    gff.RootNode.addByte('MetaMagicType', this.metaMagicType);
    gff.RootNode.addInt('SpellSaveDC', this.spellSaveDC);
    gff.RootNode.addInt('SpellLevel', this.spellLevel);

    if(this.shape == AreaOfEffectShape.RECTANGLE){ //RECT
      gff.RootNode.addFloat('Length', this.length);
      gff.RootNode.addFloat('Width', this.width);
    }else{ // Cricle
      gff.RootNode.addFloat('Radius', this.radius);
    }
    
    gff.RootNode.addField( this.actionQueueToActionList() );

    //SWVarTable
    let swVarTable = gff.RootNode.addField( new GFFField(GFFDataType.STRUCT, 'SWVarTable') );
    swVarTable.addChildStruct( this.getSWVarTableSaveStruct() );
    
    //Effects
    let effectList = gff.RootNode.addField( new GFFField(GFFDataType.LIST, 'EffectList') );
    for(let i = 0; i < this.effects.length; i++){
      effectList.addChildStruct( this.effects[i].save() );
    }

    gff.RootNode.addFloat('XPosition',  this.position.x );
    gff.RootNode.addFloat('YPosition',  this.position.y );
    gff.RootNode.addFloat('ZPosition',  this.position.z );

    let theta = this.rotation.z * Math.PI;

    gff.RootNode.addFloat('XOrientation',  1 * Math.cos(theta) );
    gff.RootNode.addFloat('YOrientation',  1 * Math.sin(theta) );
    gff.RootNode.addFloat('ZOrientation',  0 );
    
    return gff;
  }

}