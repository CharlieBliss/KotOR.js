import { ModuleObject } from "@/module/ModuleObject";
import { AudioEmitter } from "@/audio/AudioEmitter";
import { AudioEngine } from "@/audio/AudioEngine";
import { GFFDataType } from "@/enums/resource/GFFDataType";
import { GFFField } from "@/resource/GFFField";
import { GFFObject } from "@/resource/GFFObject";
import { GFFStruct } from "@/resource/GFFStruct";
import { MDLLoader, ResourceLoader } from "@/loaders";
import { ResourceTypes } from "@/resource/ResourceTypes";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
// import { ModuleObjectManager } from "@/managers";
import { AudioEmitterType } from "@/enums/audio/AudioEmitterType";
import { AudioEngineChannel } from "@/enums/audio/AudioEngineChannel";
import { GameState } from "@/GameState";
import { OdysseyModel3D } from "@/three/odyssey/OdysseyModel3D";
import { AudioGeneratedType } from "@/enums/audio/AudioGeneratedType";
import { AudioPriorityGroup } from "@/enums/audio/AudioPriorityGroup";

/**
* ModuleSound class.
* 
* Class representing sound emitters found in modules areas.
* 
* KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
* 
* @file ModuleSound.ts
* @author KobaltBlu <https://github.com/KobaltBlu>
* @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
* @memberof KotOR
*/
export class ModuleSound extends ModuleObject {
  audioEngine: AudioEngine;
  soundType: AudioEmitterType = AudioEmitterType.GLOBAL;
  active: boolean = true;
  continuous: boolean = false;
  fixedVariance: number = 0;
  generatedType: AudioGeneratedType = AudioGeneratedType.MANUALLY_PLACED;
  hours: number = 0;

  interval: number = 1000;

  intervalVariation: number = 0;

  looping: boolean = false;

  maxDistance: number = 1;

  minDistance: number = 0;

  pitchVariation: number = 0;

  positional: boolean = false;

  /**
   * IF true, the waves in the Sound's wave list are chosen randomly each time one finishes playing.
   * IF false, the waves are played in sequential order.
   */
  random: boolean = false;

  /**
   * IF true, the sound should be played from a random position with an offset from the Sound's position.
   * IF false, the sound should be played from the Sound's position.
   */
  randomPosition: boolean = false;

  /**
   * The maximum distance from the Sound's position to the random position on the X axis.
   */
  randomRangeX: number = 0;

  /**
   * The maximum distance from the Sound's position to the random position on the Y axis.
   */
  randomRangeY: number = 0;

  /**
   * The list of sound resrefs to play.
   */
  soundResRefs: string[] = [];

  /**
   * Times to play the sound.
   * 0 = Hour specific
   * 1 = Day
   * 2 = Night
   * 3 = Always
   */
  times: number = 3;

  /**
   * The volume of the sound.
   * MIN = 0, MAX = 127
   */
  volume: number = 70;

  /**
   * The variation of the volume of the sound.
   * MIN = 0, MAX = 127
   */
  volumeVariation: number = 0;

  /**
   * The elevation of the sound on the Z axis.
   */
  elevation: number = 0;

  /**
   * The priority of the sound.
   * index into prioritygroups.2da
   */
  priority: number = 0;

  constructor ( gff: GFFObject, audioEngine?: AudioEngine ) {

    super(gff);
    this.objectType |= ModuleObjectType.ModuleSound;

    this.template = gff;
    this.audioEngine = audioEngine;

    this.active = true;
    this.commandable = 1;
    this.continuous = false;
    this.fixedVariance = 1;
    this.generatedType = 0;
    this.hours = 0;
    this.interval = 0;
    this.intervalVariation = 0;
    this.looping = false;
    this.maxDistance = 0;
    this.minDistance = 0;
    this.pitchVariation = 0;
    this.positional = false;
    this.random = false;
    this.randomPosition = false;
    this.randomRangeX = 0;
    this.randomRangeY = 0;
    this.soundResRefs = [];
    this.times = 3;
    this.volume = 0;
    this.volumeVariation = 0;
    this.priority = 0;

  }

  load(){
    this.mergeTemplate(ResourceTypes['uts']);
    this.initProperties();
  }

  getPreviewModelResRef(): string {
    if(this.random){
      return 'gi_sound_rndm';
    }else if(this.positional){
      return 'gi_sound_pos';
    }
    return 'gi_sound_area';
  }

  async loadModel ( ) {
    const modelName = this.getPreviewModelResRef();
    const mdl = await MDLLoader.loader.load(modelName);
    const model = await OdysseyModel3D.FromMDL(mdl, {
      context: GameState.context
    });
    this.model = model;
    return model;
  }

  async loadSound(){
    const priorityGroup = GameState.SWRuleSet.getPriorityGroupById(this.priority);
    const type = !!this.positional ? AudioEmitterType.POSITIONAL : AudioEmitterType.GLOBAL;
    if(this.audioEmitter){
      this.audioEmitter.destroy();
    }
    this.audioEmitter = new AudioEmitter(this.audioEngine, AudioEngineChannel.SFX);
    this.audioEmitter.name = this.tag;
    this.audioEmitter.isActive = this.active;
    this.audioEmitter.isLooping = this.looping;
    this.audioEmitter.isRandom = this.random;
    this.audioEmitter.isRandomPosition = this.randomPosition;
    this.audioEmitter.interval = this.interval;
    this.audioEmitter.intervalVariation = this.intervalVariation;
    this.audioEmitter.minDistance = this.minDistance > 0 ? this.minDistance : Math.max(1, priorityGroup?.minvolumedist || 1);
    this.audioEmitter.maxDistance = this.maxDistance > 0 ? this.maxDistance : Math.max(this.audioEmitter.minDistance, priorityGroup?.maxvolumedist || 1);
    this.audioEmitter.playbackRate = 1;
    this.audioEmitter.playbackRateVariation = this.pitchVariation > 0 ? this.pitchVariation : priorityGroup?.playbackvariance || 0;
    this.audioEmitter.volume = Math.max(0, Math.min(127, this.volume));
    this.audioEmitter.volumeVariation = this.volumeVariation || 0;
    this.audioEmitter.setPriorityGroupId(Number.isFinite(this.priority) ? this.priority : AudioPriorityGroup.DEFAULT);
    this.audioEmitter.type = type;
    this.audioEmitter.sounds = this.soundResRefs.slice(0);
    this.audioEmitter.position.x = this.position.x;
    this.audioEmitter.position.y = this.position.y;
    this.audioEmitter.position.z = this.position.z;
    this.audioEmitter.randomX = this.randomPosition ? this.randomRangeX || 0 : 0;
    this.audioEmitter.randomY = this.randomPosition ? this.randomRangeY || 0 : 0;
    this.audioEmitter.randomZ = 0;
    this.audioEmitter.elevation = this.elevation || 0;
    await this.audioEmitter.load();
  }

  setVolume(volume: number): ModuleSound {
    this.volume = Math.max(0, Math.min(127, volume));
    if(this.audioEmitter){
      this.audioEmitter.setVolume(this.volume);
    }
    return this;
  }

  setPosition(x: number = 0, y: number = 0, z: number = 0): ModuleSound {
    this.position.x = x;
    this.position.y = y;
    this.position.z = z;
    if(this.audioEmitter){
      this.audioEmitter.setPosition(x, y, z);
    }
    return this;
  }

  setPitchVariation(pitchVariation: number = 1.0): ModuleSound {
    this.pitchVariation = Math.max(0, Math.min(2.0, pitchVariation));
    if(this.audioEmitter){
      this.audioEmitter.playbackRateVariation = this.pitchVariation;
    }
    return this;
  }

  setFixedVariance(fixedVariance: number = 1.0): ModuleSound {
    this.fixedVariance = Math.max(0, Math.min(2.0, fixedVariance));
    return this;
  }

  start(): ModuleSound {
    if(this.audioEmitter){
      this.audioEmitter.start();
    }
    return this;
  }

  stop(fadeTime: number = 0): ModuleSound {
    fadeTime = Math.max(0, fadeTime);

    if(this.audioEmitter){
      this.audioEmitter.stop(fadeTime);
    }
    return this;
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

    if(this.template.RootNode.hasField('LocName'))
      this.name = this.template.getFieldByLabel('LocName').getCExoLocString().getValue();

    if(this.template.RootNode.hasField('Active'))
      this.active = !!this.template.getFieldByLabel('Active').getValue()

    if(this.template.RootNode.hasField('Priority'))
      this.priority = this.template.getFieldByLabel('Priority').getValue()

    if(this.template.RootNode.hasField('Commandable'))
      this.commandable = !!this.template.getFieldByLabel('Commandable').getValue()

    if(this.template.RootNode.hasField('FixedVariance'))
      this.fixedVariance = this.template.getFieldByLabel('FixedVariance').getValue()

    if(this.template.RootNode.hasField('GeneratedType'))
      this.generatedType = this.template.getFieldByLabel('GeneratedType').getValue()

    if(this.template.RootNode.hasField('Hours'))
      this.hours = this.template.getFieldByLabel('Hours').getValue()

    this.interval = this.template.RootNode.get('Interval', this.interval);

    this.intervalVariation = this.template.RootNode.get('IntervalVrtn', this.intervalVariation);

    this.looping = this.template.RootNode.get('Looping', this.looping);

    this.maxDistance = this.template.RootNode.get('MaxDistance', this.maxDistance);
      
    this.minDistance = this.template.RootNode.get('MinDistance', this.minDistance);

    this.pitchVariation = this.template.RootNode.get('PitchVariation', this.pitchVariation);

    if(this.template.RootNode.hasField('Positional'))
      this.positional = !!this.template.getFieldByLabel('Positional').getValue();

    this.random = this.template.RootNode.get('Random', this.random);

    if(this.template.RootNode.hasField('RandomPosition'))
      this.randomPosition = !!this.template.getFieldByLabel('RandomPosition').getValue();

    this.randomRangeX = this.template.RootNode.get('RandomRangeX', this.randomRangeX);

    this.randomRangeY = this.template.RootNode.get('RandomRangeY', this.randomRangeY);

    if(this.template.RootNode.hasField('Sounds')){
      const sounds = this.template.getFieldByLabel('Sounds').getChildStructs();
      for(let i = 0; i < sounds.length; i++){
        this.soundResRefs.push(sounds[i].getFieldByLabel('Sound').getValue());
      }
    }

    this.initCommonProperties();

    this.times = this.template.RootNode.get('Times', this.times);

    this.volume = this.template.RootNode.get('Volume', this.volume);

    this.volumeVariation = this.template.RootNode.get('VolumeVrtn', this.volumeVariation);

    this.elevation = this.template.RootNode.get('Elevation', this.elevation);

    if(this.template.RootNode.hasField('SWVarTable')){
      let localBools = this.template.RootNode.getFieldByLabel('SWVarTable').getChildStructs()[0].getFieldByLabel('BitArray').getChildStructs();
      for(let i = 0; i < localBools.length; i++){
        let data = localBools[i].getFieldByLabel('Variable').getValue();
        for(let bit = 0; bit < 32; bit++){
          this._locals.Booleans[bit + (i*32)] = ( (data>>bit) % 2 != 0);
        }
      }
    }

    this.soundType = AudioEmitterType.GLOBAL;
    if(this.positional){
      this.soundType = this.randomPosition ? AudioEmitterType.RANDOM : AudioEmitterType.POSITIONAL;
    }
    
    this.initialized = true;

  }

  save(){
    let gff = new GFFObject();
    gff.FileType = 'UTS ';
    gff.RootNode.type = 6;

    gff.RootNode.addField( this.actionQueueToActionList() );
    gff.RootNode.addByte('Active', this.active ? 1 : 0);
    gff.RootNode.addByte('Commandable', this.commandable ? 1 : 0);
    gff.RootNode.addByte('Continuous', this.continuous ? 1 : 0);
    gff.RootNode.addFloat('FixedVariance', this.fixedVariance);
    gff.RootNode.addDWord('GeneratedType', this.generatedType);
    gff.RootNode.addDWord('Hours', this.hours);
    gff.RootNode.addDWord('Interval', this.interval);
    gff.RootNode.addDWord('IntervalVrtn', this.intervalVariation);
    gff.RootNode.addByte('Looping', this.looping ? 1 : 0);
    gff.RootNode.addFloat('MaxDistance', this.maxDistance);
    gff.RootNode.addFloat('MinDistance', this.minDistance);
    gff.RootNode.addDWord('ObjectId', this.id);
    gff.RootNode.addFloat('PitchVariation', this.pitchVariation);
    gff.RootNode.addByte('Positional', this.positional ? 1 : 0);
    gff.RootNode.addByte('Random', this.random ? 1 : 0);
    gff.RootNode.addByte('RandomPosition', this.randomPosition ? 1 : 0);
    gff.RootNode.addFloat('RandomRangeX', this.randomRangeX);
    gff.RootNode.addFloat('RandomRangeY', this.randomRangeY);
    gff.RootNode.addByte('Priority', this.priority);
    //SWVarTable
    let swVarTable = gff.RootNode.addField( new GFFField(GFFDataType.STRUCT, 'SWVarTable') );
    swVarTable.addChildStruct( this.getSWVarTableSaveStruct() );

    //Sounds
    let sounds = gff.RootNode.addField( new GFFField(GFFDataType.LIST, 'Sounds') );
    for(let i = 0; i < this.soundResRefs.length; i++){
      let soundStruct = new GFFStruct();
      soundStruct.addField( new GFFField(GFFDataType.RESREF, 'Sound', this.soundResRefs[i]) );
      sounds.addChildStruct(soundStruct);
    }

    gff.RootNode.addCExoString('Tag', this.tag);
    gff.RootNode.addFloat('Times', this.times);
    gff.RootNode.addField( new GFFField(GFFDataType.LIST, 'VarTable') );
    gff.RootNode.addFloat('Volume', Math.max(0, Math.min(127, this.volume)));
    gff.RootNode.addFloat('VolumeVrtn', Math.max(0, Math.min(127, this.volumeVariation)));
    gff.RootNode.addFloat('Elevation', this.elevation);
    gff.RootNode.addFloat('XPosition', this.position.x);
    gff.RootNode.addFloat('YPosition', this.position.y);
    gff.RootNode.addFloat('ZPosition', this.position.z);

    this.template = gff;
    return gff;
  }

  destroy(): void {
    super.destroy();
  }

}
