import { GameState } from "@/GameState";
import { GameEffectDurationType } from "@/enums/effects/GameEffectDurationType";
import { GameEffectSubType } from "@/enums/effects/GameEffectSubType";
import { GameEffectType } from "@/enums/effects/GameEffectType";
import { GFFDataType } from "@/enums/resource/GFFDataType";
// import { ModuleObjectManager } from "@/managers/ModuleObjectManager";
import type { Module, ModuleObject } from "@/module";
import { GFFField } from "@/resource/GFFField";
import { GFFStruct } from "@/resource/GFFStruct";

/**
 * GameEffect class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file GameEffect.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 * @see https://github.com/nwnxee/unified/blob/master/NWNXLib/API/Constants/Effect.hpp
 */
export class GameEffect {
  creator: any;
  duration: number;
  expireDay: number;
  expireTime: number;
  spellId: number;
  subType: number;
  skipOnLoad: boolean;
  applied: boolean;
  initialized: boolean;
  durationEnded: boolean;
  numIntegers: number;
  intList: number[] = [];
  floatList: number[] = [];
  stringList: string[] = [];
  objectList: ModuleObject[] = [];
  object: ModuleObject;
  type: GameEffectType;
  
  constructor(){
    this.creator = undefined;
    this.duration = 0;
    this.expireDay = 0;
    this.expireTime = 0;
    this.spellId = -1;
    this.subType = 0;
    this.skipOnLoad = false;

    this.applied = false;
    this.initialized = false;
    this.durationEnded = false;

    this.numIntegers = 8;
    this.intList = [];
    this.floatList = [];
    this.stringList = [];
    this.objectList = [];

  }

  initialize() {
    if(this.initialized)
      return this;

    if(!isNaN(this.creator)){
      this.creator = GameState.ModuleObjectManager.GetObjectById(this.creator);
    }

    this.initialized = true;
    return this;
  }

  loadModel(){
    return;
  }

  /** Runtime state a copy starts without: it's applied, timed and drawn on its own */
  static UNCOPIED = new Set(['applied', 'initialized', 'durationEnded', 'removed', 'object', 'age', 'model',
    'impact_model', 'impact_root_model', 'impact_head_model', 'impactTimer', 'impactRootTimer', 'impactHeadTimer']);

  /**
   * A fresh, unapplied copy. A script's effect is a value: applying it to several objects (a power hitting
   * everyone around) gives each its own. Shared, the one effect ended on the last object only, and stayed on the
   * rest for good, its beam or particles with it
   */
  clone(): this {
    const copy = new (this.constructor as any)();
    for(const key of Object.keys(this)){
      if(GameEffect.UNCOPIED.has(key)) continue;
      const value = (this as any)[key];
      copy[key] = Array.isArray(value) ? value.slice() : value;
    }
    return copy;
  }

  setCreator(oCreator: ModuleObject){
    this.creator = oCreator;
  }

  setDuration(duration = 0){
    this.duration = duration;
  }

  getSubType(){
    return this.subType & GameEffectSubType.MASK;
  }

  setSubType(subType = 0){
    if(subType >= 8 && subType <= GameEffectSubType.MASK){
      this.subType = (this.subType & ~GameEffectSubType.MASK | subType);
    }
  }

  getDurationType(){
    return this.subType & GameEffectDurationType.MASK;
  }

  setDurationType(durationType = 0){
    if(durationType >= 0 && durationType <= GameEffectDurationType.MASK){
      this.subType = (this.subType & ~GameEffectDurationType.MASK | durationType);
    }
  }

  setExpireDay(expireDay = 0){
    this.expireDay = expireDay;
  }

  setExpireTime(expireTime = 0){
    this.expireTime = expireTime;
  }

  setNumIntegers( num = 8 ){
    this.intList = new Array(num);
    this.intList.fill(0);
  }

  setSkipOnLoad( bSkipOnLoad = true ){
    this.skipOnLoad = bSkipOnLoad ? true : false;
  }

  setSpellId(nSpellId = -1){
    this.spellId = nSpellId;
  }

  setIntList(intList: any[] = []){
    if(Array.isArray(intList)){
      this.intList = intList;
    }
  }

  setInt(nOffset = 0, nValue = 0){
    this.intList[nOffset] = nValue;
  }

  setFloatList(floatList: any[] = []){
    if(Array.isArray(floatList)){
      this.floatList = floatList;
    }
  }

  setFloat(nOffset = 0, nValue = 0){
    this.floatList[nOffset] = nValue;
  }

  setStringList(stringList: any[] = []){
    if(Array.isArray(stringList)){
      this.stringList = stringList;
    }
  }

  setString(nOffset = 0, nValue = ''){
    this.stringList[nOffset] = nValue;
  }

  setObjectList(objectList: ModuleObject[] = []){
    if(Array.isArray(objectList)){
      this.objectList = objectList;
    }
  }

  setObject(nOffset = 0, nValue: ModuleObject){
    this.objectList[nOffset] = nValue;
  }

  setAttachedObject( oObject: ModuleObject|Module ){
    this.object = oObject as any;
  }

  getCreator(){
    return this.creator;
  }

  getDuration(){
    return this.duration;
  }

  getExpireDay(){
    return this.expireDay;
  }

  getExpireTime(){
    return this.expireTime;
  }

  getSpellId(){
    return this.spellId || -1;
  }

  getSubTypeUnMasked(){
    return this.subType;
  }

  setSubTypeUnMasked( subType = 0){
    this.subType = subType;
  }

  getInt(nOffset = 0){
    return this.intList[nOffset];
  }

  getFloat(nOffset = 0){
    return this.floatList[nOffset];
  }

  getString(nOffset = 0){
    return this.stringList[nOffset];
  }

  getObject(nOffset = 0){
    return this.objectList[nOffset];
  }

  update(delta: number = 0){
    if(this.getDurationType() == GameEffectDurationType.TEMPORARY){
      if(this.duration <= 0){
        this.onDurationEnd();
        return;
      }
      this.duration -= delta;
    }
  }

  dispose(){
    
  }

  ///////////////
  // Effect Events
  ///////////////

  //Called when the effect is applied ingame
  onApply(object?: ModuleObject){
    if(this.applied)
      return;

    this.applied = true;
  }

  //When the effect is removed ingame
  onRemove(){

  }
  
  //When the effect duration has expired
  onDurationEnd(){
    this.durationEnded = true;
    if(this.object && typeof this.object.removeEffect === 'function'){
      this.object.removeEffect(this);
    }else{
      this.onRemove();
    }
  }

  getSaveType(){
    return this.type;
  }

  save(){

    let effectStruct = new GFFStruct(2);
    effectStruct.addDWord64('Id', 0);
    effectStruct.addWord('Type', this.getSaveType());
    effectStruct.addWord('SubType', this.getSubTypeUnMasked());
    effectStruct.addFloat('Duration', this.getDuration());
    effectStruct.addByte('SkipOnLoad', this.skipOnLoad ? 1 : 0);
    effectStruct.addDWord('ExpireDay', this.getExpireDay());
    effectStruct.addDWord('ExpireTime', this.getExpireTime());
    effectStruct.addDWord('CreatorId',  typeof this.creator === 'object' ? this.creator.id : 2130706432 );
    effectStruct.addDWord('SpellId', this.getSpellId() >= 0 ? this.getSpellId() : 4294967295);
    effectStruct.addInt('IsExposed', 1);
    effectStruct.addInt('NumIntegers', 8);

    let intList = effectStruct.addField( new GFFField(GFFDataType.LIST, 'IntList') );
    for(let i = 0; i < 8; i++){
      let intStruct = new GFFStruct(3);
      intStruct.addField( new GFFField(GFFDataType.INT, "Value").setValue(this.getInt(i) || 0));
      intList.addChildStruct(intStruct);
    }

    let floatList = effectStruct.addField( new GFFField(GFFDataType.LIST, 'FloatList') );
    for(let i = 0; i < 4; i++){
      let floatStruct = new GFFStruct(4);
      floatStruct.addField( new GFFField(GFFDataType.FLOAT, "Value").setValue(this.getFloat(i) || 0.0));
      floatList.addChildStruct(floatStruct);
    }

    let stringList = effectStruct.addField( new GFFField(GFFDataType.LIST, 'StringList') );
    for(let i = 0; i < 6; i++){
      let stringStruct = new GFFStruct(5);
      stringStruct.addField( new GFFField(GFFDataType.CEXOSTRING, "Value").setValue(this.getString(i) || ''));
      stringList.addChildStruct(stringStruct);
    }

    let objectList = effectStruct.addField( new GFFField(GFFDataType.LIST, 'ObjectList') );
    for(let i = 0; i < 6; i++){
      let objectStruct = new GFFStruct(5);
      objectStruct.addField( new GFFField(GFFDataType.DWORD, "Value").setValue( this.getObject(i) ? this.getObject(i).id : 2130706432 ));
      objectList.addChildStruct(objectStruct);
    }

    return effectStruct;

  }

}
