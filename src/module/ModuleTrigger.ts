import { ModuleObject } from "@/module/ModuleObject";
import { GFFObject } from "@/resource/GFFObject";
import * as THREE from "three";
import { OdysseyModel3D, OdysseyObject3D } from "@/three/odyssey";
import { GameState } from "@/GameState";
import { ResourceTypes } from "@/resource/ResourceTypes";
import { GFFField } from "@/resource/GFFField";
import { GFFDataType } from "@/enums/resource/GFFDataType";
import { GFFStruct } from "@/resource/GFFStruct";
import { ModuleTriggerType } from "@/enums/module/ModuleTriggerType";
import { ConfigClient } from "@/utility/ConfigClient";
import { MDLLoader, ResourceLoader } from "@/loaders";
import { EngineMode } from "@/enums/engine/EngineMode";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { ActionParameterType, ModuleDoorAnimState, ModuleObjectConstant, SignalEventType } from "@/enums";
import { ModuleObjectScript } from "@/enums/module/ModuleObjectScript";
import { NWScript } from "@/nwscript/NWScript";


const OBJECTS_INSIDE_UPDATE_THRESHOLD = 15; // 15 frame ticks

/**
* ModuleTrigger class.
* 
* Class representing a trigger object found in modules areas.
* 
* KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
* 
* @file ModuleTrigger.ts
* @author KobaltBlu <https://github.com/KobaltBlu>
* @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
* @memberof KotOR
*/
export class ModuleTrigger extends ModuleObject {
  objectsInsideIdx: number;
  lastObjectEntered: ModuleObject;
  lastObjectExited: ModuleObject;
  triggered: boolean;

  trapModel: OdysseyModel3D;
  trapAnimationState: ModuleDoorAnimState = ModuleDoorAnimState.DEFAULT;
  trapName: string = '';

  reticleNode: OdysseyObject3D = new OdysseyObject3D();
  trapModelResRef: string;
  trapExplosionSound: string;
  trapTriggered: boolean;
  trapResRef: string;
  trapDetected: boolean = false;
  declare type: ModuleTriggerType;

  constructor ( gff = new GFFObject() ) {
    super(gff);
    this.objectType |= ModuleObjectType.ModuleTrigger;

    this.template = gff;
    this.objectsInside = [];
    this.objectsInsideIdx = 0;
    this.lastObjectEntered = null;
    this.lastObjectExited = null;

    this.setByPlayerParty = 0;

    this.tag = '';
    this.vertices = [];
    this.box = new THREE.Box3();

    this.triggered = false;
    this.highlightHeight = 0.10000000149011612;
    this.initProperties();

    this.container.add(this.reticleNode);
    this.reticleNode.position.z = this.highlightHeight;

  }

  /** The traps.2da row for this mine */
  getTrapRow(): any {
    return GameState.TwoDAManager.datatables.get('traps')?.rows[this.trapType];
  }

  /**
   * Demolitions DCs, as the skill's description gives them: setting a mine takes its set DC (15 / 20 / 25),
   * disarming it +5, recovering it +10. A mine placed with its own disarm DC keeps it.
   */
  getSetDC(): number {
    return parseInt(this.getTrapRow()?.setdc) || 15;
  }

  getDisarmDC(): number {
    return Number(this.trapDisarmDC) > 0 ? Number(this.trapDisarmDC) : this.getSetDC() + 5;
  }

  getRecoverDC(): number {
    return this.getDisarmDC() + 5;
  }

  /**
   * Lay a mine (a traps.2da row) on the ground: a small trap trigger owned by the setter's faction, so it goes
   * off under their enemies. Its own side knows where it is.
   */
  static CreateMine(area: any, position: THREE.Vector3, trapType: number, owner: ModuleObject | undefined, factionId?: number): ModuleTrigger | undefined {
    const row = GameState.TwoDAManager.datatables.get('traps')?.rows[trapType];
    if(!row || !area) return undefined;
    const trigger = new ModuleTrigger();
    trigger.initialized = true;
    trigger.type = ModuleTriggerType.TRAP;
    trigger.trapType = trapType;
    trigger.factionId = factionId ?? owner?.factionId ?? 1;
    trigger.faction = GameState.FactionManager.factions.get(trigger.factionId);
    trigger.setByPlayerParty = owner && (owner as any).isPartyMember?.() ? 1 : 0;
    trigger.trapOneShot = true;
    trigger.trapDetectable = true;
    trigger.trapDisarmable = true;
    const setterSkill = owner ? ((owner as any).getSkillLevel?.(1) || 0) : 0;
    // Spotting someone else's mine: its detect DC, plus how well it was hidden
    trigger.trapDetectDC = (parseInt(row.detectdcmod) || 20) + setterSkill;
    trigger.trapDisarmDC = (parseInt(row.setdc) || 15) + 5;
    trigger.trapDetected = !!owner;
    trigger.position.copy(position);
    trigger.vertices = [
      new THREE.Vector3(-1, -1, 0), new THREE.Vector3(1, -1, 0),
      new THREE.Vector3(1, 1, 0), new THREE.Vector3(-1, 1, 0),
    ];
    if(row.trapscript && row.trapscript !== '****'){
      const script = NWScript.Load(row.trapscript);
      if(script){
        script.caller = trigger;
        trigger.scripts[ModuleObjectScript.TriggerOnTrapTriggered] = script;
      }
    }
    area.attachObject(trigger);
    trigger.load();
    GameState.hooks.onMineChanged(trigger);
    return trigger;
  }

  getReticleNode(){
    return this.reticleNode;
  }

  getName(){
    if(this.type == ModuleTriggerType.TRAP){
      return this.trapName;
    }
    return '';
  }

  getType(){
    return this.type;
  }

  getTag(){
    return this.tag;
  }

  getTemplateResRef(){
    return this.templateResRef;
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

  isDead(){
    return false;
  }

  getCurrentRoom(){
    let _distance = 1000000000;
    for(let i = 0; i < GameState.module.area.rooms.length; i++){
      let room = GameState.module.area.rooms[i];
      let model = room.model;
      if(model instanceof OdysseyModel3D){
        let pos = this.position.clone();
        if(model.box.containsPoint(pos)){
          let roomCenter = model.box.getCenter(new THREE.Vector3()).clone();
          let distance = pos.distanceTo(roomCenter);
          if(distance < _distance){
            _distance = distance;
            this.attachToRoom(room);
          }
        }
      }
    }
  }

  getGeometry(){
    const trigGeom = new THREE.BufferGeometry();

    try{
      const vertices = this.vertices.slice();
      const holes: THREE.Vector2[][] = [];
      const triangles = THREE.ShapeUtils.triangulateShape ( vertices, holes );
      trigGeom.setIndex(triangles.flat());
      trigGeom.setAttribute( 'position', new THREE.Float32BufferAttribute( vertices.map( (v: THREE.Vector3) => v.toArray() ).flat(), 3 ) );
    }catch(e){
      console.error('ModuleTrigger', 'Failed to generate faces', {
        trigger: this,
        error: e
      })
    }

    // trigGeom.computeFaceNormals();
    trigGeom.computeVertexNormals();
    trigGeom.computeBoundingSphere();

    return trigGeom;
  }

  load(){
    this.mergeTemplate(ResourceTypes['utt']);
    this.initProperties();
    this.loadScripts();
    this.buildGeometry();
    this.initObjectsInside();
    this.loadTrap();
  }

  loadTrap(){
    if(this.type == 2 && this.trapModelResRef && this.trapModelResRef != '***' && this.trapModelResRef != '****'){
      MDLLoader.loader.load(this.trapModelResRef).then( (trapMDL) => { if(!trapMDL) return;
        OdysseyModel3D.FromMDL(trapMDL, {
          context: this.context,
          castShadow: false,
          receiveShadow: false,
          mergeStatic: false
        }).then( (model: OdysseyModel3D) => {
          this.trapModel = model;
          this.container.add(model);
          if(this.trapDetected){
            this.trapModel?.playAnimation('detect', false);
          }else{
            this.trapModel?.playAnimation('default', false);
          }
        });
      });
    }
  }

  buildGeometry(){
    let trigGeom = this.getGeometry();

    let material = new THREE.MeshBasicMaterial({
      color: new THREE.Color( 0xFFFFFF ),
      side: THREE.DoubleSide
    });

    switch(this.getType()){
      case ModuleTriggerType.GENERIC:
        material.color.setHex(0xFF0000)
      break;
      case ModuleTriggerType.TRANSITION:
        material.color.setHex(0x00FF00)
      break;
      case ModuleTriggerType.TRAP:
        material.color.setHex(0xFFEB00)
      break;
    }

    this.mesh = new THREE.Mesh( trigGeom, material );
    this.mesh.position.copy(this.position);
    this.box.setFromObject(this.mesh);
    this.box.min.z -= 100;
    this.box.max.z += 100;
    //this.box = this.mesh.box;

    /*
     * Orientation values are wrong in savegames. If rotation is not set they are always placed correctly
     * // this.mesh.rotation.set(this.getXOrientation(), this.getYOrientation(), this.getZOrientation());
     */

    this.mesh.userData.moduleObject = this;
    this.mesh.visible = false;
    this.container.add(this.mesh);
    GameState.group.triggers.add(this.container);
  }

  detectTrap(){
    if(this.trapDetected){ return; }
    this.trapDetected = true;
    GameState.hooks.onMineChanged(this);

    if(this.trapDetected){
      this.trapModel?.playAnimation('detect', false);
    }else{
      this.trapModel?.playAnimation('default', false);
    }
  }

  //Some modules have exit triggers that are placed in the same location that the player spawns into
  //This is my way of keeping the player from immediately activating the trigger
  //They will be added to the objectsInside array without triggering the onEnter script
  //If they leave the trigger and then return it will then fire normally
  initObjectsInside(){
    //Check to see if this trigger is linked to another module
    if(this.linkedToModule && this.type == 1){
      //Check Party Members
      const partyLen = GameState.PartyManager.party.length;
      for(let i = 0; i < partyLen; i++){
        const partymember = GameState.PartyManager.party[i];
        const pos = partymember.position;
        if(!this.box.containsPoint(pos)){ continue; }
        const added = this.addObjectInside(partymember);
        if(!added){ continue; }
        
        partymember.lastTriggerEntered = this;
        this.lastObjectEntered = partymember;
      }
    }else{
      //Check Creatures
      const creatureLen = GameState.module.area.creatures.length;
      for(let i = 0; i < creatureLen; i++){
        const creature = GameState.module.area.creatures[i];
        const pos = creature.position;
        if(!this.box.containsPoint(pos)){ continue; }

        const added = this.addObjectInside(creature);
        if(!added){ continue; }
        creature.lastTriggerEntered = this;
        this.lastObjectEntered = creature;
      }
    }
  }

  isInsideBoundingBox(object: ModuleObject): boolean {
    return this.box.containsPoint(object.position);
  }

  isInside(object: ModuleObject): boolean {
    return this.objectsInside.indexOf(object) >= 0;
  }

  addObjectInside(object: ModuleObject): boolean {
    const isInside = this.isInside(object);
    if(isInside){ return false; }
    this.objectsInside.push(object);
    return true;
  }

  removeObjectInside(object: ModuleObject): boolean {
    const isInside = this.isInside(object);
    if(!isInside){ return false; }
    this.objectsInside.splice(this.objectsInside.indexOf(object), 1);
    return true;
  }

  isUseable(): boolean {
    return this.type == ModuleTriggerType.TRAP;
  }

  canTrigger(object: ModuleObject): boolean {
    return this.isHostile(object) && (!this.triggered || !this.trapOneShot);
  }

  update(delta = 0){
    
    super.update(delta);
    
    if(!this.room) this.getCurrentRoom();
    try{
      if(!this.room.model.visible)
        return;
    }catch(e){}

    this.action = this.actionQueue[0];
    this.actionQueue.process( delta );

    if(this.trapModel){
      this.trapModel.update(delta);
      if(this.trapDetected && this.trapModel.animationManager.currentAnimation?.name != 'detect'){
        this.trapModel.playAnimation('detect', false);
      }else if(!this.trapDetected && this.trapModel.animationManager.currentAnimation?.name != 'default'){
        this.trapModel.playAnimation('default', false);
      }
    }
    
    //Call the function to update the objectsInside array
    //this.autoUpdateObjectsInside();

    if(this.mesh){
      this.mesh.visible = ConfigClient.get('Game.debug.trigger_geometry_show') ? true : false;
    }
  }

  /**
   * Timer for the objectsInside array update
   * If the timer is less than the OBJECTS_INSIDE_UPDATE_THRESHOLD, ignore the update
   */
  #autoObjectsInsideTimer = 0;

  /**
   * Update the objectsInside array
   * @deprecated - use the positionChanged event inside ModuleCreature instead
   * @param delta 
   * @returns 
   */
  autoUpdateObjectsInside(){
    this.#autoObjectsInsideTimer += 1;
    if(this.#autoObjectsInsideTimer < OBJECTS_INSIDE_UPDATE_THRESHOLD){ return; }
    this.#autoObjectsInsideTimer = 0;

    const creaturesToCheck = [
      ...GameState.module.area.creatures.filter(object => this.box.containsPoint(object.position)), 
      ...GameState.PartyManager.party.filter(object => this.box.containsPoint(object.position))
    ];

    //Check Creatures in Area
    const creatureLen = creaturesToCheck.length;
    for(let i = 0; i < creatureLen; i++){
      const creature = creaturesToCheck[i];
      this.updateObjectInside(creature);
    }
  }

  /**
   * Update the objectsInside array
   * @param object 
   * @returns 
   */
  updateObjectInside(object: ModuleObject){
    //Check if the creature is inside the bounding box
    const isInside = this.isInsideBoundingBox(object);  
    if(isInside){
      //If the creature is inside the bounding box, attempt to add it to the objectsInside array
      const added = this.addObjectInside(object);
      if(!added){ return; }
      if(!this.triggered && this.isHostile(object)){
        object.lastTriggerEntered = this;
        this.lastObjectEntered = object;

        this.onEnter(object);
        this.triggered = true;
      }
      return;
    }

    //If the creature is not inside the bounding box, attempt to remove it from the objectsInside array
    const removed = this.removeObjectInside(object);
    if(!removed){ return; }
    if(!this.triggered && this.isHostile(object)){
      object.lastTriggerExited = this;
      this.lastObjectExited = object;
      this.onExit(object);
    }
  }

  /**
   * Action dialog object
   * This is used to start a conversation with the trigger, Since the trigger is not a creature it cannot start a conversation itself
   * @param target 
   * @param dialogResRef 
   * @param ignoreStartRange 
   * @param bPrivate 
   * @param nConvoType 
   * @param clearable 
   */
  actionDialogObject( target: ModuleObject, dialogResRef = '', ignoreStartRange = true, bPrivate = 0, nConvoType = 1, clearable = false ){
    const action = new GameState.ActionFactory.ActionDialogObject();
    action.setParameter(0, ActionParameterType.DWORD, target.id);
    action.setParameter(1, ActionParameterType.STRING, dialogResRef);
    action.setParameter(2, ActionParameterType.INT, bPrivate ? 1 : 0);
    action.setParameter(3, ActionParameterType.INT, nConvoType);
    action.setParameter(4, ActionParameterType.INT, ignoreStartRange ? 1 : 0);
    action.setParameter(5, ActionParameterType.DWORD, ModuleObjectConstant.OBJECT_INVALID);
    action.clearable = clearable;
    console.log('ModuleTrigger.actionDialogObject', action);
    const player = GameState.getCurrentPlayer();
    if(!player){
      console.warn('ModuleTrigger.actionDialogObject: Player not found');
      return;
    }
    player.actionQueue.add(action);
  }

  onEnter(object?: ModuleObject){
    if(!object){ return; }
    console.log('ModuleTrigger.onEnter', this.type,  this.getTag());
    if(this.type == ModuleTriggerType.TRAP && !this.trapTriggered){
      if(GameState.hooks.isMineReplica(this)){ return; }
      if(object.isHostile(this)){
        this.trapTriggered = true;
        console.log('ModuleTrigger.onEnter', 'Trap Triggered')
        const event = new GameState.GameEventFactory.EventSignalEvent();
        event.setCaller(object);
        event.setObject(this);
        event.setDay(GameState.module.timeManager.pauseDay);
        event.setTime(GameState.module.timeManager.pauseTime);
        event.eventType = SignalEventType.OnTrapTriggered;
        GameState.module.addEvent(event);
        // A mine is used up when it goes off: take it away once its script has run
        if(this.trapOneShot !== false){
          setTimeout(() => { if(this.area) this.destroy(); }, 1500);
        }
      }
    }else if(this.linkedToModule && (GameState.Mode != EngineMode.DIALOG)){
      if(object == GameState.getCurrentPlayer()){
        GameState.LoadModule(this.linkedToModule.toLowerCase(), this.linkedTo.toLowerCase());
      }
      return;
    }

    console.log('ModuleTrigger', this.getTag(), 'enter 1')
    const event = new GameState.GameEventFactory.EventSignalEvent();
    event.setCaller(object);
    event.setObject(this);
    event.setDay(GameState.module.timeManager.pauseDay);
    event.setTime(GameState.module.timeManager.pauseTime);
    event.eventType = SignalEventType.OnObjectEnter;
    GameState.module.addEvent(event);
  }

  onExit(object?: ModuleObject){
    if(!object){ return; }
    console.log('ModuleTrigger', this.getTag(), 'exit')
    const event = new GameState.GameEventFactory.EventSignalEvent();
    event.setCaller(object);
    event.setObject(this);
    event.setDay(GameState.module.timeManager.pauseDay);
    event.setTime(GameState.module.timeManager.pauseTime);
    event.eventType = SignalEventType.OnObjectExit;
    GameState.module.addEvent(event);
  }

  static SCRIPT_KEYS: ModuleObjectScript[] = [
    ModuleObjectScript.TriggerOnClick,
    ModuleObjectScript.TriggerOnDisarm,
    ModuleObjectScript.TriggerOnTrapTriggered,
    ModuleObjectScript.TriggerOnHeartbeat,
    ModuleObjectScript.TriggerOnEnter,
    ModuleObjectScript.TriggerOnExit,
    ModuleObjectScript.TriggerOnUserDefined,
  ];

  initProperties(){
    
    if(!this.initialized){
      if(this.template.RootNode.hasField('ObjectId')){
        this.id = this.template.getFieldByLabel('ObjectId').getValue();
      }else if(this.template.RootNode.hasField('ID')){
        this.id = this.template.getFieldByLabel('ID').getValue();
      }
      
      GameState.ModuleObjectManager.AddObjectById(this);
    }

    this.autoRemoveKey = this.template.RootNode.get('AutoRemoveKey', this.autoRemoveKey);

    this.commandable = this.template.RootNode.get('Commandable', this.commandable);

    this.cursor = this.template.RootNode.get('Cursor', this.cursor);

    if(this.template.RootNode.hasField('Faction')){
      this.factionId = this.template.getFieldByLabel('Faction').getValue();
      if((this.factionId & 0xFFFFFFFF) == -1){
        this.factionId = 0;
      }
    }
    this.faction = GameState.FactionManager.factions.get(this.factionId);

    if(this.template.RootNode.hasField('Geometry')){
      this.geometry = this.template.getFieldByLabel('Geometry').getChildStructs();

      //Push verticies
      for(let i = 0; i < this.geometry.length; i++){
        let tgv = this.geometry[i];
        this.vertices[i] = new THREE.Vector3( 
          tgv.getFieldByLabel('PointX').getValue(),
          tgv.getFieldByLabel('PointY').getValue(),
          tgv.getFieldByLabel('PointZ').getValue()
        );
      }
    }

    this.highlightHeight = this.template.RootNode.get('HighlightHeight', this.highlightHeight);

    this.keyName = this.template.RootNode.get('KeyName', this.keyName);

    this.linkedTo = this.template.RootNode.get('LinkedTo', this.linkedTo);

    this.linkedToFlags = this.template.RootNode.get('LinkedToFlags', this.linkedToFlags);
  
    this.linkedToModule = this.template.RootNode.get('LinkedToModule', this.linkedToModule);
        
    this.loadScreenID = this.template.RootNode.get('LoadScreenID', this.loadScreenID);

    if(this.template.RootNode.hasField('LocalizedName'))
      this.localizedName = this.template.getFieldByLabel('LocalizedName').getCExoLocString();

    if(this.template.RootNode.hasField('PortraidId')){
      this.portraitId = this.template.getFieldByLabel('PortraidId').getValue();
      this.portrait = GameState.SWRuleSet.portraits[this.portraitId];
    }

    this.setByPlayerParty = this.template.RootNode.get('SetByPlayerParty', this.setByPlayerParty);

    if(this.setByPlayerParty){
      this.trapFlag = this.setByPlayerParty;
    }

    this.initCommonProperties();

    if(this.template.RootNode.hasField('TransitionDestin'))
      this.transitionDestin = this.template.getFieldByLabel('TransitionDestin').getCExoLocString();

    this.trapDetectable = this.template.RootNode.get('TrapDetectable', this.trapDetectable);

    this.trapDisarmable = this.template.RootNode.get('TrapDisarmable', this.trapDisarmable);

    this.trapOneShot = this.template.RootNode.get('TrapOneShot', this.trapOneShot);

    this.trapDetectDC = this.template.RootNode.get('TrapDetectDC', this.trapDetectDC);

    this.trapFlag = this.template.RootNode.get('TrapFlag', this.trapFlag);

    this.trapDisarmDC = this.template.RootNode.get('TrapDisarmDC', this.trapDisarmDC);

    this.trapType = this.template.RootNode.get('TrapType', this.trapType);

    this.type = this.template.RootNode.get('Type', this.type);

    if(this.template.RootNode.hasField('SWVarTable')){
      let localBools = this.template.RootNode.getFieldByLabel('SWVarTable').getChildStructs()[0].getFieldByLabel('BitArray').getChildStructs();
      //console.log(localBools);
      for(let i = 0; i < localBools.length; i++){
        let data = localBools[i].getFieldByLabel('Variable').getValue();
        for(let bit = 0; bit < 32; bit++){
          this._locals.Booleans[bit + (i*32)] = ( (data>>bit) % 2 != 0);
        }
      }
    }
    
    this.initialized = true;

    if(this.type == ModuleTriggerType.TRAP){
      const trap = GameState.TwoDAManager.datatables.get('traps')?.rows[this.trapType];
      if(trap){
        this.trapName = GameState.TLKManager.GetStringById(trap.name).Value;
        this.trapModelResRef = trap.model;
        this.trapExplosionSound = trap.explosionsound;
        this.trapResRef = trap.resref;
      }
    }

  }

  destroy(): void {
    GameState.hooks.onMineRemoved(this);
    super.destroy();

    if(this.trapModel){
      this.trapModel.removeFromParent();
      this.trapModel.dispose();
    }

    if(this.area) this.area.detachObject(this);
  }

  save(){
    let gff = new GFFObject();
    gff.FileType = 'UTT ';

    let actionList = gff.RootNode.addField( this.actionQueueToActionList() );
    gff.RootNode.addByte('AutoRemoveKey', this.autoRemoveKey);
    gff.RootNode.addByte('Commandable',  this.commandable );
    gff.RootNode.addDWord('CreatorId', 2130706432);
    gff.RootNode.addByte('Cursor', this.cursor);
    gff.RootNode.addDWord('Faction', this.faction ? this.faction.id : this.factionId);

    let geometry = gff.RootNode.addField( new GFFField(GFFDataType.LIST, 'Geometry') );
    for(let i = 0; i < this.vertices.length; i++){
      let vertStruct = new GFFStruct();
      vertStruct.addFloat('PointX', this.vertices[i].x);
      vertStruct.addFloat('PointY', this.vertices[i].y);
      vertStruct.addFloat('PointZ', this.vertices[i].z);
      geometry.addChildStruct(vertStruct);
    }

    gff.RootNode.addFloat('HighlightHeight', this.highlightHeight);
    gff.RootNode.addCExoString('KeyName', this.keyName);
    gff.RootNode.addCExoString('LinkedTo', this.linkedTo);
    gff.RootNode.addByte('LinkedToFlags', this.linkedToFlags);
    gff.RootNode.addRESREF('LinkedToModule', this.linkedToModule);
    gff.RootNode.addWord('LoadscreenID', this.loadScreenID);
    gff.RootNode.addField( new GFFField(GFFDataType.CEXOLOCSTRING, 'LocName') ).setValue(this.locName);
    gff.RootNode.addDWord('ObjectId', this.id);

    //Scripts
    this.saveScripts(gff.RootNode);
    
    gff.RootNode.addWord('PortraitId', this.portraitId);

    //SWVarTable
    let swVarTable = gff.RootNode.addField( new GFFField(GFFDataType.STRUCT, 'SWVarTable') );
    swVarTable.addChildStruct( this.getSWVarTableSaveStruct() );


    gff.RootNode.addByte('SetByPartyPlayer', this.setByPlayerParty);
    gff.RootNode.addCExoString('Tag', this.tag);
    gff.RootNode.addField( new GFFField(GFFDataType.CEXOLOCSTRING, 'TransitionDestin') ).setValue(this.transitionDestin);
    gff.RootNode.addByte('TrapDetectDC', this.trapDetectDC);
    gff.RootNode.addByte('TrapDetectable', this.trapDetectable);
    gff.RootNode.addByte('TrapDisarmable', this.trapDisarmable);
    gff.RootNode.addByte('TrapFlag', this.trapFlag);
    gff.RootNode.addByte('TrapOneShot', this.trapOneShot);
    gff.RootNode.addByte('TrapType', this.trapType);
    gff.RootNode.addByte('Type', this.type);
    gff.RootNode.addField( new GFFField(GFFDataType.LIST, 'VarTable') );
    gff.RootNode.addFloat('XOrientation', this.template.RootNode.getFieldByLabel('XOrientation').getValue());
    gff.RootNode.addFloat('XPosition', this.position.x);
    gff.RootNode.addFloat('YOrientation', this.template.RootNode.getFieldByLabel('YOrientation').getValue());
    gff.RootNode.addFloat('YPosition', this.position.y);
    gff.RootNode.addFloat('ZOrientation', this.template.RootNode.getFieldByLabel('ZOrientation').getValue());
    gff.RootNode.addFloat('ZPosition', this.position.z);

    this.template = gff;
    return gff;
  }

}
