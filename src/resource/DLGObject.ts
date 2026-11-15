import { GameState } from "@/GameState";
import type { ModuleCreature, ModuleObject } from "@/module";
import { OdysseyModel } from "@/odyssey";
import { OdysseyModel3D } from "@/three/odyssey";
import { DLGNode } from "@/resource/DLGNode";
import { GFFObject } from "@/resource/GFFObject";
import { ResourceTypes } from "@/resource/ResourceTypes";
import * as THREE from "three";
import { IDLGStuntActor } from "@/interface/dialog/IDLGStuntActor";
import { DLGNodeType } from "@/enums/dialog/DLGNodeType";
import type { NWScriptInstance } from "@/nwscript/NWScriptInstance";
// import { NWScript } from "@/nwscript/NWScript";
import { MDLLoader, ResourceLoader } from "@/loaders";
import { BitWise } from "@/utility/BitWise";
import { ModuleObjectType } from "@/enums";
import { AudioLoader } from "@/audio/AudioLoader";
import { AudioEngine } from "@/audio/AudioEngine";

export interface DLGObjectScripts {
  onEndConversationAbort: NWScriptInstance,
  onEndConversation: NWScriptInstance,
}

/**
 * A conversation written as it happens (e.g. a GM speaking for an NPC) instead of read from a .dlg file.
 * Picking a reply hands it to the handler, and the conversation waits for the next entry to be shown.
 */
export interface IDLGLiveHandler {
  onReply(reply: DLGNode, index: number): void;
  onEnd(aborted: boolean): void;
}

/**
 * DLGObject class.
 * 
 * Class representing a DLG file in memory.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file DLGObject.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class DLGObject {
  resref: string;
  gff: GFFObject;
  conversationType: number;
  entryList: DLGNode[] = [];
  replyList: DLGNode[] = [];
  startingList: DLGNode[] = [];
  stuntActors: Map<string, IDLGStuntActor> = new Map();
  owner: ModuleObject;
  listener: ModuleObject;
  /** Set for a live conversation; see IDLGLiveHandler */
  live?: IDLGLiveHandler;

  vo_id: string; //folder where the vo files reside

  scripts: DLGObjectScripts = {
    onEndConversationAbort: undefined,
    onEndConversation: undefined,
  }

  ambientTrack: string;
  unequipHeadItem: boolean;
  unequipItems: boolean;
  isAnimatedCutscene: boolean;
  animatedCameraResRef: string;
  animatedCamera: OdysseyModel3D;
  recordNoVO: boolean;
  oldHitCheck: boolean;
  postProcOwner: number;
  alienRaceOwner: number;

  constructor(resref = ''){
    this.resref = resref;

    this.conversationType = 0;
    this.entryList = [];
    this.replyList = [];
    this.startingList = [];

    this.owner = undefined;
    this.listener = undefined;

  }

  init(){

    let conversationType = this.gff.RootNode.getFieldByLabel('ConversationType');
    if(conversationType){
      this.conversationType = conversationType.getValue();
    }

    this.vo_id = this.gff.RootNode.get('VO_ID', this.vo_id);

    this.animatedCameraResRef = this.gff.RootNode.get('CameraModel', this.animatedCameraResRef);

    if(this.gff.RootNode.hasField('EndConverAbort')){
      const scriptName = this.gff.RootNode.getFieldByLabel('EndConverAbort').getValue();
      this.scripts.onEndConversationAbort = GameState.NWScript.Load(scriptName);
      if(this.scripts.onEndConversationAbort){
        this.scripts.onEndConversationAbort.name = scriptName;
      }
    }

    if(this.gff.RootNode.hasField('EndConversation')){
      const scriptName = this.gff.RootNode.getFieldByLabel('EndConversation').getValue();
      this.scripts.onEndConversation = GameState.NWScript.Load(scriptName);
      if(this.scripts.onEndConversation){
        this.scripts.onEndConversation.name = scriptName;
      }
    }

    if(this.gff.RootNode.hasField('AnimatedCut')){
      this.isAnimatedCutscene = this.gff.RootNode.getFieldByLabel('AnimatedCut').getValue() ? true : false;
    }

    this.ambientTrack = this.gff.RootNode.get('AmbientTrack', this.ambientTrack);

    if(this.gff.RootNode.hasField('UnequipHItem')){
      this.unequipHeadItem = this.gff.RootNode.getFieldByLabel('UnequipHItem').getValue() ? true : false;
    }

    if(this.gff.RootNode.hasField('UnequipItems')){
      this.unequipItems = this.gff.RootNode.getFieldByLabel('UnequipItems').getValue() ? true : false;
    }

    this.alienRaceOwner = this.gff.RootNode.get('AlienRaceOwner', this.alienRaceOwner);

    if(this.gff.RootNode.hasField('RecordNoVO')){
      this.recordNoVO = this.gff.RootNode.getFieldByLabel('RecordNoVO').getValue() ? true : false;
    }

    if(this.gff.RootNode.hasField('OldHitCheck')){
      this.oldHitCheck = this.gff.RootNode.getFieldByLabel('OldHitCheck').getValue() ? true : false;
    }

    this.postProcOwner = this.gff.RootNode.get('PostProcOwner', this.postProcOwner);

    if(this.gff.RootNode.hasField('EntryList')){
      const entries = this.gff.RootNode.getFieldByLabel('EntryList').getChildStructs();
      for(let i = 0; i < entries.length; i++){
        let node = DLGNode.FromDialogStruct(entries[i], this);
        node.nodeType = DLGNodeType.ENTRY;
        this.entryList.push( node );
      }
    }

    if(this.gff.RootNode.hasField('ReplyList')){
      const replies = this.gff.RootNode.getFieldByLabel('ReplyList').getChildStructs();
      for(let i = 0; i < replies.length; i++){
        let node = DLGNode.FromDialogStruct(replies[i], this);
        node.nodeType = DLGNodeType.REPLY;
        this.replyList.push( node );
      }
    }

    if(this.gff.RootNode.hasField('StuntList')){
      const stunts = this.gff.RootNode.getFieldByLabel('StuntList').getChildStructs();
      for(let i = 0; i < stunts.length; i++){
        const stunt: IDLGStuntActor = {
          participant: '',
          resref: ''
        };

        const struct = stunts[i];
        if(struct.hasField('Participant')){
          stunt.participant = struct.getFieldByLabel('Participant').getValue();
          stunt.participant = stunt.participant != '' ? stunt.participant : 'OWNER';
        }

        stunt.resref = struct.get('StuntModel', stunt.resref);

        this.stuntActors.set(stunt.participant.toLocaleLowerCase(), stunt);
      }
    }

    if(this.gff.RootNode.hasField('StartingList')){
      const startingList = this.gff.RootNode.getFieldByLabel('StartingList').getChildStructs();

      for(let i = 0; i < startingList.length; i++){
        let struct = startingList[i];
        let linkNode = new DLGNode(this);
        linkNode.nodeType = DLGNodeType.STARTING;
        
        linkNode.entries = [];
        linkNode.replies = [];

        linkNode.isActiveParams.Not = struct.get('Not', linkNode.isActiveParams.Not);

        linkNode.isActiveParams.Param1 = struct.get('Param1', linkNode.isActiveParams.Param1);

        linkNode.isActiveParams.Param2 = struct.get('Param2', linkNode.isActiveParams.Param2);

        linkNode.isActiveParams.Param3 = struct.get('Param3', linkNode.isActiveParams.Param3);

        linkNode.isActiveParams.Param4 = struct.get('Param4', linkNode.isActiveParams.Param4);

        linkNode.isActiveParams.Param5 = struct.get('Param5', linkNode.isActiveParams.Param5);

        linkNode.isActiveParams.String = struct.get('ParamStrA', linkNode.isActiveParams.String);

        linkNode.isActive2Params.Not = struct.get('Not2', linkNode.isActive2Params.Not);

        linkNode.isActive2Params.Param1 = struct.get('Param1b', linkNode.isActive2Params.Param1);

        linkNode.isActive2Params.Param2 = struct.get('Param2b', linkNode.isActive2Params.Param2);

        linkNode.isActive2Params.Param3 = struct.get('Param3b', linkNode.isActive2Params.Param3);

        linkNode.isActive2Params.Param4 = struct.get('Param4b', linkNode.isActive2Params.Param4);

        linkNode.isActive2Params.Param5 = struct.get('Param5b', linkNode.isActive2Params.Param5);

        linkNode.isActive2Params.String = struct.get('ParamStrB', linkNode.isActive2Params.String);

        if(struct.hasField('Logic')){
          linkNode.Logic = !!struct.getFieldByLabel('Logic').getValue();
        }

        if(struct.hasField('Active')){
          const resref = struct.getFieldByLabel('Active').getValue();
          if(resref){
            linkNode.isActive = GameState.NWScript.Load(resref);
            if(linkNode.isActive){
              linkNode.isActive.name = resref;
            }
          }
        }

        if(struct.hasField('Active2')){
          const resref = struct.getFieldByLabel('Active2').getValue();
          if(resref){
            linkNode.isActive2 = GameState.NWScript.Load(resref);
            if(linkNode.isActive2){
              linkNode.isActive2.name = resref;
            }
          }
        }

        linkNode.index = struct.get('Index', linkNode.index);

        this.startingList.push(linkNode);
      }
    }

  }

  getReplyByIndex( index = -1 ){
    return this.replyList[index];
  }

  getEntryByIndex( index = -1 ){
    return this.entryList[index];
  }

  getConversationType(){
    return this.conversationType;
  }

  getStuntActors(){
    return this.stuntActors;
  }

  getNextEntryIndex( entryLinkList: DLGNode[] = [] ){
    if(!entryLinkList.length){
      return undefined;
    }

    let e_count = entryLinkList.length;
    for(let i = 0; i < e_count; i++){
      let entryLink = entryLinkList[i];
      let isActive = entryLink.runActiveScripts();
      if(isActive){
        return entryLink.index;
      }
    }

    return undefined;
  }

  getAvailableReplies( entry: DLGNode ){
    let replies: DLGNode[] = [];
    let replyLinks = entry.getActiveReplies();
    for (let i = 0; i < replyLinks.length; i++) {
      let reply = this.getReplyByIndex(replyLinks[i]);
      if (reply) {
        replies.push(reply);
      } else {
        console.warn('getAvailableReplies() Failed to find reply at index: ' + replyLinks[i]);
      }
    }
    return replies;
  }

  async loadStuntCamera(){
    try{
      console.log('loadStuntCamera', this.animatedCameraResRef);
      if(!this.animatedCameraResRef){ return; }

      const model = await MDLLoader.loader.load(this.animatedCameraResRef);
      if(!model){ return; }

      const mdl = await OdysseyModel3D.FromMDL(model);
      if(!mdl){ return; }

      this.animatedCamera = mdl;
      this.animatedCamera.bonesInitialized = true;
    }catch(e){
      console.error(e);
    }
  }

  async loadStuntActor( actor: IDLGStuntActor ){
    return new Promise<void>( (resolve, reject) => {
      let model: any;
      if(actor.participant == 'PLAYER'){
        model = GameState.PartyManager.party[0].model;
        //Load the actor's supermodel
        MDLLoader.loader.load(actor.resref)
        .then((actorModel: OdysseyModel) => {
          OdysseyModel3D.FromMDL(actorModel)
          .then((actorSuperModel: OdysseyModel3D) => {
            actor.animations = actorSuperModel.odysseyAnimations;

            if(this.isAnimatedCutscene)
              GameState.PartyManager.party[0].setFacing(0, true);

            if(this.unequipItems)
              GameState.PartyManager.party[0].UnequipItems();

            if(this.unequipHeadItem)
              GameState.PartyManager.party[0].UnequipHeadItem();

            actor.moduleObject = GameState.PartyManager.party[0];
            if(actor.moduleObject){
              actor.moduleObject.setCutsceneMode(true);
            }
            resolve();
          }).catch(resolve);
        }).catch(resolve);
      }else if(actor.participant == 'OWNER'){

        actor.moduleObject = this.owner;
        if(this.isAnimatedCutscene)
          this.owner.setFacing(0, true);

        if(actor.moduleObject){
          actor.moduleObject.setCutsceneMode(true);
        }
        
        resolve();

      }else{
        let creature = GameState.ModuleObjectManager.GetObjectByTag(actor.participant);
        if(creature){
          model = creature.model;
          //Load the actor's supermodel
          MDLLoader.loader.load(actor.resref)
          .then((actorModel: OdysseyModel) => {
            OdysseyModel3D.FromMDL(actorModel)
            .then((actorSuperModel: OdysseyModel3D) => {
              actor.animations = actorSuperModel.odysseyAnimations;

              if(this.isAnimatedCutscene)
                creature.setFacing(0, true);

              model.box = new THREE.Box3().setFromObject(model);

              if(this.unequipItems && BitWise.InstanceOfObject(creature, ModuleObjectType.ModuleCreature))
                (creature as ModuleCreature).UnequipItems();

              if(this.unequipHeadItem && BitWise.InstanceOfObject(creature, ModuleObjectType.ModuleCreature))
                (creature as ModuleCreature).UnequipHeadItem();

              actor.moduleObject = creature;
              if(actor.moduleObject){
                actor.moduleObject.setCutsceneMode(true);
              }
              resolve();
            }).catch(resolve);
          }).catch(resolve);
        }else{
          resolve();
        }
      }
    });
  }

  async loadStuntActors(){
    for (var [key, actor] of this.stuntActors.entries()) {
      await this.loadStuntActor(actor);
    };
  }

  releaseStuntActors(){
    while (GameState.group.stunt.children.length) {
      GameState.group.stunt.remove(GameState.group.stunt.children[0]);
    }
    this.stuntActors.forEach( async (actor) => {
      const moduleObject = actor.moduleObject;
      if(moduleObject){
        moduleObject.clearAllActions();
        moduleObject.setCutsceneMode(false);
      }
    });
    this.stuntActors.clear()
  }

  /**
   * Load the dialog background music
   */
  async loadBackgroundMusic() {
    if (!this.ambientTrack) { return; }
    const bgm = await AudioLoader.LoadMusic(this.ambientTrack);
    if(!bgm){ return; }
    AudioEngine.GetAudioEngine().setAudioBuffer('DIALOG', bgm.buffer as ArrayBuffer, this.ambientTrack);
    AudioEngine.GetAudioEngine().dialogMusicAudioEmitter.play();
  }

  async load(){
    return new Promise<void>( (resolve, reject) => {
      if(this.resref){
        const buffer = ResourceLoader.loadCachedResource(ResourceTypes['dlg'], this.resref);
        if(buffer){
          this.gff = new GFFObject(buffer);
          this.init();
          resolve();
        }else{
          reject();
        }
      }else{
        reject();
      }
    });
  }

  static FromGFFObject(gff: GFFObject): DLGObject {
    const dlg = new DLGObject();
    dlg.gff = gff;
    dlg.init();
    return dlg;
  }

  static FromResRef(resref: string): DLGObject {
    if(resref){
      const buffer = ResourceLoader.loadCachedResource(ResourceTypes['dlg'], resref.toLocaleLowerCase());
      if(buffer){
        const dlg = DLGObject.FromGFFObject(new GFFObject(buffer));
        if(dlg){
          dlg.resref = resref.toLocaleLowerCase();
        }
        return dlg;
      }
    }
    return;
  }

}

