import * as THREE from "three";
import { GFFDataType } from "@/enums/resource/GFFDataType";
import { GameState } from "@/GameState";
import { NWScript } from "@/nwscript/NWScript";
import { NWScriptInstance } from "@/nwscript/NWScriptInstance";
import { GFFField } from "@/resource/GFFField";
import { GFFObject } from "@/resource/GFFObject";
import { GFFStruct } from "@/resource/GFFStruct";
import { ResourceTypes } from "@/resource/ResourceTypes";
import { OdysseyFace3 } from "@/three/odyssey";
import { ConfigClient } from "@/utility/ConfigClient";
import { ResourceLoader } from "@/loaders";
// import { ModuleObjectManager, PartyManager, FactionManager } from "@/managers";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { ModuleObject } from "@/module/ModuleObject";
import { EncounterCreatureEntry } from "@/module/EncounterCreatureEntry";
import { EncounterSpawnPointEntry } from "@/module/EncounterSpawnPointEntry";
import { EncounterSpawnEntry } from "@/module/EncounterSpawnEntry";
import { ModuleObjectScript } from "@/enums/module/ModuleObjectScript";

/**
* ModuleEncounter class.
* 
* Class representing an encounter found in module areas.
* 
* KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
* 
* @file ModuleEncounter.ts
* @author KobaltBlu <https://github.com/KobaltBlu>
* @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
* @memberof KotOR
*/
export class ModuleEncounter extends ModuleObject {
  creatureList: EncounterCreatureEntry[];
  spawnPointList: EncounterSpawnPointEntry[];
  spawnList: EncounterSpawnEntry[];
  active: number;
  difficulty: number;
  difficultyIndex: number;
  maxCreatures: number;
  playerOnly: number;
  recCreatures: number;
  reset: number;
  resetTime: number;
  spawnOption: number;
  started: number;
  objectsInsideIdx: number;
  lastObjectEntered: any;
  lastObjectExited: any;
  triggered: boolean;
  areaPoints: any;
  paletteId: any;
  respawns: any;
  numberSpawned: any;
  heartbeatDay: any;
  heartbeatTime: any;
  lastSpawnDay: any;
  lastSpawnTime: any;
  lastEntered: any;
  lastLeft: any;
  exhausted: any;
  currentSpawns: any;
  customScriptId: any;
  areaListMaxSize: any;
  spawnPoolActive: any;

  constructor ( gff = new GFFObject() ) {
    super(gff);
    this.objectType |= ModuleObjectType.ModuleEncounter;
    this.template = gff;
    this.vertices = []; 

    this.creatureList = [];

    this.spawnPointList = [];  

    this.spawnList = [];

    this.active = 1; //0: Inactive | 1: Active
    this.difficulty = 1; //OBSOLETE FIELD; Should always be identical to the VALUE in encdifficulty.2da pointed to by the DifficultyIndex Field.
    this.difficultyIndex = 1; //Index into encdifficulty.2da
    // this.faction = 0; //Faction ID; Only spawn when entered by creatures hostile to this faction
    this.localizedName = undefined;
    this.maxCreatures = 1; //Maximum number of creatures this encounter can spawn; 1-8
    this.playerOnly = 0; //0: Any Creature | 1: Only Player ; Can Trigger
    this.recCreatures = 1; //Recommneded number of creatures; 1-8
    this.reset = 0; //0: No Respawn | 1: Respawn
    this.resetTime = 32000; //Seconds before encounter respawns
    this.spawnOption = 0; //0: Continuous Spawn | 1: Single-Shot Spawn
    this.started = 0; //0: if there are no creatures currently belonging to the encounter. | 1: if any creatures currently exist that belong to the encounter.

    this.scripts = {
      onEntered: undefined,
      onExhausted: undefined,
      onExit: undefined,
      onHeartbeat: undefined,
      onUserDefined: undefined
    };

    this.objectsInside = [];
    this.objectsInsideIdx = 0;
    this.lastObjectEntered = null;
    this.lastObjectExited = null;

  }

  update(delta = 0){
    
    super.update(delta);
    
    this.getCurrentRoom();
    
    //Check Module Creatures
    let creatureLen = GameState.module.area.creatures.length;
    for(let i = 0; i < creatureLen; i++){
      let creature = GameState.module.area.creatures[i];
      let pos = creature.position.clone();
      if(this.box.containsPoint(pos)){
        if(this.objectsInside.indexOf(creature) == -1){
          this.objectsInside.push(creature);
          if(this.isHostile(creature)){
            creature.lastTriggerEntered = this;
            this.lastObjectEntered = creature;

            this.onEnter(creature);
            this.triggered = true;
          }
        }
      }else{
        if(this.objectsInside.indexOf(creature) >= 0){
          this.objectsInside.splice(this.objectsInside.indexOf(creature), 1);
          if(this.isHostile(creature)){
            creature.lastTriggerExited = this;
            this.lastObjectExited = creature;
            this.onExit(creature);
          }
        }
      }
    }

    //Check Party Members
    let partyLen = GameState.PartyManager.party.length;
    for(let i = 0; i < partyLen; i++){
      let partymember = GameState.PartyManager.party[i];
      let pos = partymember.position.clone();
      
      if(this.box.containsPoint(pos)){
        if(this.objectsInside.indexOf(partymember) == -1){
          this.objectsInside.push(partymember);
          if(this.isHostile(partymember)){
            partymember.lastTriggerEntered = this;
            this.lastObjectEntered = partymember;

            this.onEnter(partymember);
            this.triggered = true;
          }
        }
      }else{
        if(this.objectsInside.indexOf(partymember) >= 0){
          this.objectsInside.splice(this.objectsInside.indexOf(partymember), 1);
          if(this.isHostile(partymember)){
            partymember.lastTriggerExited = this;
            this.lastObjectExited = partymember;

            this.onExit(partymember);
          }
        }
      }
    }

    this.mesh.visible = ConfigClient.get('Game.debug.trigger_geometry_show') ? true : false;

  }

  onEnter(object: ModuleObject){
    const nwscript = this.scripts[ModuleObjectScript.EncounterOnEntered];
    if(!nwscript){ return; }
    const instance = nwscript.newInstance();
    instance.enteringObject = object;
    instance.run(this, 0);
  }

  onExit(object: ModuleObject){
    const nwscript = this.scripts[ModuleObjectScript.EncounterOnExit];
    if(!nwscript){ return; }
    const instance = nwscript.newInstance();
    instance.exitingObject = object;
    instance.run(this, 0);
  }

  load(){
    this.mergeTemplate(ResourceTypes['ute']);
    this.initProperties();
    this.loadScripts();
    try{ this.buildGeometry(); }catch(e){console.error(e)}
  }

  buildGeometry(){
    let trigGeom = this.getGeometry();

    let material = new THREE.MeshBasicMaterial({
      color: new THREE.Color( 0xFFFFFF ),
      side: THREE.DoubleSide
    });

    this.mesh = new THREE.Mesh( trigGeom, material );
    this.mesh.position.copy(this.position);
    this.box.setFromObject(this.mesh);
    this.box.min.z -= 100;
    this.box.max.z += 100;

    this.mesh.userData.moduleObject = this;
    this.mesh.visible = false;
    GameState.group.triggers.add(this.mesh);
  }

  getGeometry(){
    let trigGeom = new THREE.BufferGeometry();
    let vertices = this.vertices.slice();
    let faces: any[] = [];

    try{
      let holes: any = [];
      let triangles = THREE.ShapeUtils.triangulateShape ( vertices, holes );
      for( let i = 0; i < triangles.length; i++ ){
        faces.push( new OdysseyFace3( triangles[i][0], triangles[i][1], triangles[i][2] ));
      }
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

  static SCRIPT_KEYS: ModuleObjectScript[] = [
    ModuleObjectScript.EncounterOnEntered,
    ModuleObjectScript.EncounterOnExhausted,
    ModuleObjectScript.EncounterOnExit,
    ModuleObjectScript.EncounterOnHeartbeat,
    ModuleObjectScript.EncounterOnUserDefined,
  ];

  initProperties(){
    
    if(!this.initialized){
      if(this.template.RootNode.hasField('ObjectId')){
        this.id = this.template.getFieldByLabel('ObjectId').getValue();
      }else if(this.template.RootNode.hasField('ID')){
        this.id = this.template.getFieldByLabel('ID').getValue();
      }
      
      GameState.ModuleObjectManager.AddObjectById(this);

      if(this.template.RootNode.hasField('Geometry')){
        this.geometry = this.template.getFieldByLabel('Geometry').getChildStructs();

        //Push verticies
        for(let i = 0; i < this.geometry.length; i++){
          let tgv = this.geometry[i];
          this.vertices[i] = new THREE.Vector3( 
            tgv.getFieldByLabel('X').getValue(),
            tgv.getFieldByLabel('Y').getValue(),
            tgv.getFieldByLabel('Z').getValue()
          );
        }
      }

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

      if(this.template.RootNode.hasField('CreatureList')){
        let creatures = this.template.RootNode.getFieldByLabel('CreatureList').getChildStructs();
        let entry = undefined;
        for(let i = 0, len = creatures.length; i < len; i++){
          entry = EncounterCreatureEntry.FromStruct(creatures[i]);
          if(entry instanceof EncounterCreatureEntry){
            this.creatureList.push(entry);
          }
        }
      }

      if(this.template.RootNode.hasField('SpawnPointList')){
        let spawnPoints = this.template.RootNode.getFieldByLabel('SpawnPointList').getChildStructs();
        let entry = undefined;
        for(let i = 0, len = spawnPoints.length; i < len; i++){
          entry = EncounterSpawnPointEntry.FromStruct(spawnPoints[i]);
          if(entry instanceof EncounterSpawnPointEntry){
            this.spawnPointList.push(entry);
          }
        }
      }

      if(this.template.RootNode.hasField('SpawnList')){
        let spawns = this.template.RootNode.getFieldByLabel('SpawnList').getChildStructs();
        let entry = undefined;
        for(let i = 0, len = spawns.length; i < len; i++){
          entry = EncounterSpawnEntry.FromStruct(spawns[i]);
          if(entry instanceof EncounterSpawnEntry){
            this.spawnList.push(entry);
          }
        }
      }

      this.active = this.template.RootNode.get('Active', this.active);

      this.areaPoints = this.template.RootNode.get('AreaPoints', this.areaPoints);

      this.difficulty = this.template.RootNode.get('Difficulty', this.difficulty);

      this.difficultyIndex = this.template.RootNode.get('DifficultyIndex', this.difficultyIndex);

      if(this.template.RootNode.hasField('Faction')){
        this.factionId = this.template.getFieldByLabel('Faction').getValue();
        if((this.factionId & 0xFFFFFFFF) == -1){
          this.factionId = 0;
        }
      }
      this.faction = GameState.FactionManager.factions.get(this.factionId);

      this.localizedName = this.template.RootNode.get('LocalizedName', this.localizedName);

      this.maxCreatures = this.template.RootNode.get('MaxCreatures', this.maxCreatures);

      this.paletteId = this.template.RootNode.get('PaletteID', this.paletteId);

      this.playerOnly = this.template.RootNode.get('PlayerOnly', this.playerOnly);

      this.recCreatures = this.template.RootNode.get('RecCreatures', this.recCreatures);

      this.reset = this.template.RootNode.get('Reset', this.reset);

      this.resetTime = this.template.RootNode.get('ResetTime', this.resetTime);

      this.respawns = this.template.RootNode.get('Respawns', this.respawns);

      this.spawnOption = this.template.RootNode.get('SpawnOption', this.spawnOption);

      this.initCommonProperties();

      this.commandable = this.template.RootNode.get('Commandable', this.commandable);

      this.numberSpawned = this.template.RootNode.get('NumberSpawned', this.numberSpawned);

      this.heartbeatDay = this.template.RootNode.get('HeartbeatDay', this.heartbeatDay);

      this.heartbeatTime = this.template.RootNode.get('HeartbeatTime', this.heartbeatTime);

      this.lastSpawnDay = this.template.RootNode.get('LastSpawnDay', this.lastSpawnDay);

      this.lastSpawnTime = this.template.RootNode.get('LastSpawnTime', this.lastSpawnTime);

      this.lastEntered = this.template.RootNode.get('LastEntered', this.lastEntered);

      this.lastLeft = this.template.RootNode.get('LastLeft', this.lastLeft);

      this.started = this.template.RootNode.get('Started', this.started);

      this.exhausted = this.template.RootNode.get('Exhausted', this.exhausted);
        
      this.currentSpawns = this.template.RootNode.get('CurrentSpawns', this.currentSpawns);
    
      this.customScriptId = this.template.RootNode.get('CustomScriptId', this.customScriptId);

      this.areaListMaxSize = this.template.RootNode.get('AreaListMaxSize', this.areaListMaxSize);

      this.spawnPoolActive = this.template.RootNode.get('SpawnPoolActive', this.spawnPoolActive);

      this.initialized = true;
    }

  }

  destroy(): void {
    super.destroy();
  }

  save(){
    let gff = new GFFObject();
    gff.FileType = 'UTE ';

    let actionList = gff.RootNode.addField( this.actionQueueToActionList() );
    gff.RootNode.addByte('Commandable', this.commandable);
    gff.RootNode.addByte('Active', this.active);
    gff.RootNode.addByte('Reset',  this.reset );
    gff.RootNode.addInt('ResetTime', this.resetTime);
    gff.RootNode.addInt('Respawns', this.respawns);
    gff.RootNode.addInt('SpawnOption', this.spawnOption);
    gff.RootNode.addInt('MaxCreatures', this.maxCreatures);
    gff.RootNode.addInt('RecCreatures', this.recCreatures);
    gff.RootNode.addByte('PlayerOnly',  this.playerOnly );
    gff.RootNode.addDWord('Faction',  this.faction ? this.faction.id : this.factionId );
    gff.RootNode.addInt('DifficultyIndex',  this.difficultyIndex );
    gff.RootNode.addInt('Difficulty',  this.difficulty );
    gff.RootNode.addField( new GFFField(GFFDataType.CEXOLOCSTRING, 'LocalizedName') ).setValue(this.localizedName);
    gff.RootNode.addCExoString('Tag', this.tag);

    gff.RootNode.addInt('NumberSpawned', this.numberSpawned);
    gff.RootNode.addDWord('HeartbeatDay', this.heartbeatDay);
    gff.RootNode.addDWord('HeartbeatTime', this.heartbeatTime);
    gff.RootNode.addDWord('LastSpawnDay', this.lastSpawnDay);
    gff.RootNode.addDWord('LastSpawnTime', this.lastSpawnTime);
    gff.RootNode.addByte('Started', this.started);
    gff.RootNode.addByte('Exhausted', this.exhausted);
    gff.RootNode.addInt('CurrentSpawns', this.currentSpawns);
    gff.RootNode.addFloat('SpawnPoolActive', this.spawnPoolActive);
    gff.RootNode.addDWord('LastEntered', this.lastEntered);
    gff.RootNode.addDWord('LastLeft', this.lastLeft);
    gff.RootNode.addInt('CustomScriptId', this.customScriptId);
    gff.RootNode.addInt('AreaListMaxSize', this.areaListMaxSize);
    gff.RootNode.addFloat('AreaPoints', this.areaPoints);

    let creatureList = gff.RootNode.addField( new GFFField(GFFDataType.LIST, 'CreatureList') );
    let creature = undefined;
    for(let i = 0; i < this.creatureList.length; i++){
      creature = this.creatureList[i].save();
      if(creature)
        creatureList.addChildStruct( creature );
    }

    let spawnPointList = gff.RootNode.addField( new GFFField(GFFDataType.LIST, 'SpawnPointList') );
    let spawnPoint = undefined;
    for(let i = 0; i < this.spawnPointList.length; i++){
      spawnPoint = this.spawnPointList[i].save();
      if(spawnPoint)
        spawnPointList.addChildStruct( spawnPoint );
    }

    if(this.spawnList.length){
      let spawnList = gff.RootNode.addField( new GFFField(GFFDataType.LIST, 'SpawnList') );
      let spawn = undefined;
      for(let i = 0; i < this.spawnList.length; i++){
        spawn = this.spawnList[i].save();
        if(spawn)
          spawnList.addChildStruct( spawn );
      }
    }

    let geometry = gff.RootNode.addField( new GFFField(GFFDataType.LIST, 'Geometry') );
    for(let i = 0; i < this.vertices.length; i++){
      let vertStruct = new GFFStruct();
      vertStruct.addFloat('X', this.vertices[i].x);
      vertStruct.addFloat('Y', this.vertices[i].y);
      vertStruct.addFloat('Z', this.vertices[i].z);
      geometry.addChildStruct(vertStruct);
    }

    //SWVarTable
    let swVarTable = gff.RootNode.addField( new GFFField(GFFDataType.STRUCT, 'SWVarTable') );
    swVarTable.addChildStruct( this.getSWVarTableSaveStruct() );

    //Scripts
    this.saveScripts(gff.RootNode);

    gff.RootNode.addField( new GFFField(GFFDataType.LIST, 'VarTable') );
    gff.RootNode.addFloat('XPosition', this.position.x);
    gff.RootNode.addFloat('YPosition', this.position.y);
    gff.RootNode.addFloat('ZPosition', this.position.z);

    this.template = gff;
    return gff;
  }

}
