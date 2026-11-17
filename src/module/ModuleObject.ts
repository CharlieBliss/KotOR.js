import type { GMObjectState } from "@/managers/gm/GMObjectState";
import { isBehaviourScript } from "@/module/creature/ScriptControl";
import * as THREE from "three";
import type { Action } from "@/actions/Action";
import { ActionQueue } from "@/actions/ActionQueue";
import { AudioEmitter } from "@/audio/AudioEmitter";
import { CollisionManager } from "@/engine/CollisionManager";
import { CombatData } from "@/combat/CombatData";
import type { EffectLink } from "@/effects";
import type { GameEffect } from "@/effects/GameEffect";
import EngineLocation from "@/engine/EngineLocation";
import { ActionParameterType } from "@/enums/actions/ActionParameterType";
import { GameEffectType } from "@/enums/effects/GameEffectType";
import { GameEffectDurationType } from "@/enums/effects/GameEffectDurationType";
import { ModuleCreatureAnimState } from "@/enums/module/ModuleCreatureAnimState";
import { ModulePlaceableAnimState } from "@/enums/module/ModulePlaceableAnimState";
import { NWScriptEventType } from "@/enums/nwscript/NWScriptEventType";
import { GFFDataType } from "@/enums/resource/GFFDataType";
import { GameState } from "@/GameState";
import { IEffectIconListItem } from "@/interface/module/IEffectIconListItem";
import { SSFType } from "@/enums/resource/SSFType";
import { NWScriptEvent } from "@/nwscript/events";
import { NWScriptInstance } from "@/nwscript/NWScriptInstance";
import { OdysseyModel, OdysseyModelAnimation, OdysseyWalkMesh } from "@/odyssey";
import { CExoLocString } from "@/resource/CExoLocString";
import { GFFField } from "@/resource/GFFField";
import { GFFObject } from "@/resource/GFFObject";
import { ANIMATION_ID_STATES, CREATURE_ANIMATION_ROWS } from "@/module/data/animations";
import { ResourceLoader } from "@/loaders";
import { GFFStruct } from "@/resource/GFFStruct";
import { LIPObject } from "@/resource/LIPObject";
import { OdysseyModel3D, OdysseyObject3D } from "@/three/odyssey";
import { Utility } from "@/utility/Utility";
import { ComputedPath } from "@/engine/pathfinding";
import type { ModuleArea, ModuleDoor, ModuleItem, ModuleRoom } from "@/module";
import { EngineMode } from "@/enums/engine/EngineMode";
import { DLGObject } from "@/resource/DLGObject";
import { Faction } from "@/engine/Faction";
import { ITwoDAAnimation } from "@/interface/twoDA/ITwoDAAnimation";
import { SWPlaceableAppearance } from "@/engine/rules/SWPlaceableAppearance";
import { SWCreatureAppearance } from "@/engine/rules/SWCreatureAppearance";
import { SWDoorAppearance } from "@/engine/rules/SWDoorAppearance";
import { IDialogAnimationState } from "@/interface/animation/IDialogAnimationState";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { ModuleObjectConstant } from "@/enums/module/ModuleObjectConstant";
import type { IPerceptionInfo } from "@/interface/engine/IPerceptionInfo";
import { PerceptionMask } from "@/enums/engine/PerceptionMask";
import { MDLLoader } from "@/loaders";
import { CombatRound, CombatRoundAction } from "@/combat";
import { Dice } from "@/utility/Dice";
import { DiceType } from "@/enums/combat/DiceType";
import { BitWise } from "@/utility/BitWise";
import { ActionType } from "@/enums/actions/ActionType";
import { NWScript } from "@/nwscript/NWScript";
import { CombatActionType, EngineDebugType, ModuleObjectScript, ModuleTriggerType, SkillType, TalkVolume } from "@/enums";
import type { SWPortrait } from "@/engine/rules/SWPortrait";
import type { IHeardString } from "@/interface/dialog/IHeardString";
import type { SWRange } from "@/engine/rules/SWRange";
import { TURN_SPEED_SLOW } from "@/engine/TurnSpeeds";

/**
* ModuleObject class.
* 
* Class representing is the base class for all objects found in an area.
* 
* KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
* 
* @file ModuleObject.ts
* @author KobaltBlu <https://github.com/KobaltBlu>
* @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
* @memberof KotOR
*/
export class ModuleObject {
  facingSpeed: number = TURN_SPEED_SLOW;
  helperColor: THREE.Color = new THREE.Color(0xFFFFFF);

  combatOrder: number;
  combatRoundTimer: number;
  controlled: boolean;
  id: number;
  initialized: boolean;
  isPlayer: boolean = false;
  isPM: boolean = false;
  name: string;
  objectType: number = ModuleObjectType.ModuleObject;

  effectIconList: IEffectIconListItem[] = [];

  container: OdysseyObject3D;
  forceVector: THREE.Vector3 = new THREE.Vector3();
  position: THREE.Vector3 = new THREE.Vector3();
  lastPosition: THREE.Vector3 = new THREE.Vector3();
  rotation: THREE.Euler = new THREE.Euler();
  quaternion: THREE.Quaternion = new THREE.Quaternion();
  _triangle: THREE.Triangle = new THREE.Triangle();
  wm_c_point: THREE.Vector3 = new THREE.Vector3();
  box: THREE.Box3 = new THREE.Box3();
  sphere: THREE.Sphere = new THREE.Sphere();
  v20: THREE.Vector2 = new THREE.Vector2();
  v21: THREE.Vector2 = new THREE.Vector2();
  tmpPos: THREE.Vector3 = new THREE.Vector3();
  openSpot: any;

  audioEmitter: AudioEmitter;
  footstepEmitter: AudioEmitter;

  collisionManager: CollisionManager = new CollisionManager(this);
  invalidateCollision: boolean = false;
  combatData: CombatData = new CombatData(this);
  combatRound = new CombatRound(this);

  facing: number;
  wasFacing: number;
  force: number;
  speed: number;
  movementSpeed: number;

  area: ModuleArea;

  //Room
  room: ModuleRoom;
  rooms: ModuleRoom[] = [];
  roomIds: number[] = [];
  roomSize: THREE.Vector3;

  inventory: ModuleItem[] = [];

  model: OdysseyModel3D;
  xOrientation: number;
  yOrientation: number;
  zOrientation: number;

  dialogAnimation: {
    animation: OdysseyModelAnimation,
    data: ITwoDAAnimation,
    started: boolean,
  };

  dialogAnimationState: IDialogAnimationState = {
    animationIndex: -1,
    animation: undefined,
    data: undefined,
    started: false,
  };

  templateResRef: string = '';
  template: GFFObject;

  plot: boolean = false;
  scripts: {[key: string]: NWScriptInstance} = { };
  tag: string = '';
  bearing: number = 0;
  collisionTimer: number = 0;
  perceptionTimer: number = 0;
  tweakColor: number = 0xFFFFFF;
  useTweakColor: boolean = false;
  hp: number = 0;
  currentHP: number = 0;

  factionId: number = 0;
  faction: Faction;

  effects: GameEffect[] = [];
  casting: any[] = [];
  damageList: any[] = [];
  _locals: { Booleans: any[]; Numbers: {}; };
  objectsInside: any[];
  lockDialogOrientation: boolean = false;
  lastInventoryDisturbType: number = 0;
  lastInventoryDisturbItem: any = undefined;
  lastItemAcquired: any = undefined;
  context: any;

  heartbeatTimer: any;
  _heartbeatTimerOffset: number;
  _heartbeatTimeout: number;

  //Perception
  heardStrings: IHeardString[] = [];
  perceptionList: IPerceptionInfo[] = [];
  isListening: boolean;
  listeningPatterns: any = {};
  perceptionRange: SWRange;
  
  spawned: boolean = false;
  _inventoryPointer: number;

  //stats
  fortitudeSaveThrow: number;
  reflexSaveThrow: number;
  willSaveThrow: number;
  min1HP: boolean;

  //attributes
  placedInWorld: boolean = false;
  linkedToModule: string = '';
  linkedToFlags: number = 0;
  linkedTo: string = '';
  transitionDestin: CExoLocString = new CExoLocString();
  description: any;
  commandable: any;
  autoRemoveKey: any;
  animState: any;
  keyName: any;
  loadScreenID: any;
  locName: any;
  localizedName: any;
  hasMapNote: boolean;
  mapNote: CExoLocString;
  mapNoteEnabled: boolean;
  portraitId: number;
  portrait: SWPortrait;
  setByPlayerParty: any;
  highlightHeight: any;
  appearance: number = -1;
  cursor: any;
  isDeadSelectable: boolean = true;
  isDestroyable: boolean = true;
  isRaisable: boolean = true;
  playerCreated: boolean = false;

  //complex animation varaibles
  fp_push_played: any;
  fp_land_played: any;
  fp_getup_played: any;

  deferEventUpdate: any;
  distanceToCamera: any;
  facingAnim: boolean;
  mesh: THREE.Mesh;
  geometry: any;
  vertices: any;
  type: any;
  isReady: boolean = false;

  //Actions
  actionQueue: ActionQueue;
  action: Action;

  #computedPath: ComputedPath;
  
  lipObject: LIPObject;
  lookAtObject: ModuleObject;

  //last object effected
  lastTriggerEntered: ModuleObject;
  lastTriggerExited: ModuleObject;
  lastAreaEntered: ModuleObject;
  lastAreaExited: ModuleObject;
  lastModuleEntered: ModuleObject;
  lastModuleExited: ModuleObject;
  lastDoorEntered: ModuleDoor;
  lastDoorExited: ModuleDoor;
  lastPlaceableEntered: ModuleObject;
  lastPlaceableExited: ModuleObject;
  lastAoeEntered: ModuleObject;
  lastAoeExited: ModuleObject;

  conversation: DLGObject;
  cutsceneMode: boolean;

  trapDetectable: boolean;
  trapDetectDC: number;
  trapDisarmable: boolean;
  trapDisarmDC: number;
  trapOneShot: boolean;
  trapType: number;
  trapFlag: boolean;
  ownerDemolitions: number = -1;

  notBlastable: boolean = false;

  linkedToObject: ModuleObject;

  constructor (gff = new GFFObject) {
    this.helperColor.setHex( Math.random() * 0xFFFFFF );
    this.initialized = false;

    //this.moduleObject = null;
    this.forceVector = new THREE.Vector3();
    this.container = new OdysseyObject3D();
    this.container.userData.moduleObject = this;
    this.position = this.container.position;
    this.rotation = this.container.rotation;
    this.quaternion = this.container.quaternion;
    this._triangle = new THREE.Triangle();
    // this.wm_c_point = new THREE.Vector3();

    this.box = new THREE.Box3();
    this.sphere = new THREE.Sphere();
    this.facing = 0;
    this.wasFacing = 0;
    this.force = 0;
    this.speed = 0;
    this.movementSpeed = 1;
    this.room = undefined;
    this.rooms = [];
    this.roomSize = new THREE.Vector3();
    this.model = null;
    this.dialogAnimation = null;
    this.template = undefined;
    this.plot = false;
    this.inventory = [];
    this.scripts = {
      onAttacked: undefined,
      onDamaged: undefined,
      onDeath: undefined,
      onDialog: undefined,
      onDisturbed: undefined,
      onEndDialog: undefined,
      onEndRound: undefined,
      onHeartbeat: undefined,
      onBlocked: undefined,
      onNotice: undefined,
      onRested: undefined,
      onSpawn: undefined,
      onSpellAt: undefined,
      onUserDefined: undefined
    };

    this.tag = '';
    this.templateResRef = '';

    this.xOrientation = 0;
    this.yOrientation = 0;
    this.zOrientation = 0;
    this.bearing = 0;
    this.collisionTimer = 0;
    this.perceptionTimer = 0;

    this.tweakColor = 0;
    this.useTweakColor = false;

    this.hp = 0;
    this.currentHP = 0;

    this.actionQueue = new ActionQueue();
    this.actionQueue.setOwner( this );
    this.effects = [];
    this.casting = [];
    this.damageList = [];

    this._locals = {
      Booleans: [],
      Numbers: {}
    };

    this.objectsInside = [];
    this.lockDialogOrientation = false;

    this.context = GameState;
    this._heartbeatTimerOffset = Math.floor(Math.random() * 600) + 100;
    this._heartbeatTimeout = 0 + this._heartbeatTimerOffset;

    //Combat Info
    this.combatData.initialize();

    //Always add the object to it's own perceptionList
    this.perceptionList = [
      {
        object: this,
        objectId: this.id,
        data: PerceptionMask.SEEN_AND_HEARD
      }
    ];
    
    this.isListening = false;
    this.listeningPatterns = {};
    this.combatData.initiative = 0;

    this.spawned = false;

    //Pointers
    this._inventoryPointer = 0;

    this.v20 = new THREE.Vector2();
    this.v21 = new THREE.Vector2();

    this.fortitudeSaveThrow = 0;
    this.reflexSaveThrow = 0;
    this.willSaveThrow = 0;

  }

  /** The template fields naming this object type's event scripts; loadScripts() and saveScripts() use them */
  static SCRIPT_KEYS: ModuleObjectScript[] = [];

  /**
   * Merge this object's template (its blueprint in the game files) under the data it was placed with.
   * Returns false when the object names a template that can't be found; with no resref there is nothing to merge.
   */
  mergeTemplate(resType: number, resRef: string = this.getTemplateResRef()): boolean {
    if(!resRef){ return true; }
    const buffer = ResourceLoader.loadCachedResource(resType, resRef);
    if(!buffer){
      console.error(`Failed to load ${this.constructor.name} template ${resRef}`);
      return false;
    }
    this.template.merge(new GFFObject(buffer));
    return true;
  }

  /** Load the scripts named in scriptsNode (by default the template's root) for this type's SCRIPT_KEYS */
  loadScripts(scriptsNode: GFFStruct | undefined = this.template?.RootNode){
    if(!scriptsNode){ return; }
    for(const scriptKey of (this.constructor as typeof ModuleObject).SCRIPT_KEYS){
      const resRef = scriptsNode.get(scriptKey, '');
      if(!resRef){ continue; }
      const nwscript = GameState.NWScript.Load(resRef);
      if(!nwscript){
        console.warn(`${this.constructor.name}.loadScripts: Failed to load script [${scriptKey}]:${resRef} for object ${this.name}`);
        continue;
      }
      nwscript.caller = this;
      this.scripts[scriptKey] = nwscript;
    }
  }

  /** Write this type's SCRIPT_KEYS fields: each script's resref, or '' */
  saveScripts(root: GFFStruct){
    for(const scriptKey of (this.constructor as typeof ModuleObject).SCRIPT_KEYS){
      root.addRESREF(scriptKey, this.scripts[scriptKey]?.name || '');
    }
  }

  getScriptInstance(scriptKey: ModuleObjectScript): NWScriptInstance | undefined {
    const script = this.scripts[scriptKey];
    if(!script || !script.nwscript){ return undefined; }
    return this.scripts[scriptKey].newInstance();
  }

  /**
   * Attach to room
   * @param room 
   */
  attachToRoom(room: ModuleRoom){
    this.detachFromRoom(this.room);
    this.room = room;
    this.room.attachChildObject(this);
  }

  /**
   * Detach from room
   * @param room 
   */
  detachFromRoom(room: ModuleRoom){
    if(!room) return;
    room.removeChildObject(this); 
    this.room = undefined;
  }

  /**
   * Set the context
   * @param ctx 
   */
  setContext(ctx = GameState){
    this.context = ctx;
    if(this.model instanceof OdysseyModel3D){
      this.model.emitters.forEach( (emitter) => {
        emitter.context = this.context;
      });
    }
  }

  /**
   * Get the model
   * @returns 
   */
  getModel(){
    if(this.model instanceof THREE.Object3D)
      return this.model;
    else
      return this.model = new OdysseyModel3D();
  }

  /**
   * Check if the object is visible
   * @returns 
   */
  isVisible(){
    return this.getModel().visible;
  }

  /**
   * Get the hit distance
   * @returns 
   */
  getHitDistance(){
    return 1;
  }

  /**
   * Update the movement speed
   */
  updateMovementSpeed(){
    let movementSpeed = 1.0;

    for(let i = 0, len = this.effects.length; i < len; i++){
      const effect = this.effects[i];
      if(!effect) continue; let rate = 0;
      if(effect.type == GameEffectType.EffectMovementSpeedIncrease){
        rate = (effect.getInt(0) / 100);
      }else if(effect.type == GameEffectType.EffectMovementSpeedDecrease){
        rate = (effect.getInt(0) / -100);
      }
      movementSpeed += rate;
    }

    this.movementSpeed = movementSpeed;
  }

  /**
   * Update the object
   * @param delta 
   */
  update(delta = 0){

    this.updateDestroy(delta);
    if(this.willDestroy || this.destroyed){
      if(this.actionQueue && this.actionQueue.length > 0){
        this.actionQueue.clear();
      }
      return;
    }
    
    //Process the heartbeat timer
    if(this._heartbeatTimeout <= 0){
      if(GameState.module){
        this.triggerHeartbeat();
      }
      this._heartbeatTimeout = 3000;
    }else{
      this._heartbeatTimeout -= 1000*delta;
    }

    //Loop through and update the effects
    if(!this.deferEventUpdate){
      for(let i = 0, len = this.effects.length; i < len; i++){
        const lenBefore = this.effects.length; this.effects[i]?.update(delta); if(this.effects.length < lenBefore){ i -= (lenBefore - this.effects.length); len = this.effects.length; }
      }
    }

    if(GameState.currentCamera){
      this.distanceToCamera = this.position.distanceTo(GameState.currentCameraPosition);
    }

    if(this.spawned){
      this.collisionManager.roomCheck(delta);
    }

    this.sphere.center.copy(this.position);
    this.sphere.radius = this.getHitDistance() * 2;

  }

  updateDestroy(delta: number = 0){
    if(this.willDestroy && !this.destroyed){
      this.timeSinceDestroyStarted += delta;
      this.updateDestroyFade(delta);
      const fadeEndTime = this.noFadeOnDestroy ? 0 : (this.delayUntilFade + ModuleObject.FADE_TIME);
      const destroyTime = Math.max(this.delayUntilDestroy, fadeEndTime);
      if(this.timeSinceDestroyStarted >= destroyTime){
        this.destroy();
      }
    }
  }

  updateDestroyFade(delta: number = 0){
    if(this.noFadeOnDestroy || this.destroyed) return;
    if(this.timeSinceDestroyStarted >= this.delayUntilFade){
      const fadeElapsed = this.timeSinceDestroyStarted - this.delayUntilFade;
      this.setOpacity(Math.max(0, 1 - (fadeElapsed / ModuleObject.FADE_TIME)));
    }
  }

  /**
   * Update the paused state
   * @param delta 
   */
  updatePaused(delta: number = 0){
    // this.force = 0;
    // this.forceVector.set(0, 0, 0);
    if(this.spawned){
      this.updateModelVisibility();
    }
  }

  /**
   * Update the model visibility
   */
  updateModelVisibility(){
    if(!this.model){ return; }
    this.model.wasOffscreen = !this.model.visible;

    if(GameState.Mode == EngineMode.INGAME){
      if(!this.room){
        this.model.visible = true;
        return;
      }else{
        this.model.visible = !!this.room?.model?.visible;
      }

      //Check to see if the model is inside the current camera's frustum
      if(!this.isOnScreen()){
        this.model.visible = false;
      }
      return;
    }
    
    if(GameState.Mode == EngineMode.DIALOG || GameState.Mode == EngineMode.MINIGAME){
      this.model.visible = true;
    }
  }

  /**
   * Clear all actions
   * @param skipUnclearable 
   */
  clearAllActions(skipUnclearable = false){
    this.combatRound.clearActions();
    this.setComputedPath(undefined);
    //Reset the anim state
    //this.animState = 0;
    //this.actionQueue.clear();
    if(skipUnclearable){
      let i = this.actionQueue.length;
      while(i--){
        let action = this.actionQueue[i];
        if(action.type == ActionType.ActionDialogObject){ continue; }
        if(typeof action.clearable !== 'undefined'){
          if(action.clearable){
            this.actionQueue.splice(i , 1);
          }
        }else{
          this.actionQueue.splice(i , 1);
        }
      }
    }else{
      this.actionQueue.clear();
    }

    this.combatData.reset();
    //this.clearTarget();
  }

  /**
   * Clear the combat action
   * @param combatAction 
   * @returns 
   */
  clearCombatAction(combatAction: CombatRoundAction = undefined){
    return this.combatRound.clearAction(combatAction);
  }

  /**
   * Clear the combat action at index
   * @param index 
   * @returns 
   */
  clearCombatActionAtIndex(index: number = 0): boolean {
    if(index <= 0) return;
    return !!this.combatRound.scheduledActionList.splice(index, 1).length;
  }

  /**
   * Action play animation
   * @param anim 
   * @param speed 
   * @param time 
   */
  actionPlayAnimation(anim = 0, speed = 1, time = 1){
    if(typeof anim === 'string')
      throw 'anim cannot be a string!';

    const animConstant = this.getAnimationNameById(anim);
    if(animConstant >= 10000){
      const action = new GameState.ActionFactory.ActionPlayAnimation();
      action.setParameter(0, ActionParameterType.INT, animConstant);
      action.setParameter(1, ActionParameterType.FLOAT, speed || 1);
      action.setParameter(2, ActionParameterType.FLOAT, time);
      this.actionQueue.add(action);
    }else{
      console.error('actionPlayAnimation', animConstant, anim);
    }
  }

  /**
   * Action dialog object
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
    console.log('ModuleObject.actionDialogObject', action);
    this.actionQueue.add(action);
  }

  /**
   * Action use object
   * @param object 
   */
  actionUseObject( object: ModuleObject ){
    const action = new GameState.ActionFactory.ActionUseObject();
    action.setParameter(0, ActionParameterType.DWORD, object.id);
    this.actionQueue.add(action);
  }

  /**
   * Action open door
   * @param door 
   */
  actionOpenDoor( door: ModuleObject ){
    const action = new GameState.ActionFactory.ActionOpenDoor();
    action.setParameter(0, ActionParameterType.DWORD, door.id);
    action.setParameter(1, ActionParameterType.INT, 0);
    this.actionQueue.add(action);
  }

  /**
   * Action close door
   * @param door 
   */
  actionCloseDoor( door: ModuleObject ){
    const action = new GameState.ActionFactory.ActionCloseDoor();
    action.setParameter(0, ActionParameterType.DWORD, door.id);
    action.setParameter(1, ActionParameterType.INT, 0);
    this.actionQueue.add(action);
  }

  /**
   * Action wait
   * @param time 
   */
  actionWait( time = 0 ){
    const action = new GameState.ActionFactory.ActionWait();
    action.setParameter(0, ActionParameterType.FLOAT, time);
    this.actionQueue.add(action);
  }

  isSimpleCreature(){
    return false;
  }

  /**
   * Gets the length (duration) of an animation state in seconds
   * 
   * @param animationState - The animation state constant (e.g., ModuleCreatureAnimState.WALKING)
   * @returns The animation length in seconds, or 0 if not found
   */
  getAnimationLength(animationState: number): number {
    if (!this.model || !(this.model instanceof OdysseyModel3D)) {
      return 0;
    }

    // Get the animation data from the 2DA table
    const animationData = this.animationConstantToAnimation(animationState);
    if (!animationData || !animationData.name) {
      return 0;
    }

    // Find the animation in the model's animation list
    const animation = this.model.odysseyAnimationMap.get(animationData.name.toLowerCase().trim());
    if (!animation) {
      return 0;
    }

    return animation.length;
  }

  /**
   * Gets the length (duration) of an animation by name in seconds
   * 
   * @param animationName - The name of the animation (e.g., "walking", "attack")
   * @returns The animation length in seconds, or 0 if not found
   */
  getAnimationLengthByName(animationName: string): number {
    if (!this.model || !(this.model instanceof OdysseyModel3D)) {
      return 0;
    }

    // Find the animation in the model's animation list
    const animation = this.model.odysseyAnimationMap.get(animationName.toLowerCase().trim());
    if (!animation) {
      return 0;
    }

    return animation.length;
  }

  /**
   * Gets the current playing animation length in seconds
   * 
   * @returns The current animation length in seconds, or 0 if no animation is playing
   */
  getCurrentAnimationLength(): number {
    if (!this.model || !(this.model instanceof OdysseyModel3D)) {
      return 0;
    }

    const currentAnimation = this.model.animationManager.currentAnimation;
    if (!currentAnimation) {
      return 0;
    }

    return currentAnimation.length;
  }

  /**
   * Get the animation name by id
   * @param id 
   * @returns 
   */
  getAnimationNameById(id = -1){

    if(typeof id === 'string')
      throw 'getAnimation id cannot be a string';

    if(id >= 10000)
      return id;

    if(id in ANIMATION_ID_STATES){
      return ANIMATION_ID_STATES[id];
    }

    //console.error('Animation case missing', id);
    return ModuleCreatureAnimState.PAUSE;
  }

  /**
   * Get the animation constant to animation
   * @param animation_constant 
   * @returns 
   */
  animationConstantToAnimation( animation_constant = 10000 ): ITwoDAAnimation{

    const animations2DA = GameState.TwoDAManager.datatables.get('animations');
    if(animations2DA){

      // Stunned, held, choking...: that pose, whatever it's doing. Not once dead: killed while held, it kept the
      // stun pose for "die" and "dead" and never fell (on the GM's machine, where the stun is)
      const debilitatedEffect = this.isDead() ? undefined : this.effects.find( e => e.type == GameEffectType.EffectSetState );
      if(debilitatedEffect){
        switch(debilitatedEffect.getInt(0)){
          case 1: //Confused
            return animations2DA.rows[15];
          case 2: //Frightened
            return animations2DA.rows[73];
          case 3: //Droid Stun
            return animations2DA.rows[270];
          case 4: //Stunned
            return animations2DA.rows[78];
          case 5: //Paralyzed
            return animations2DA.rows[78];
          case 6: //Sleep
            return animations2DA.rows[76];
          case 7: //Choke
            if(this.isSimpleCreature()){
              return animations2DA.rows[264];
            }else{
              return animations2DA.rows[72];
            }
          break;
          case 8: //Horrified
            return animations2DA.rows[74];
          case 9: //Force Pushed
            if(!this.fp_push_played)
              return animations2DA.rows[84];
            if(!this.fp_land_played)
              return animations2DA.rows[85];
            if(!this.fp_getup_played)
              return animations2DA.rows[86];
          break;
          case 10: //Whirlwind
            return animations2DA.rows[75];
        }
      }
      
      const row = CREATURE_ANIMATION_ROWS[animation_constant];
      if(row){
        return animations2DA.rows[row.simple !== undefined && this.isSimpleCreature() ? row.simple : row.row];
      }

      switch( animation_constant ){
        case ModuleCreatureAnimState.PAUSE:
        case ModuleCreatureAnimState.PAUSE_ALT:
          if(this.isPoisoned() || this.isDiseased()) return animations2DA.rows[15];
          if(this.isSimpleCreature()){
            return animations2DA.rows[256];
          }else{
            if(this.getHP()/this.getMaxHP() > .20){
              return animations2DA.rows[6];
            }else{
              return animations2DA.rows[8];
            }
          }
        break;
        case ModuleCreatureAnimState.PAUSE2:
          if(this.isPoisoned() || this.isDiseased()) return animations2DA.rows[15];
          if(this.isSimpleCreature()){
            return animations2DA.rows[257];
          }else{
            if(this.getHP()/this.getMaxHP() > .20){
              return animations2DA.rows[7];
            }else{
              return animations2DA.rows[8];
            }
          }
        break;
        case ModuleCreatureAnimState.PAUSE3:
          if(this.isPoisoned() || this.isDiseased()) return animations2DA.rows[15];
          if(this.getHP()/this.getMaxHP() > .20){
            return animations2DA.rows[359];
          }else{
            return animations2DA.rows[8];
          }
        break;
        case ModuleCreatureAnimState.PAUSE4:
          if(this.isPoisoned() || this.isDiseased()) return animations2DA.rows[15];
          if(this.getHP()/this.getMaxHP() > .20){
            return animations2DA.rows[357];
          }else{
            return animations2DA.rows[8];
          }
        break;
        case ModuleCreatureAnimState.PAUSE_SCRATCH_HEAD:
          if(this.isPoisoned()) return animations2DA.rows[15];
          if(this.isSimpleCreature()){
            return animations2DA.rows[12];
          }else{
            if(this.getHP()/this.getMaxHP() > .20){
              return animations2DA.rows[7];
            }else{
              return animations2DA.rows[8];
            }
          }
        break;
        case ModuleCreatureAnimState.WALKING:
          if(this.isSimpleCreature()){
            if(this.getHP()/this.getMaxHP() > .20){
              return animations2DA.rows[253];
            }else{
              return animations2DA.rows[254];
            }
          }else{
            if(this.getHP()/this.getMaxHP() > .20){
              switch(this.getCombatAnimationWeaponType()){
                case 2:
                  return animations2DA.rows[338];
                case 3:
                  return animations2DA.rows[341];
                case 4:
                  return animations2DA.rows[339];
                case 7:
                  return animations2DA.rows[340];
                case 9:
                  return animations2DA.rows[340];
                default:
                  return animations2DA.rows[0];
              }
            }else{
              return animations2DA.rows[1];
            }
          }
        break;
        case ModuleCreatureAnimState.RUNNING:
          if(this.isSimpleCreature()){
            return animations2DA.rows[255];
          }else{
            if(this.getHP()/this.getMaxHP() > .20){
              switch(this.getCombatAnimationWeaponType()){
                case 1:
                  return animations2DA.rows[343];
                case 2:
                  return animations2DA.rows[345];
                case 3:
                  return animations2DA.rows[345];
                case 4:
                  return animations2DA.rows[3];
                case 7:
                  return animations2DA.rows[340];
                case 9:
                  return animations2DA.rows[340];
                default:
                  return animations2DA.rows[2];
              }
            }else{
              return animations2DA.rows[4];
            }
          }
        break;
        case ModuleCreatureAnimState.READY:
        case ModuleCreatureAnimState.READY_ALT:
          if(this.isSimpleCreature()){
            return animations2DA.rows[278];
          }else{
            switch(this.getCombatAnimationWeaponType()){
              case 1:
                return animations2DA.rows[92];
              case 2:
                return animations2DA.rows[133];
              case 3:
                return animations2DA.rows[174];
              case 4:
                return animations2DA.rows[215];
              case 5:
                return animations2DA.rows[223];
              case 6:
                return animations2DA.rows[237];
              case 7:
                return animations2DA.rows[245];
              case 9:
                return animations2DA.rows[84]; //84 == pushed | 85 == hit ground prone back | 86 == get up from ground prone
              default:
                return animations2DA.rows[249];
            }
          }
        break;
        case ModuleCreatureAnimState.FLOURISH:
          switch( this.getCombatAnimationWeaponType() ){
            case 1:
              return animations2DA.rows[91];
            case 2:
              return animations2DA.rows[132];
            case 3:
              return animations2DA.rows[173];
            case 4:
              return animations2DA.rows[214];
            case 5:
              return animations2DA.rows[222];
            case 6:
              return animations2DA.rows[136];
            case 7:
              return animations2DA.rows[244];
            case 8:
              return animations2DA.rows[373];
            case 9:
              return animations2DA.rows[244];
            default:
              return animations2DA.rows[373];
          }
        break;
        
        //BEGIN TSL ANIMATIONS
      }

    }

  }

  /**
   * Set the facing
   * @param facing 
   * @param instant 
   */
  setFacing(facing = 0, instant = false, speed = TURN_SPEED_SLOW){
    this.wasFacing = Utility.NormalizeRadian(this.rotation.z);
    this.facing = Utility.NormalizeRadian(facing);
    this.facingAnim = !instant;
    this.facingSpeed = speed;

    if(instant){
      this.rotation.z = this.wasFacing = this.facing;
    }
  }

  /**
   * On hover input event
   */
  onHover(){
    
  }

  /**
   * On click input event
   * @param callee 
   */
  onClick(callee: ModuleObject){

  }

  /**
   * Whether this object's script for slot runs now. A creature's behaviour scripts (ScriptControl) don't when
   * something else runs its behaviour (EngineHooks.runsBehaviourScripts: a GM session's AI); its story and rules
   * scripts always do
   */
  runsScript(slot: string, userEvent?: number): boolean {
    if(!BitWise.InstanceOfObject(this, ModuleObjectType.ModuleCreature)) return true;
    if(!isBehaviourScript(slot, userEvent)) return true;
    return GameState.hooks.runsBehaviourScripts(this as any);
  }

  /** Trigger the user defined event */
  triggerUserDefinedEvent( event: NWScriptEvent ){
    if(!(event instanceof NWScriptEvent)){ return; }
    if(!this.runsScript(ModuleObjectScript.CreatureOnUserDefined, parseInt(event.getInt(0)))){ return; }

    let onUserDefined: NWScriptInstance;
    if(BitWise.InstanceOfObject(this, ModuleObjectType.ModuleCreature)){
      onUserDefined = this.scripts[ModuleObjectScript.CreatureOnUserDefined];
    }else if(BitWise.InstanceOfObject(this, ModuleObjectType.ModulePlaceable)){
      onUserDefined = this.scripts[ModuleObjectScript.PlaceableOnUserDefined];
    }else if(BitWise.InstanceOfObject(this, ModuleObjectType.ModuleDoor)){
      onUserDefined = this.scripts[ModuleObjectScript.DoorOnUserDefined];
    }else if(BitWise.InstanceOfObject(this, ModuleObjectType.ModuleTrigger)){
      onUserDefined = this.scripts[ModuleObjectScript.TriggerOnUserDefined];
    }
    
    if(!onUserDefined){ return; }
    onUserDefined.lastPerceived = (this as any).lastPerceived; onUserDefined.run(this, parseInt(event.getInt(0)));
  }

  /**
   * Trigger the spell cast at event
   * @param event 
   */
  triggerSpellCastAtEvent( event: NWScriptEvent ){
    if(!(event instanceof NWScriptEvent)){ return; }
    if(!this.runsScript(ModuleObjectScript.CreatureOnSpellAt)){ return; }

    let onSpellAt: NWScriptInstance;
    if(BitWise.InstanceOfObject(this, ModuleObjectType.ModuleCreature)){
      onSpellAt = this.scripts[ModuleObjectScript.CreatureOnSpellAt];
    }else if(BitWise.InstanceOfObject(this, ModuleObjectType.ModulePlaceable)){
      onSpellAt = this.scripts[ModuleObjectScript.PlaceableOnSpellCastAt];
    }else if(BitWise.InstanceOfObject(this, ModuleObjectType.ModuleDoor)){
      onSpellAt = this.scripts[ModuleObjectScript.DoorOnSpellCastAt];
    }

    if(!onSpellAt){ return; }
    const instance = onSpellAt.nwscript.newInstance();
    instance.lastSpellCaster = event.getObject(0);
    instance.lastSpell = event.getInt(0);
    instance.lastSpellHarmful = event.getInt(1) ? true : false;
    instance.run(this);
  }

  /**
   * Script event handler
   * @param event 
   */
  scriptEventHandler( event: NWScriptEvent ){
    // console.log('scriptEventHandler', this.tag, event);
    if(event instanceof NWScriptEvent){
      switch(event.type){
        case NWScriptEventType.EventUserDefined:
          this.triggerUserDefinedEvent( event );
        break;
        case NWScriptEventType.EventSpellCastAt:
          this.triggerSpellCastAtEvent( event );
        break;
        default:
          console.error('scriptEventHandler', 'Unhandled Event', event, this);
        break;
      }
    }
  }

  /**
   * Trigger the heartbeat
   */
  triggerHeartbeat(){
    //Only allow the heartbeat script to run after the onspawn is called
    if(!(this.spawned === true && GameState.module.readyToProcessEvents)){
      return;
    }
    if(!this.runsScript(ModuleObjectScript.CreatureOnHeartbeat)){
      return;
    }

    let onHeartbeat: NWScriptInstance;
    if(BitWise.InstanceOfObject(this, ModuleObjectType.ModuleCreature)){
      onHeartbeat = this.scripts[ModuleObjectScript.CreatureOnHeartbeat];
    }else if(BitWise.InstanceOfObject(this, ModuleObjectType.ModulePlaceable)){
      onHeartbeat = this.scripts[ModuleObjectScript.PlaceableOnHeartbeat];
    }else if(BitWise.InstanceOfObject(this, ModuleObjectType.ModuleDoor)){
      onHeartbeat = this.scripts[ModuleObjectScript.DoorOnHeartbeat];
    }else if(BitWise.InstanceOfObject(this, ModuleObjectType.ModuleTrigger)){
      onHeartbeat = this.scripts[ModuleObjectScript.TriggerOnHeartbeat];
    }else if(BitWise.InstanceOfObject(this, ModuleObjectType.ModuleEncounter)){
      onHeartbeat = this.scripts[ModuleObjectScript.EncounterOnHeartbeat];
    }else if(BitWise.InstanceOfObject(this, ModuleObjectType.ModuleMGObstacle)){
      onHeartbeat = this.scripts[ModuleObjectScript.MGObstacleOnHeartbeat];
    }else if(BitWise.InstanceOfObject(this, ModuleObjectType.ModuleMGEnemy)){
      onHeartbeat = this.scripts[ModuleObjectScript.MGEnemyOnHeartbeat];
    }else if(BitWise.InstanceOfObject(this, ModuleObjectType.ModuleMGPlayer)){
      onHeartbeat = this.scripts[ModuleObjectScript.MGPlayerOnHeartbeat];
    }
    if(!onHeartbeat){ return; }

    onHeartbeat.run(this);
  }

  /**
   * Get the appearance
   * @returns 
   */
  getAppearance(): SWPlaceableAppearance|SWCreatureAppearance|SWDoorAppearance {
    return;
  }

  /**
   * On spawn
   * @param runScript 
   */
  onSpawn(runScript = true){

    let onSpawn: NWScriptInstance;
    if(BitWise.InstanceOfObject(this, ModuleObjectType.ModuleCreature)){
      onSpawn = this.scripts[ModuleObjectScript.CreatureOnSpawn];
    }

    if(runScript && onSpawn){
      onSpawn.run(this, 0);
      console.log('spawned', this.getName());
    }
    
    this.spawned = true;
    
    this.initEffects();
    this.computeBoundingBox();
  }

  /**
   * Get the name
   * @returns 
   */
  getName(): any {
    console.warn("Method not implemented.", this.tag);
    return '';
  }

  /**
   * Get the race
   * @returns 
   */
  getRace(): any {
    console.warn("Method not implemented.", this.tag);
    return 0;
  }

  //----------------------//
  // INVENTORY MANAGEMENT
  //----------------------//

  /**
   * Check if the object has the item by tag
   * @param sTag 
   * @returns 
   */
  hasItemByTag(sTag=''){
    sTag = sTag.toLowerCase();
    if(this.isPartyMember()){
      return !!GameState.InventoryManager.getItemByTag(sTag);
    }

    for(let i = 0; i < this.inventory.length; i++){
      const cItem = this.inventory[i];
      if(cItem.tag.toLocaleLowerCase() == sTag)
        return true;
    }
    
    return false;
  }

  /**
   * Add the item
   * @param item 
   * @returns 
   */
  addItem(item: ModuleItem){
    item.load();
    
    const eItem = this.getItemByTag(item.getTag());
    if(eItem){
      eItem.setStackSize(eItem.getStackSize() + item.getStackSize());
      return eItem;
    }else{
      this.inventory.push(item);
      return item;
    }
  }

  /**
   * Remove the item
   * @param item 
   * @param nCount 
   * @returns 
   */
  removeItem(item: ModuleItem, nCount = 1): ModuleItem {
    const eItem = this.getItemByTag(item.getTag());

    if(!eItem){
      return undefined;
    }

    const idx = this.inventory.indexOf(eItem);

    if(nCount < eItem.getStackSize()){
      eItem.setStackSize(eItem.getStackSize() - nCount);
    }else{
      this.inventory.splice(idx, 1);
    }

    return eItem.clone();
  }

  /**
   * Remove the item by tag
   * @param sTag 
   * @param nCount 
   * @returns 
   */
  removeItemByTag(sTag = '', nCount = 1): ModuleItem {
    const eItem = this.getItemByTag(sTag);

    if(!eItem){
      return undefined;
    }

    const idx = this.inventory.indexOf(eItem);

    if(nCount < eItem.getStackSize()){
      eItem.setStackSize(eItem.getStackSize() - nCount);
    }else{
      this.inventory.splice(idx, 1);
    }

    return eItem.clone();
  }

  /**
   * Get the item
   * @param oItem 
   * @returns 
   */
  getItem(oItem: ModuleItem): ModuleItem {
    if(!oItem){ return undefined; }

    for(let i = 0; i < this.inventory.length; i++){
      const cItem = this.inventory[i];
      if(cItem == oItem)
        return cItem;
    }
    return undefined;
  }

  /**
   * Get the item by tag
   * @param sTag 
   * @returns 
   */
  getItemByTag(sTag = ''): ModuleItem {
    if(this.isPartyMember()){
      return GameState.InventoryManager.getItemByTag(sTag) as ModuleItem;
    }

    for(let i = 0; i < this.inventory.length; i++){
      let item = this.inventory[i];
      if(item.getTag() == sTag)
        return item;
    }
    return;
  }

  /**
   * Get the gold
   * @returns 
   */
  getGold(): number {
    if(this.isPartyMember()){
      return GameState.PartyManager.Gold;
    }
    return 0;
  }

  /**
   * Add gold
   * @param nGold 
   */
  addGold(nGold = 0): void {
    if(this.isPartyMember()){
      GameState.PartyManager.AddGold(nGold);
      return;
    }
  }

  /**
   * Remove gold
   * @param nGold 
   */
  removeGold(nGold = 0): void {
    if(this.isPartyMember()){
      GameState.PartyManager.AddGold(-Math.abs(nGold));
      return;
    }
  }

  /**
   * Update the collision
   * @param delta 
   */
  updateCollision(delta: number = 0){
    //stub
  }

  /**
   * Do a command
   * @param script 
   */
  doCommand(script: NWScriptInstance){
    //console.log('doCommand', this.getTag(), script, action, instruction);
    let action = new GameState.ActionFactory.ActionDoCommand();
    action.setParameter(0, ActionParameterType.SCRIPT_SITUATION, script);
    this.actionQueue.add(action);
  }

  /**
   * Add a trap
   * @param nTrapId 
   * @param owner 
   */
  addTrap(nTrapId: number = -1, owner: ModuleObject){
    const trap = GameState.TwoDAManager.datatables.get('traps')?.rows[nTrapId];
    if(!trap){ return; }
    console.log('addTrap', trap);

    if(trap.trapscript?.length && trap.trapscript != '****'){
      const nwscript = NWScript.Load(trap.trapscript);
      nwscript.caller = this;
      if(BitWise.InstanceOfObject(this, ModuleObjectType.ModuleTrigger)){
        this.scripts[ModuleObjectScript.TriggerOnTrapTriggered] = nwscript;
      }else if(BitWise.InstanceOfObject(this, ModuleObjectType.ModulePlaceable)){
        this.scripts[ModuleObjectScript.PlaceableOnTrapTriggered] = nwscript;
      }else if(BitWise.InstanceOfObject(this, ModuleObjectType.ModuleDoor)){
        this.scripts[ModuleObjectScript.DoorOnTrapTriggered] = nwscript;
      }
    }

    this.trapType = nTrapId;

    this.ownerDemolitions = owner.getSkillLevel(SkillType.DEMOLITIONS);
    let d20 = 20;

    const nDetectDC = !isNaN(parseInt(trap.detectdcmod)) ? parseInt(trap.detectdcmod) : 0;
    this.trapDetectDC = nDetectDC + d20 + this.ownerDemolitions;
    this.trapDetectable = true;

    const nDisarmDC = !isNaN(parseInt(trap.disarmdcmod)) ? parseInt(trap.disarmdcmod) : 0;
    this.trapDisarmDC = nDisarmDC + d20 + this.ownerDemolitions;
    this.trapDisarmable = false;

    const trigger = new GameState.Module.ModuleArea.ModuleTrigger();
    trigger.initialized = true;
    trigger.name = GameState.TLKManager.GetStringById(parseInt(trap.name))?.Value;
    trigger.factionId = owner.factionId;
    trigger.type = ModuleTriggerType.TRAP;
    trigger.trapType = nTrapId;
    trigger.setByPlayerParty = owner.isPartyMember();
    trigger.trapDetectDC = this.trapDetectDC;
    trigger.trapDisarmDC = this.trapDisarmDC
    trigger.trapDetectable = false;
    trigger.trapDisarmable = false;
    trigger.ownerDemolitions = -1;
    trigger.position.copy(this.position);

    trigger.linkedToObject = this;
    this.linkedToObject = trigger;

    //Trigger Geomerty
    trigger.vertices[0] = new THREE.Vector3(-2,  2, 0);
    trigger.vertices[1] = new THREE.Vector3(-2, -2, 0);
    trigger.vertices[2] = new THREE.Vector3( 2,  2, 0);
    trigger.vertices[3] = new THREE.Vector3( 2,  2, 0);

    trigger.load();

    this.area.triggers.push(trigger);
  }

  //---------------//
  // STATUS CHECKS
  //---------------//

  /**
   * Check if the object is in conversation
   * @returns 
   */
  isInConversation(){
    return (GameState.Mode == EngineMode.DIALOG) && (GameState.CutsceneManager.owner == this || GameState.CutsceneManager.listener == this);
  }

  /**
   * Check if the object is dead
   * @returns 
   */
  isDead(){
    return this.getHP() <= 0;
  }

  /**
   * Check if the object is debilitated
   * @returns 
   */
  isDebilitated() {
    if(Array.isArray(this.effects)){
      for(const eff of this.effects){
        if(eff && eff.type === GameEffectType.EffectSetState && eff.getInt(0) >= 1 && eff.getInt(0) <= 10){
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Check if the object is stunned
   * @returns 
   */
  isStunned() {
    if(Array.isArray(this.effects)){
      for(const eff of this.effects){
        if(eff && eff.type === GameEffectType.EffectSetState && (eff.getInt(0) === 3 || eff.getInt(0) === 4)){
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Check if the object is paralyzed
   * @returns 
   */
  isParalyzed() {
    if(Array.isArray(this.effects)){
      for(const eff of this.effects){
        if(eff && eff.type === GameEffectType.EffectSetState && eff.getInt(0) === 5){
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Check if the object is poisoned
   * @returns 
   */
  isPoisoned() {
    return this.hasEffect(GameEffectType.EffectPoison);
  }

  /**
   * Check if the object is diseased
   * @returns 
   */
  isDiseased(): any {
    return this.hasEffect(GameEffectType.EffectDisease);
  }

  /**
   * Get the combat animation weapon type
   * @returns 
   */
  getCombatAnimationWeaponType() {
    return 0
  }

  /**
   * Check if the object is dueling
   * @returns 
   */
  isDueling(): boolean {
    return false;
  }

  /**
   * Check if the action is in range
   * @param action 
   * @returns 
   */
  actionInRange(action: Action){
    return true;
  }

  //---------------//
  // SCRIPT EVENTS
  //---------------//

  /**
   * On damaged
   */
  onDamaged(){
    if(this.isDead())
      return true;

    let onDamaged: NWScriptInstance;
    if(BitWise.InstanceOfObject(this, ModuleObjectType.ModuleCreature)){
      onDamaged = this.scripts[ModuleObjectScript.CreatureOnDamaged];
    }else if(BitWise.InstanceOfObject(this, ModuleObjectType.ModulePlaceable)){
      onDamaged = this.scripts[ModuleObjectScript.PlaceableOnDamaged];
    }else if(BitWise.InstanceOfObject(this, ModuleObjectType.ModuleDoor)){
      onDamaged = this.scripts[ModuleObjectScript.DoorOnDamaged];
    }

    if(onDamaged && this.runsScript(ModuleObjectScript.CreatureOnDamaged)){
      onDamaged.run(this);
    }
  }

  /**
   * On death
   */
  onDeath(){
    //stub
  }

  /**
   * On combat round end
   */
  onCombatRoundEnd() {
    //stub
  }

  /**
   * On dialog
   * @param oSpeaker 
   * @param listenPatternNumber 
   * @param conversation 
   * @returns 
   */
  onDialog(oSpeaker: ModuleObject, listenPatternNumber = -1, conversation: DLGObject = undefined): boolean {
    //stub
    return false;
  }

  /**
   * On attacked
   */
  onAttacked(attackType: CombatActionType){
    //stub
  }

  /**
   * On blocked
   */
  onBlocked(){
    //stub
  }

  speakString(str: string, volume: TalkVolume){
    //https://nwnlexicon.com/index.php?title=SpeakString
    let notifyCreatures = false;
    let notifyPCs = false;
    let talkVolume = volume;

    let range = 5;
    switch(talkVolume){
      case TalkVolume.TALK:

      break;
      case TalkVolume.WHISPER:

      break;
      case TalkVolume.SHOUT:

      break;
      case TalkVolume.SILENT_TALK:
        range = 20;
        notifyCreatures = true;
      break;
      case TalkVolume.SILENT_SHOUT:
        range = 1000;
        notifyCreatures = true;
        notifyPCs = true;
      break;
    }

    const rangeSquared = range * range;
    let cDistanceSquared = 0;
    // console.log('SpeakString', this.getName(), str, volume, range);
    const speakString = str.toLowerCase();

    if(notifyPCs){
      for(let i = 0, len = GameState.PartyManager.party.length; i < len; i++){
        const creature = GameState.PartyManager.party[i];
        if(creature != (this as any) && !creature.isDead()){
          cDistanceSquared = this.position.distanceToSquared(creature.position);
          if(cDistanceSquared > rangeSquared){ continue; }
          creature.heardStrings.push({ 
            speaker: this, 
            string: speakString, 
            volume: talkVolume 
          });
        }
      }
    }

    if(notifyCreatures){
      for(let i = 0, len = GameState.module.area.creatures.length; i < len; i++){
        const creature = GameState.module.area.creatures[i];
        if(creature != (this as any) && !creature.isDead()){
          cDistanceSquared = this.position.distanceToSquared(creature.position);
          if(cDistanceSquared > rangeSquared){ continue; }

          creature.heardStrings.push({
            speaker: this,
            string: speakString, 
            volume: talkVolume
          });
        }
      }
    }
  }
  
  /**
   * Reset the excited duration
   */
  resetExcitedDuration() {
    console.warn("Method not implemented.", this.tag);
  }

  /**
   * Set the commadable
   * @param arg0 
   */
  setCommadable(arg0: any) {
    console.warn("Method not implemented.", this.tag);
  }

  /**
   * Damage the object
   * @param amount 
   * @param oAttacker 
   * @param delayTime 
   */
  damage(amount = 0, oAttacker?: ModuleObject, delayTime = 0){
    this.subtractHP(amount);
    this.combatData.lastDamager = oAttacker;
    this.combatData.lastAttacker = oAttacker;
    this.onDamaged();
  }

  /**
   * Get the current room
   * @returns 
   */
  getCurrentRoom(){
    this.collisionManager.findWalkableFace();
  }

  /**
   * Get the computed path
   * @returns 
   */
  getComputedPath(){
    return this.#computedPath;
  }

  /**
   * Set the computed path
   * @param computedPath 
   */
  setComputedPath(computedPath: ComputedPath){
    if(!!this.#computedPath){
      this.#computedPath.dispose();
    }
    this.#computedPath = computedPath;
    if(!this.#computedPath) return;

    this.#computedPath.owner = this;
    if(this.context?.debug[EngineDebugType.PATH_FINDING]){
      this.#computedPath.enableHelper = true;
    }
    this.#computedPath.buildHelperLine();
  }

  #tmpLIOVec3 = new THREE.Vector3();
  /**
   * Check if a line intersects the object
   * @param line 
   * @returns 
   */
  checkLineIntersectsObject(line: THREE.Line3){
    line.closestPointToPoint(this.position, true, this.#tmpLIOVec3);
    // Check if the closest point is within the radius of the point
    return this.#tmpLIOVec3.distanceTo(this.position) <= this.getHitDistance();
  }

  // findWalkableFace(object?: ModuleObject){
  //   let face;
  //   let room;
  //   for(let i = 0, il = this.area.rooms.length; i < il; i++){
  //     room = this.area.rooms[i];
  //     if(room.walkmesh){
  //       for(let j = 0, jl = room.walkmesh.walkableFaces.length; j < jl; j++){
  //         face = room.walkmesh.walkableFaces[j];
  //         if(face.triangle.containsPoint(this.position)){
  //           this.groundFace = face;
  //           this.lastGroundFace = this.groundFace;
  //           this.surfaceId = this.groundFace.walkIndex;
  //           this.attachToRoom(room);
  //           face.triangle.closestPointToPoint(this.position, this.collisionManager.wm_c_point);
  //           this.position.z = this.collisionManager.wm_c_point.z + .005;
  //         }
  //       }
  //     }
  //   }
  //   return face;
  // }

  #tmpCHVec3 = new THREE.Vector3();

  /**
   * Get the camera hook position
   * @returns 
   */
  getCameraHookPosition(){
    if(this.model && this.model.camerahook){
      this.model.camerahook.getWorldPosition(this.#tmpCHVec3);
      return this.#tmpCHVec3;
    }

    this.#tmpCHVec3.copy(this.position)
    this.#tmpCHVec3.z += 1.5;
    return this.#tmpCHVec3;
  }

  /**
   * Get the camera height
   * @returns 
   */
  getCameraHeight(){
    if(this.model && this.model.camerahook){
      this.model.camerahook.getWorldPosition(this.#tmpCHVec3);
      return this.#tmpCHVec3.z;
    }
    return 1.5;
  }

  /**
   * Set the cutscene mode
   * @param state 
   */
  setCutsceneMode(state: boolean = false){
    console.log('setCutsceneMode', this.getTag(), state);
    this.cutsceneMode = state;
    if(this.model && this.model.skins){
      for(let i = 0, len = this.model.skins.length; i < len; i++){
        this.model.skins[i].frustumCulled = !state;
      }
    }
  }

  /**
   * Apply a visual effect
   * @param resref 
   */
  applyVisualEffect(resref = 'v_light'){
    if(this.model instanceof OdysseyModel3D){
      MDLLoader.loader.load(resref).then( (mdl: OdysseyModel) => {
        OdysseyModel3D.FromMDL(mdl, { 
          context: this.context,
          // manageLighting: false
        }).then( (effectMDL: OdysseyModel3D) => {
          if(this.model instanceof OdysseyModel3D){
            this.model.effects.push(effectMDL);
            this.model.add(effectMDL);
            const anim = effectMDL.playAnimation(0, false);
            setTimeout(() => {
              effectMDL.stopAnimation();
              this.model.remove(effectMDL);
              effectMDL.disableEmitters();
              setTimeout( () => {
                if(this.model instanceof OdysseyModel3D){
                  let index = this.model.effects.indexOf(effectMDL);
                  effectMDL.dispose();
                  this.model.effects.splice(index, 1);
                }
              }, 5000);
            }, (anim ? anim.length * 1000 : 1500) )
          }
        }).catch(() => {

        });
      }).catch(() => {

      });
    }
  }

  /**
   * Set the position
   * @param x 
   * @param y 
   * @param z 
   */
  setPosition(x: THREE.Vector3|number = 0, y = 0, z = 0){
    if(x instanceof THREE.Vector3){
      z = x.z;
      y = x.y;
      x = x.x;
    }

    try{
      this.position.set(x, y, z);
      this.computeBoundingBox();
      this.updateCollision();
    }catch(e){
      console.error('ModuleObject.setPosition failed ');
    }
  }

  /**
   * Get the position
   * @returns 
   */
  getPosition(){
    return this.position;
  }

  /**
   * Get the orientation
   * @returns 
   */
  getOrientation(){
    return this.rotation;
  }

  /**
   * Get the facing
   * @returns 
   */
  getFacing(){
    return this.rotation.z;
  }

  /**
   * Set the facing object
   * @param target 
   */
  setFacingObject( target: ModuleObject ){

  }

  /**
   * Get the rotation
   * @returns 
   */
  getRotation(){
    return Math.floor(this.getFacing() * 180) + 180;
  }

  /**
   * Get the location
   * @returns 
   */
  getLocation(){
    const rotation = this.getRotationFromBearing();

    const location = new EngineLocation(
      this.position.x, this.position.y, this.position.z,
      rotation.x, rotation.y, rotation.z,
      GameState?.module?.area
    );

    return location;
  }

  /**
   * Get the rotation from bearing
   * @param bearing 
   * @returns 
   */
  getRotationFromBearing( bearing: number = undefined ){
    const theta = (typeof bearing == 'number') ? bearing : this.rotation.z;

    return new THREE.Vector3(
      Math.cos(theta),
      Math.sin(theta),
      0
    );
  }

  /**
   * Look at an object
   * @param oObject 
   */
  lookAt(oObject: ModuleObject){
    return;
  }

  /**
   * Check if the object is static
   * @returns 
   */
  isStatic(){
    return false;
  }

  /**
   * Check if the object is useable
   * @returns 
   */
  isUseable(){
    return false;
  }

  /**
   * Get the conversation
   * @returns 
   */
  getConversation(): DLGObject {
    return this.conversation;
  }

  /**
   * Get the fortitude save
   * @returns 
   */
  getFortitudeSave(){
    return this.fortitudeSaveThrow;
  }

  /**
   * Get the reflex save
   * @returns 
   */
  getReflexSave(){
    return this.reflexSaveThrow;
  }

  /**
   * Fortitude save
   * @param nDC 
   * @param nSaveType 
   * @param oVersus 
   * @returns 
   */
  /** SAVING_THROW_TYPE_* a creature can be immune to, as IMMUNITY_TYPE_* */
  static SAVE_TYPE_IMMUNITY: Record<number, number> = { 4: 32, 5: 3, 8: 4, 10: 1, 12: 2, 14: 5, 18: 6 };

  /** A save made against an effect it's immune to; and bonuses that depend on what's being saved against */
  saveImmune(nSaveType: number): boolean {
    const immunity = ModuleObject.SAVE_TYPE_IMMUNITY[nSaveType];
    return !!immunity && !!(this as any).isImmune?.(immunity);
  }

  saveSituationalBonus(fromSpellId: number): number {
    if(fromSpellId < 0) return 0;
    const spell = GameState.TwoDAManager?.datatables.get('spells')?.rows[fromSpellId];
    const grenade = String(spell?.impactscript || '').toLowerCase() === 'k_sup_grenade';
    return grenade ? ((this as any).getGrenadeSaveBonus?.() || 0) : 0;
  }

  fortitudeSave(nDC = 0, nSaveType = 0, oVersus: any = undefined, fromSpellId: number = -1){
    if(this.saveImmune(nSaveType)) return 2;
    let roll = Dice.roll(1, DiceType.d20);
    let bonus = CombatRound.GetMod(this.getCON()) + this.saveSituationalBonus(fromSpellId);
    
    if(roll === 20) return 1;
    if(roll === 1) return 0;
    if((roll + this.getFortitudeSave() + bonus) >= nDC){
      return 1
    }

    return 0;
  }

  /**
   * Get the CON
   * @returns 
   */
  getCON(): number {
    return 0;;
  }

  /**
   * Reflex save
   * @param nDC 
   * @param nSaveType 
   * @param oVersus 
   * @returns 
   */
  reflexSave(nDC = 0, nSaveType = 0, oVersus: any = undefined, fromSpellId: number = -1){
    if(this.saveImmune(nSaveType)) return 2;
    let roll = Dice.roll(1, DiceType.d20);
    let bonus = CombatRound.GetMod(this.getDEX()) + this.saveSituationalBonus(fromSpellId);
    
    if(roll === 20) return 1;
    if(roll === 1) return 0;
    if((roll + this.getReflexSave() + bonus) >= nDC){
      return 1
    }

    return 0;
  }

  /**
   * Get the DEX
   * @returns 
   */
  getDEX(): number {
    return 0;
  }

  /**
   * Get the will save
   * @returns 
   */
  getWillSave(){
    return this.willSaveThrow;
  }

  /**
   * Will save
   * @param nDC 
   * @param nSaveType 
   * @param oVersus 
   * @returns 
   */
  willSave(nDC = 0, nSaveType = 0, oVersus: any = undefined, fromSpellId: number = -1){
    if(this.saveImmune(nSaveType)) return 2;
    let roll = Dice.roll(1, DiceType.d20);
    let bonus = CombatRound.GetMod(this.getWIS()) + this.saveSituationalBonus(fromSpellId);

    if(roll === 20) return 1;
    if(roll === 1) return 0;
    if((roll + this.getWillSave() + bonus) >= nDC){
      return 1
    }

    return 0;
  }

  /**
   * Get the WIS
   * @returns 
   */
  getWIS(): number {
    return 0;
  }

  /**
   * Get the skill level
   * @param value 
   * @returns 
   */
  getSkillLevel(value: number = 0): number {
    return 0;
  }
  
  /**
   * Resist force
   * @param oCaster 
   * @returns 
   */
  resistForce(oCaster: ModuleObject){
    // Only a creature with Force resistance can resist: the caster rolls d20 + its level against it (the
    // Aurora rules KotOR uses; Resist Force, Force Immunity and some beasts give it). Saving throws are separate.
    if(BitWise.InstanceOfObject(this, ModuleObjectType.ModuleCreature) && BitWise.InstanceOfObject(oCaster, ModuleObjectType.ModuleCreature)){
      if(oCaster === this) return 0;
      const resistance = (this as any).getForceResistance?.() || 0;
      if(resistance <= 0) return 0;
      const casterLevel = (oCaster as any).getTotalClassLevel?.() || 0;
      return Dice.roll(1, DiceType.d20, casterLevel) < resistance ? 1 : 0;
    }
    return 0;
  }

  /** Whether an effect can't take hold on it (an immunity); creatures override this */
  isImmuneToEffect(effect: GameEffect): boolean {
    return false;
  }

  /**
   * Initialize all effects for the object
   */
  initEffects(){
    for(let i = 0, len = this.effects.length; i < len; i++){
      const effect = this.effects[i];
      if(!effect ){ continue; }

      effect.initialize();
      //effect.setCreator(this);
      effect.setAttachedObject(this);
      effect.onApply(this);
    }
  }

  /**
   * Add an effect to the object
   * @param effect - The effect to add
   * @param type - The type of effect
   * @param duration - The duration of the effect
   */
  addEffect(effect: GameEffect, type = 0, duration = 0){
    if(!effect){
      console.warn('AddEffect', 'Invalid GameEffect', effect);
      return;
    }

    if(effect.type == GameEffectType.EffectLink){
      const e1 = (effect as EffectLink).effect1;
      const e2 = (effect as EffectLink).effect2;
      //EFFECT LEFT
      if(e1){
        e1.setDurationType(type);
        e1.setDuration(duration);
        this.addEffect(e1, type, duration);
      }

      //EFFECT RIGHT
      if(e2){
        e2.setDurationType(type);
        e2.setDuration(duration);
        this.addEffect(e2, type, duration);
      }
      return;
    }

    if(this.isImmuneToEffect(effect)) return;

    // Already on another object (one effect a script applies to several): this one gets its own
    if(effect.applied && effect.object && effect.object !== this){
      effect = effect.clone();
      effect.initialize();
    }

    effect.setAttachedObject(this);
    effect.loadModel();
    effect.onApply(this);
    GameState.hooks.onEffectApplied(this, effect);
    // A heal, hit or resurrection has done its work once applied: kept, it sat on the creature for good, listed
    // as a "Heal" or "Damage" with no source
    if(ModuleObject.ONE_SHOT_EFFECTS.has(effect.type) && effect.getDurationType() == GameEffectDurationType.INSTANT){
      return;
    }
    this.effects.push(effect);
  }

  /**
   * Take an effect off: off the list, its clean-up and models (GameEffect.retire), and the mode told (a GM
   * session's players take it off too). Every way an effect comes off goes through here
   */
  detachEffect(effect: GameEffect){
    const index = this.effects.indexOf(effect);
    if(index < 0) return;
    this.effects.splice(index, 1);
    if(effect.retire()) GameState.hooks.onEffectRemoved(this, effect);
  }

  /** Effects that act once, when applied instantly (other types default to instant and still last) */
  static ONE_SHOT_EFFECTS = new Set<number>([
    GameEffectType.EffectHeal, GameEffectType.EffectDamage, GameEffectType.EffectHealForcePoints,
    GameEffectType.EffectDamageForcePoints, GameEffectType.EffectResurrection, GameEffectType.EffectDeath,
  ]);

  /**
   * Get an effect by type
   * @param type 
   * @returns 
   */
  getEffect(type = -1){
    for(let i = 0; i < this.effects.length; i++){
      if(this.effects[i].type == type){
        return this.effects[i];
      }
    }
    return undefined;
  }

  /**
   * Check if the object has an effect by type
   * @param type 
   * @returns 
   */
  hasEffect(type = -1){
    return this.getEffect(type) ? true : false;
  }

  /**
   * Remove all effects by creator
   * @param oCreator 
   */
  removeEffectsByCreator( oCreator: ModuleObject ){
    if(!(oCreator instanceof ModuleObject)){
      return;
    }
    for(const effect of this.effects.filter((e) => e.getCreator() == oCreator)){
      this.detachEffect(effect);
    }
  }

  /**
   * Remove all effects by type
   * @param type 
   */
  removeEffectsByType(type: number = -1){
    for(const effect of this.effects.filter((e) => e.type == type)){
      this.detachEffect(effect);
    }
  }

  /**
   * Remove an effect by type or GameEffect
   * @param type 
   */
  removeEffect(effect: GameEffect){
    if(!effect){ return; }
    this.detachEffect(effect);
  }

  /**
   * Jump to an EngineLocation
   * @param lLocation 
   */
  JumpToLocation(lLocation: EngineLocation){
    if(lLocation){
      this.position.set( lLocation.position.x, lLocation.position.y, lLocation.position.z );
      this.computeBoundingBox();

      this.setFacing(-Math.atan2(lLocation.rotation.x, lLocation.rotation.y) + Math.PI/2, true);
      this.collisionManager.groundFace = undefined;
      this.collisionManager.lastGroundFace = undefined;
    }
  }

  /**
   * Face a point
   * @param vPoint 
   */
  FacePoint(vPoint=new THREE.Vector3){
    let tangent = vPoint.clone().sub(this.position.clone());
    let atan = Math.atan2(-tangent.y, -tangent.x);
    this.setFacing(atan + Math.PI/2, true);
  }

  /**
   * Get the x orientation
   * @returns 
   */
  getXOrientation(){
    if(this.template.RootNode.hasField('XOrientation')){
      return this.template.RootNode.getFieldByLabel('XOrientation').getValue();
    }
    return 0;
  }

  /**
   * Get the y orientation
   * @returns 
   */
  getYOrientation(){
    if(this.template.RootNode.hasField('XOrientation')){
      return this.template.RootNode.getFieldByLabel('XOrientation').getValue();
    }
    return 0;
  }

  /**
   * Get the z orientation
   * @returns 
   */
  getZOrientation(){
    if(this.template.RootNode.hasField('ZOrientation')){
      return this.template.RootNode.getFieldByLabel('ZOrientation').getValue();
    }
    return 0;
  }

  /**
   * Get the linked to module
   * @returns 
   */
  getLinkedToModule(){
    return this.linkedToModule;
  }

  /**
   * Get the linked to flags
   * @returns 
   */
  getLinkedToFlags(){
    return this.linkedToFlags;
  }

  /**
   * Get the linked to
   * @returns 
   */
  getLinkedTo(){
    return this.linkedTo;
  }

  /**
   * Get the transition destin
   * @returns 
   */
  getTransitionDestin(){
    if(this.transitionDestin instanceof CExoLocString){
      return this.transitionDestin.getValue();
    }
    return '';
  }

  /**
   * Get the portrait id
   * @returns 
   */
  getPortraitId(){
    if(this.template.RootNode.hasField('PortraitId')){
      return this.template.RootNode.getFieldByLabel('PortraitId').getValue();
    }
    return 0;
  }

  /**
   * Get the key name
   * @returns 
   */
  getKeyName(){
    if(this.template.RootNode.hasField('KeyName')){
      return this.template.RootNode.getFieldByLabel('KeyName').getValue();
    }
    return null;
  }

  /**
   * Get the tag
   * @returns 
   */
  getTag(){
    if(this.tag){
      return this.tag
    }
    
    if(this.template && this.template.RootNode && this.template.RootNode.hasField('Tag')){
      return this.template.RootNode.getFieldByLabel('Tag').getValue()
    }

    return '';
  }

  /**
   * Get the template resref
   * @returns 
   */
  getTemplateResRef(){
    if(this.template.RootNode.hasField('TemplateResRef')){
      return this.template.RootNode.getFieldByLabel('TemplateResRef').getValue()
    }
    return null;
  }

  /**
   * Get the resref
   * @returns 
   */
  getResRef(){
    if(this.template.RootNode.hasField('ResRef')){
      return this.template.RootNode.getFieldByLabel('ResRef').getValue()
    }
    return null;
  }

  /**
   * Set the template resref
   * @param sRef 
   */
  setTemplateResRef(sRef=''){
    if(this.template.RootNode.hasField('TemplateResRef')){
      this.template.RootNode.getFieldByLabel('TemplateResRef').setValue(sRef)
    }else{
      this.template.RootNode.addRESREF('TemplateResRef', sRef)
    }
    
  }

  /**
   * Set the HP
   * @param value 
   */
  setHP(value = 0){
    this.currentHP = value;
  }

  /**
   * Add HP
   * @param value 
   * @param ignoreMaxHitPoints 
   */
  addHP(value = 0, ignoreMaxHitPoints = false){
    this.currentHP = (this.getHP() + value);
  }

  /**
   * Subtract HP
   * @param value 
   */
  subtractHP(value = 0){
    this.setHP(this.getHP() - value);
  }

  /**
   * Get the HP
   * @returns 
   */
  getHP(){
    return this.currentHP;
  }

  /**
   * Get the max HP
   * @returns 
   */
  getMaxHP(){
    return this.hp;
  }

  /**
   * Set the max HP
   * @param value 
   */
  setMaxHP(value = 0){
    return this.hp = value;
  }

  /**
   * Set the min one HP
   * @param value 
   */
  setMinOneHP(value: boolean = false){
    this.min1HP = value;
  }

  /**
   * Add FP
   * @param nAmount 
   * @param ignoreMaxForcePoints 
   */
  addFP(nAmount = 0, ignoreMaxForcePoints = false){}

  /**
   * Subtract FP
   * @param nAmount 
   */
  subtractFP(nAmount = 0){}

  /**
   * Get the AC
   * @returns 
   */
  getAC(){
    return 10;
  }

  /**
   * Check if the object is a party member
   * @returns 
   */
  isPartyMember(){
    return this.isPM;//GameState.PartyManager.party.indexOf(this as any) >= 0;
  }

  /**
   * Compute the bounding box
   * @param force 
   */
  computeBoundingBox(force: boolean = false){
    if(this.container){
      this.container.updateMatrixWorld(true);
      this.container.updateMatrix();
      if(force){
        this.container.traverse( n => {
          n.updateMatrixWorld(true);
          n.updateMatrix();
        })
      }
    }

    if(this.model){
      this.model.updateMatrixWorld(true);
      this.model.updateMatrix();
    }
    
    if(this.model instanceof THREE.Object3D)
      this.box.setFromObject(this.model);
  }

  /**
   * Check if the object is on screen
   * @param frustum 
   * @returns 
   */
  isOnScreen(frustum = GameState.viewportFrustum){
    if(this.area && this.area.fog){
      if(this.distanceToCamera >= this.area.fog.far){
        return false;
      }
    }

    this.box.getBoundingSphere(this.sphere);
    return frustum.intersectsSphere(this.sphere);
  }

  /**
   * Get the reticle node
   * @returns 
   */
  getReticleNode(){
    if(!this.model){ return; }

    if(this.model.talkdummy){
      return this.model.talkdummy;
    }
    
    if(this.model.camerahook){
      return this.model.camerahook;
    }
    
    if(this.model.lookathook){
      return this.model.lookathook;
    }
    
    if(this.model.headhook){
      return this.model.headhook;
    }

    return this.model;
  }

  /**
   * Set the listening state
   * @param bListenting 
   */
  setListening(bListenting = false){
    this.isListening = bListenting ? true : false;;
  }

  /**
   * Set the listening pattern
   * @param sString 
   * @param iNum 
   */
  setListeningPattern(sString = '', iNum = 0){
    this.listeningPatterns[sString] = iNum;
  }

  /**
   * Get the listening state
   * @returns 
   */
  getIsListening(){
    return this.isListening ? true : false;
  }

  /**
   * Get the local boolean
   * @param index 
   * @returns 
   */
  getLocalBoolean(index: number){
    return !!this._locals.Booleans[index];
  }

  /**
   * Get the local number
   * @param index 
   * @returns 
   */
  getLocalNumber(index: number){
    return (this._locals.Numbers as any)[index] ? (this._locals.Numbers as any)[index] as number : 0;
  }

  /**
   * Set the local boolean
   * @param index 
   * @param bool 
   */
  setLocalBoolean(index: number, bool: boolean){
    this._locals.Booleans[index] = !!bool;
  }

  /**
   * Set the local number
   * @param index 
   * @param value 
   */
  setLocalNumber(index: number, value: number){
    (this._locals.Numbers as any)[index] = value;
  }

  /**
   * Check if the object is hostile to another object
   * @param target 
   * @returns 
   */
  isHostile(target: ModuleObject){
    return GameState.FactionManager.IsHostile(this, target);
  }

  /**
   * Check if the object is neutral to another object
   * @param target 
   * @returns 
   */
  isNeutral(target: ModuleObject){
    return GameState.FactionManager.IsNeutral(this, target);
  }

  /**
   * Check if the object is friendly to another object
   * @param target 
   * @returns 
   */
  isFriendly(target: ModuleObject){
    return GameState.FactionManager.IsFriendly(this, target);
  }

  /**
   * Get the reputation of the object with another object
   * @param target 
   * @returns 
   */
  getReputation(target: ModuleObject){
    return GameState.FactionManager.GetReputation(this, target);
  }

  /**
   * Get the primary perception range
   * @returns 
   */
  getPerceptionRangePrimary(){
    if(!this.perceptionRange){ return 1; }
    return this.perceptionRange.primaryRange;
  }

  /**
   * Get the secondary perception range
   * @returns 
   */
  getPerceptionRangeSecondary(){
    if(!this.perceptionRange){ return 1; }
    return this.perceptionRange.secondaryRange;
  }

  /**
   * Initialize the perception list
   */
  initPerceptionList(){
    let length = this.perceptionList.length;
    while(length--){
      let perceptionObject = this.perceptionList[length];
      if(perceptionObject){
        if(typeof perceptionObject.object == 'undefined' && perceptionObject.objectId){
          perceptionObject.object = GameState.ModuleObjectManager.GetObjectById(perceptionObject.objectId);
          if(!(perceptionObject.object instanceof ModuleObject)){
            this.perceptionList.splice(length, 1);
          }
        }
      }
    }
  }

  /**
   * Notify the object that it has been heard by another object
   * @param object 
   * @param heard 
   * @returns 
   */
  notifyPerceptionHeardObject(object: ModuleObject, heard = false){
    if(!object) return;

    let triggerOnNotice = false;
    let perceptionObject;
    let exists = this.perceptionList.filter( (o) => o.object == object );
    if(exists.length){
      let existingObject = exists[0];
      triggerOnNotice = (!!(existingObject.data & 0x02) != heard);
      existingObject.data |= 0x02;
      perceptionObject = existingObject;
    }else{
      if(heard){
        let newObject = {
          object: object,
          objectId: object.id,
          data: 0x02
        };
        this.perceptionList.push(newObject);
        perceptionObject = newObject;
        triggerOnNotice = true;
        if(object.isPlayer && this.isHostile(object)){
          this.area.subtractStealthXP();
        }
      }else{
        if(object.isPlayer && this.isHostile(object)){
          this.area.addStealthXP();
        }
      }
    }

    let onNotice: NWScriptInstance;
    if(BitWise.InstanceOfObject(this, ModuleObjectType.ModuleCreature)){
      onNotice = this.scripts[ModuleObjectScript.CreatureOnNotice];
    }

    if(triggerOnNotice && onNotice && this.runsScript(ModuleObjectScript.CreatureOnNotice)){
      const instance = onNotice.nwscript.newInstance();
      (this as any).lastPerceived = perceptionObject; instance.lastPerceived = perceptionObject;
      instance.run(this);
      return true;
    }
  }

  /**
   * Notify the object that it has been seen by another object
   * @param object 
   * @param seen 
   * @returns 
   */
  notifyPerceptionSeenObject(object: ModuleObject, seen = false){
    if(!object) return;

    let triggerOnNotice = false;
    let perceptionObject;
    let exists = this.perceptionList.filter( (o) => o.object == object );
    if(exists.length){
      let existingObject = exists[0];
      triggerOnNotice = (!!(existingObject.data & 0x01) != seen);
      perceptionObject = existingObject;
    }else{
      if(seen){
        let newObject = {
          object: object,
          objectId: object.id,
          data: 0x01
        };
        this.perceptionList.push(newObject);
        perceptionObject = newObject;
        triggerOnNotice = true;
        if(object.isPlayer && this.isHostile(object)){
          this.area.subtractStealthXP();
        }
      }else{
        if(object.isPlayer && this.isHostile(object)){
          this.area.addStealthXP();
        }
      }
    }

    let onNotice: NWScriptInstance;
    if(BitWise.InstanceOfObject(this, ModuleObjectType.ModuleCreature)){
      onNotice = this.scripts[ModuleObjectScript.CreatureOnNotice];
    }

    if(triggerOnNotice && onNotice && this.runsScript(ModuleObjectScript.CreatureOnNotice)){
      const instance = onNotice.nwscript.newInstance();
      (this as any).lastPerceived = perceptionObject; instance.lastPerceived = perceptionObject;
      instance.run(this);
      return true;
    }
  }

  #tmpPositionA = new THREE.Vector3();
  #tmpPositionB = new THREE.Vector3();
  #tmpDirection = new THREE.Vector3();

  /**
   * Check if the object has line of sight to another object
   * @param oTarget 
   * @param max_distance 
   * @returns 
   */
  hasLineOfSight(oTarget: ModuleObject, max_distance = 30){
    if(!this.spawned || !GameState.module.readyToProcessEvents)
      return false;
    
    if(!(oTarget instanceof ModuleObject)){
      return false;
    }

    this.#tmpPositionA.copy(this.position);
    this.#tmpPositionB.copy(oTarget.position);
    this.#tmpPositionA.z += 1;
    this.#tmpPositionB.z += 1;
    const distance = this.#tmpPositionA.distanceTo(this.#tmpPositionB);

    if(this.perceptionRange){
      const primaryRange = this.getPerceptionRangePrimary();
      if(distance > primaryRange){
        return false;
      }
      max_distance = primaryRange;
    }else{
      if(distance > max_distance){
        return false;
      }
    }

    this.#tmpDirection.copy(this.#tmpPositionB).sub(this.#tmpPositionA).normalize();
    GameState.raycaster.ray.origin.copy(this.#tmpPositionA);
    GameState.raycaster.ray.direction.copy(this.#tmpDirection);
    GameState.raycaster.far = distance;

    for(let j = 0, jl = this.area.doors.length; j < jl; j++){
      const door = this.area.doors[j];
      if(!door || door == (this as any) || door.isOpen()) continue;
      const box3 = door.box;
      if(!box3) continue;
      if(GameState.raycaster.ray.intersectsBox(box3) || box3.containsPoint(this.#tmpPositionA)){
        const intersects = door.collisionManager.walkmesh.raycast(GameState.raycaster, door.collisionManager.walkmesh.faces);
        if(intersects){
          for(let k = 0; k < intersects.length; k++){
            if(intersects[k].distance < distance){
              return false;
            }
          }
        }
      }
    }

    if(!this.room) return true;

    //Check the current room walkmesh
    if(this.room && this.room.collisionManager.walkmesh && this.room.collisionManager.walkmesh.aabbNodes.length){
      const intersects = this.room.collisionManager.walkmesh.raycast(GameState.raycaster, this.room.collisionManager.walkmesh.faces);
      if(intersects){
        for(let k = 0; k < intersects.length; k++){
          if(intersects[k].distance < distance){
            return false;
          }
        }
      }
    }

    //Check the linked rooms walkmeshes
    const linkedRooms = this.room.linkedRoomsArray;
    for(let j = 0, jl = linkedRooms.length; j < jl; j++){
      const room = linkedRooms[j];
      if(!room || !room.collisionManager.walkmesh || !room.collisionManager.walkmesh.aabbNodes.length) continue;
      const intersects = room.collisionManager.walkmesh.raycast(GameState.raycaster, room.collisionManager.walkmesh.faces);
      if(intersects){
        for(let k = 0; k < intersects.length; k++){
          if(intersects[k].distance < distance){
            return false;
          }
        }
      }
    }

    return true;
  }
  
  /**
   * Set the animation state
   * @param animState 
   */
  setAnimationState(animState: any){
    this.animState = animState;
  }

  /**
   * Play an animation
   * @param anim 
   */
  dialogPlayAnimation(anim: ITwoDAAnimation = {} as ITwoDAAnimation){
    console.log('dialogPlayAnimation',anim);
    if(!this.model){ 
      console.warn('dialogPlayAnimation failed');
      console.log(this, anim);
      return; 
    }

    const odysseyAnimation = this.model.odysseyAnimations.find( (a) => a.name.toLocaleLowerCase() == anim.name.toLocaleLowerCase() );
    if(!odysseyAnimation){
      return;
    }

    this.dialogAnimation = {
      animation: odysseyAnimation,
      data: anim,
      started: false,
    };
  }

  /**
   * Reset the dialog animation state
   */
  dialogResetAnimationState(){
    this.dialogAnimationState = {
      animationIndex: -1,
      animation: undefined,
      data: undefined,
      started: false,
    };
  }

  /**
   * Use an object
   * @param object 
   */
  use(object: ModuleObject){
    console.warn("Method not implemented.", this.tag);
  }

  /**
   * Attack a creature
   * @param target 
   * @param feat 
   * @param isCutsceneAttack 
   * @param attackDamage 
   * @param attackAnimation 
   * @param attackResult 
   */
  attackCreature(target: ModuleObject, feat?: any, isCutsceneAttack: boolean = false, attackDamage:number = 0, attackAnimation?: any, attackResult?: any) {
    console.warn("Method not implemented.", this.tag, target);
  }
  /**
   * Set the commandable state
   * @param arg0 
   */
  setCommandable(arg0: boolean) {
    console.warn("Method not implemented.", this.tag);
  }

  /**
   * Play a sound set
   * @param ssfType 
   */
  playSoundSet(ssfType: SSFType){
    console.warn("Method not implemented.", this.tag);
  }
  
  /**
   * Initialize the properties
   */
  /**
   * Read the fields every object type keeps: tag, template resref, position and orientation.
   * A field the template doesn't have leaves the current value.
   */
  initCommonProperties(){
    this.tag = this.template.RootNode.get('Tag', this.tag);
    this.templateResRef = this.template.RootNode.get('TemplateResRef', this.templateResRef);
    this.position.x = this.template.RootNode.get('XPosition', this.position.x);
    this.position.y = this.template.RootNode.get('YPosition', this.position.y);
    this.position.z = this.template.RootNode.get('ZPosition', this.position.z);
    this.xOrientation = this.template.RootNode.get('XOrientation', this.xOrientation);
    this.yOrientation = this.template.RootNode.get('YOrientation', this.yOrientation);
    this.zOrientation = this.template.RootNode.get('ZOrientation', this.zOrientation);
  }

  initProperties(){

    if(!this.initialized){
      if(this.template.RootNode.hasField('ObjectId')){
        this.id = this.template.getFieldByLabel('ObjectId').getValue();
      }else if(this.template.RootNode.hasField('ID')){
        this.id = this.template.getFieldByLabel('ID').getValue();
      }
      
      GameState.ModuleObjectManager.AddObjectById(this);
    }
    
    this.animState = this.template.RootNode.get('Animation', this.animState);
    
    this.appearance = this.template.RootNode.get('Appearance', this.appearance);
    
    if(this.template.RootNode.hasField('Description'))
      this.description = this.template.getFieldByLabel('Description').getCExoLocString();
    
    this.id = this.template.RootNode.get('ObjectId', this.id);

    this.autoRemoveKey = this.template.RootNode.get('AutoRemoveKey', this.autoRemoveKey);

    this.commandable = this.template.RootNode.get('Commandable', this.commandable);

    this.cursor = this.template.RootNode.get('Cursor', this.cursor);

    if(this.template.RootNode.hasField('Faction')){
      this.factionId = this.template.getFieldByLabel('Faction').getValue();
      if((this.factionId & 0xFFFFFFFF) == -1){
        this.factionId = 0;
      }
      this.faction = GameState.FactionManager.factions.get(this.factionId);
    }

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

    this.hasMapNote = this.template.RootNode.get('HasMapNote', this.hasMapNote);

    this.highlightHeight = this.template.RootNode.get('HighlightHeight', this.highlightHeight);

    this.keyName = this.template.RootNode.get('KeyName', this.keyName);

    this.linkedTo = this.template.RootNode.get('LinkedTo', this.linkedTo);

    this.linkedToFlags = this.template.RootNode.get('LinkedToFlags', this.linkedToFlags);
  
    this.linkedToModule = this.template.RootNode.get('LinkedToModule', this.linkedToModule);
        
    this.loadScreenID = this.template.RootNode.get('LoadScreenID', this.loadScreenID);

    if(this.template.RootNode.hasField('LocName'))
      this.locName = this.template.getFieldByLabel('LocName').getCExoLocString();

    if(this.template.RootNode.hasField('LocalizedName'))
      this.localizedName = this.template.getFieldByLabel('LocalizedName').getCExoLocString();

    if(this.template.RootNode.hasField('MapNote'))
      this.mapNote = this.template.getFieldByLabel('MapNote').getCExoLocString();

    this.mapNoteEnabled = this.template.RootNode.get('MapNoteEnabled', this.mapNoteEnabled);

    if(this.template.RootNode.hasField('PortraidId')){
      this.portraitId = this.template.getFieldByLabel('PortraidId').getValue();
      this.portrait = GameState.SWRuleSet.portraits[this.portraitId];
    }

    this.setByPlayerParty = this.template.RootNode.get('SetByPlayerParty', this.setByPlayerParty);

    this.initCommonProperties();

    if(this.template.RootNode.hasField('TransitionDestin'))
      this.transitionDestin = this.template.getFieldByLabel('TransitionDestin').getCExoLocString();

    this.trapDetectable = this.template.RootNode.get('TrapDetectable', this.trapDetectable);

    this.trapDisarmable = this.template.RootNode.get('TrapDisarmable', this.trapDisarmable);

    this.trapOneShot = this.template.RootNode.get('TrapOneShot', this.trapOneShot);

    this.trapType = this.template.RootNode.get('TrapType', this.trapType);

    this.type = this.template.RootNode.get('Type', this.type);

    this.fortitudeSaveThrow = this.template.RootNode.get('FortSaveThrow', this.fortitudeSaveThrow);

    this.reflexSaveThrow = this.template.RootNode.get('RefSaveThrow', this.reflexSaveThrow);

    this.willSaveThrow = this.template.RootNode.get('WillSaveThrow', this.willSaveThrow);

    if(this.template.RootNode.hasField('SWVarTable')){
      let swVarTableStruct = this.template.RootNode.getFieldByLabel('SWVarTable').getChildStructs()[0];
      if(swVarTableStruct){
        if(swVarTableStruct.hasField('BitArray')){
          let localBools = swVarTableStruct.getFieldByLabel('BitArray').getChildStructs();
          for(let i = 0; i < localBools.length; i++){
            let data = localBools[i].getFieldByLabel('Variable').getValue();
            for(let bit = 0; bit < 32; bit++){
              this._locals.Booleans[bit + (i*32)] = ( (data>>bit) % 2 != 0);
            }
          }
        }

        if(swVarTableStruct.hasField('ByteArray')){
          let localNumbers = swVarTableStruct.getFieldByLabel('ByteArray').getChildStructs();
          for(let i = 0; i < localNumbers.length; i++){
            let data = localNumbers[i].getFieldByLabel('Variable').getValue();
            this.setLocalNumber(i, data);
          }
        }
      }
    }

    this.initialized = true;

  }

  /**
   * Save the object
   */
  Save(){
    //TODO

    let gff = new GFFObject();

    return gff;

  }

  /**
   * Get the SWVarTable save struct
   * @returns 
   */
  getSWVarTableSaveStruct(){
    let swVarTableStruct = new GFFStruct();

    let swVarTableBitArray = swVarTableStruct.addField( new GFFField(GFFDataType.LIST, 'BitArray') );

    for(let i = 0; i < 3; i++){
      let varStruct = new GFFStruct();
      let value = 0;
      let offset = 32 * i;
      for(let j = 0; j < 32; j++){
        if(this.getLocalBoolean(offset + j) == true){
          value |= 1 << j;
        }
      }
      value = value >>> 0;
      varStruct.addDWord('Variable',  value );
      swVarTableBitArray.addChildStruct(varStruct);
    }

    let swVarTableByteArray = swVarTableStruct.addField( new GFFField(GFFDataType.LIST, 'ByteArray') );

    for(let i = 0; i < 8; i++){
      let varStruct = new GFFStruct();
      varStruct.addByte('Variable',  Number(this.getLocalNumber(i)) );
      swVarTableByteArray.addChildStruct(varStruct);
    }
    return swVarTableStruct;
  }

  /**
   * Convert the action queue to an action list
   * @returns 
   */
  actionQueueToActionList(){
    const actionList = new GFFField(GFFDataType.LIST, 'ActionList');

    for(let i = 0, len = this.actionQueue.length; i < len; i++){
      const action = this.actionQueue[i] as Action;
      if(!action){ continue; }
      const struct = new GFFStruct(0);
      struct.addField(new GFFField(GFFDataType.DWORD, 'ActionId', action.type));
      struct.addField(new GFFField(GFFDataType.WORD, 'GroupActionId', action.groupId));
      struct.addField(new GFFField(GFFDataType.WORD, 'NumParams', action.parameters.length));

      const params = struct.addField(new GFFField(GFFDataType.LIST, 'Paramaters'));
      for(let j = 0, len2 = action.parameters.length; j < len2; j++){
        params.addChildStruct(action.parameters[j].toStruct());
      }

      actionList.addChildStruct(struct);
    }

    return actionList;
  }

  setOpacity(opacity: number){
    if(this.model instanceof OdysseyModel3D){
      this.model.setOpacity(opacity);
    }
  }

  /**
   * Destroyed
   */
  destroyed: boolean = false;

  /**
   * Will destroy
   */
  willDestroy: boolean = false;

  /**
   * Time since destroy started in seconds
   */
  timeSinceDestroyStarted: number = 0;

  /**
   * Delay until destroy in seconds
   */
  delayUntilDestroy: number = 0;

  /**
   * Delay until fade in seconds
   */
  delayUntilFade: number = 0;

  /**
   * No fade on destroy
   */
  noFadeOnDestroy: boolean = false;

  static FADE_TIME: number = 10.0;

  setWillDestroy(willDestroy: boolean){
    this.willDestroy = willDestroy;
    this.timeSinceDestroyStarted = 0;
  }

  setDelayUntilDestroy(delay: number = ModuleObject.FADE_TIME){
    this.delayUntilDestroy = delay;
    this.timeSinceDestroyStarted = 0;
  }

  setDelayUntilFade(delay: number){
    if(BitWise.InstanceOfObject(this, ModuleObjectType.ModuleCreature) || BitWise.InstanceOfObject(this, ModuleObjectType.ModulePlaceable)){
      this.delayUntilFade = delay;
      return;
    }
    this.delayUntilFade = 0;
  }

  setNoFadeOnDestroy(noFade: boolean){
    if(BitWise.InstanceOfObject(this, ModuleObjectType.ModuleCreature) || BitWise.InstanceOfObject(this, ModuleObjectType.ModulePlaceable)){
      this.noFadeOnDestroy = noFade;
      return;
    }
    this.noFadeOnDestroy = false;
  }

  /**
   * Destroy the object
   */
  destroy(){
    this.destroyed = true;
    try{ console.log('destroy', this.getTag(), this);}catch(e: any){}
    try{
      this.container.removeFromParent();

      if(this.model instanceof OdysseyModel3D){
        this.model.removeFromParent();
        this.model.dispose();
        this.model = undefined;
      }

      if(this.mesh instanceof THREE.Mesh){
        this.mesh.removeFromParent();

        (this.mesh.material as THREE.Material).dispose();
        this.mesh.geometry.dispose();

        this.mesh.material = undefined;
        this.mesh.geometry = undefined;
        this.mesh = undefined;
      }

      //cleanup audio emitter
      if(this.audioEmitter){
        this.audioEmitter.destroy();
        this.audioEmitter = undefined;
      }

      if(this.footstepEmitter){
        this.footstepEmitter.destroy();
        this.footstepEmitter = undefined;
      }

      // Dispose all game effects
      if(this.effects && this.effects.length > 0){
        // The object is going: its effects' models go with it (nobody needs telling, the object itself goes)
        for(let i = this.effects.length - 1; i >= 0; i--){
          this.effects[i]?.retire();
        }
        this.effects.length = 0;
      }

      //Cleanup scripts
      Object.keys(this.scripts).forEach( (key) => {
        if(this.scripts[key] instanceof NWScriptInstance){
          this.scripts[key].dispose();
        }
        this.scripts = {};
      });

      //Clear action queue
      if(this.actionQueue){
        this.actionQueue.clear();
        this.actionQueue = undefined;
      }

      //Clear computed path
      if(this.#computedPath){
        this.#computedPath.dispose();
        this.#computedPath = undefined;
      }

      //Clear perception list
      if(this.perceptionList){
        this.perceptionList.length = 0;
      }

      //Clear inventory
      if(this.inventory){
        for(let i = this.inventory.length - 1; i >= 0; i--){
          if(this.inventory[i]){
            this.inventory[i].destroy();
          }
        }
        this.inventory.length = 0;
      }

      //Clear rooms array
      if(this.rooms){
        this.rooms.length = 0;
      }

      //Clear objects inside
      if(this.objectsInside){
        this.objectsInside.length = 0;
      }

      //Dispose Three.js utility objects
      if(this.forceVector){
        this.forceVector = undefined;
      }
      // if(this.position){
      //   this.position = undefined;
      // }
      // if(this.rotation){
      //   this.rotation = undefined;
      // }
      // if(this.quaternion){
      //   this.quaternion = undefined;
      // }
      if(this.box){
        this.box = undefined;
      }
      if(this.sphere){
        this.sphere = undefined;
      }
      if(this.v20){
        this.v20 = undefined;
      }
      if(this.v21){
        this.v21 = undefined;
      }

      if(this.area){
        this.area.detachObject(this);
      }else if (GameState.module.area){
        GameState.module.area.detachObject(this);
      }

      //Clear references to prevent circular references
      this.area = undefined;
      this.room = undefined;
      this.lookAtObject = undefined;
      this.lastTriggerEntered = undefined;
      this.lastTriggerExited = undefined;
      this.lastAreaEntered = undefined;
      this.lastAreaExited = undefined;
      this.lastModuleEntered = undefined;
      this.lastModuleExited = undefined;
      this.lastDoorEntered = undefined;
      this.lastDoorExited = undefined;
      this.lastPlaceableEntered = undefined;
      this.lastPlaceableExited = undefined;
      this.lastAoeEntered = undefined;
      this.lastAoeExited = undefined;
      this.conversation = undefined;
      this.linkedToObject = undefined;

      GameState.ModuleObjectManager.RemoveObject(this); 
    }catch(e){
      console.error('ModuleObject.destroy', e);
    }
  }

}

// GM mode's per-object state (GMObjectState): typed fields, unset outside GM sessions
export interface ModuleObject extends GMObjectState {}
