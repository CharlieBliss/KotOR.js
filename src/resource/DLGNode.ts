import { AudioEmitter } from "@/audio";
import { DLGNodeType } from "@/enums/dialog/DLGNodeType";
import { DLGNodeEngineType } from "@/enums/dialog/DLGNodeEngineType";
import { GameState } from "@/GameState";
import { IDLGNodeScriptParams } from "@/interface/dialog/IDLGNodeScriptParams";
// import { DialogMessageEntry, DialogMessageManager, FadeOverlayManager, JournalManager, ModuleObjectManager } from "@/managers";
import type { ModuleCreature, ModuleObject } from "@/module";
// import { NWScript } from "@/nwscript/NWScript";
import { NWScriptInstance } from "@/nwscript/NWScriptInstance";
import { LIPObject } from "@/resource/LIPObject";
import { GFFStruct } from "@/resource/GFFStruct";
import { DialogMessageEntry } from "@/engine/DialogMessageEntry";
import { BitWise } from "@/utility/BitWise";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { DLGCameraAngle } from "@/enums/dialog/DLGCameraAngle";
import type { DLGObject } from "@/resource/DLGObject";

class DummyScriptInstance extends NWScriptInstance {
  name: string = 'SWG_DUMMY_SCRIPT';
  run(caller?: any, scriptVar?: number): false | 0 | 1 {
    return false;
  }
}

/**
 * DLGNode class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file DLGNode.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class DLGNode {
  nodeType: DLGNodeType;
  nodeEngineType: DLGNodeEngineType;
  animations: any[];
  cameraAngle: number;
  cameraID: number;
  cameraAnimation: number;
  camFieldOfView: number;
  camVidEffect: number = -1;
  comment: string;
  delay: number;
  fadeType: number;
  listenerTag: string;
  plotIndex: number;
  plotXPPercentage: number;
  quest: string;
  questEntry: number;
  repliesShown: boolean = false;
  replies: DLGNode[] = [];
  entries: DLGNode[] = [];
  script: NWScriptInstance;
  scriptParams: IDLGNodeScriptParams = {} as IDLGNodeScriptParams;
  script2: NWScriptInstance;
  script2Params: IDLGNodeScriptParams = {} as IDLGNodeScriptParams;
  isActive: NWScriptInstance | DummyScriptInstance;
  isActiveParams: IDLGNodeScriptParams = {} as IDLGNodeScriptParams;
  isActive2: NWScriptInstance | DummyScriptInstance;
  isActive2Params: IDLGNodeScriptParams = {} as IDLGNodeScriptParams;
  Logic: boolean;
  index: number;
  isChild: number;
  sound: string;
  soundExists: number;
  speakerTag: string;
  text: string;
  vo_resref: string;
  waitFlags: number;
  elapsed: number = 0;
  fade: { type: number; length: number; delay: number; color: { r: number; g: number; b: number; };  started: boolean };
  speaker: ModuleObject;
  dialog: DLGObject;

  listener: ModuleObject;
  owner: ModuleObject;

  checkList: any = {};
  timeout: any;
  skippable: boolean;

  alienRaceNode: number = 0;
  emotion: number = 4;
  facialAnimation: number = 0;
  postProcessNode: number = 0;
  recordNoVOOverride: number = 0;
  recordVO: number = 0;
  voTextChanged: boolean = true;

  constructor(dialog?: DLGObject){
    this.nodeEngineType = DLGNodeEngineType.K1;
    this.dialog = dialog || undefined;
    this.animations = [];
    this.cameraAngle = 0;
    this.cameraID = 0;
    this.cameraAnimation = -1;
    this.camFieldOfView = -1;
    this.camVidEffect = -1;
    this.comment = '';
    this.delay = 0;
    this.fadeType = 0;
    this.listenerTag = '';
    this.plotIndex = -1;
    this.plotXPPercentage = 1;
    this.quest = '';
    this.questEntry = 0;
    this.replies = [];
    this.entries = [];

    //Script Properties
    this.script = undefined;
    this.scriptParams = {} as IDLGNodeScriptParams;
    this.script2 = undefined;
    this.script2Params = {} as IDLGNodeScriptParams;

    //Conditional Active Node Properties
    this.isActive = undefined;
    this.isActive2 = undefined;
    this.isActiveParams = {} as IDLGNodeScriptParams;
    this.isActive2Params = {} as IDLGNodeScriptParams;
    this.Logic = false;
    this.index = -1;
    this.isChild = 0;

    this.sound = '';
    this.soundExists = 0;
    this.speakerTag = '';
    this.text = '';
    this.vo_resref = '';
    this.waitFlags = 0;
    this.fade = {
      type: 0,
      length: 0,
      delay: 0,
      color: {r:0, g:0, b:0},
      started: false,
    };
  }

  setDialog(dialog: DLGObject){
    this.dialog = dialog;
  }

  initProperties(){
    if(this.speakerTag != ''){
      this.speaker = GameState.ModuleObjectManager.GetObjectByTag(this.speakerTag);
    }else{
      this.speaker = this.dialog.owner;
    }

    if(typeof this.speaker == 'undefined'){
      this.speaker = this.dialog.owner;
    }

    if(this.listenerTag != ''){
      if(this.listenerTag == 'PLAYER'){
        this.listener = GameState.PartyManager.party[0];
      }else{
        this.listener = GameState.ModuleObjectManager.GetObjectByTag(this.listenerTag);
      }
    }else{
      this.listener = GameState.PartyManager.party[0];
    }

    if(typeof this.listener == 'undefined'){
      this.listener = this.dialog.listener;
    }

    //Checklist
    this.resetChecklist();
  }

  runScript1(){
    if(this.script){
      this.script.setScriptParam(1, this.scriptParams.Param1);
      this.script.setScriptParam(2, this.scriptParams.Param2);
      this.script.setScriptParam(3, this.scriptParams.Param3);
      this.script.setScriptParam(4, this.scriptParams.Param4);
      this.script.setScriptParam(5, this.scriptParams.Param5);
      this.script.setScriptStringParam(this.scriptParams.String);
      this.script.run(this.speaker || this.dialog?.owner || this.dialog?.owner, 0);
    }
  }

  runScript2(){
    if(this.script2){
      this.script2.setScriptParam(1, this.script2Params.Param1);
      this.script2.setScriptParam(2, this.script2Params.Param2);
      this.script2.setScriptParam(3, this.script2Params.Param3);
      this.script2.setScriptParam(4, this.script2Params.Param4);
      this.script2.setScriptParam(5, this.script2Params.Param5);
      this.script2.setScriptStringParam(this.script2Params.String);
      this.script2.run(this.speaker || this.dialog?.owner || this.dialog?.owner, 0);
    }
  }

  runScripts(){
    this.runScript1();
    this.runScript2();
  }

  runActiveScript1(){
    if(this.isActive){
      this.isActive.setScriptParam(1, this.isActiveParams.Param1);
      this.isActive.setScriptParam(2, this.isActiveParams.Param2);
      this.isActive.setScriptParam(3, this.isActiveParams.Param3);
      this.isActive.setScriptParam(4, this.isActiveParams.Param4);
      this.isActive.setScriptParam(5, this.isActiveParams.Param5);
      this.isActive.setScriptStringParam(this.isActiveParams.String);
      const bSuccess = this.isActive.run(this.speaker || this.dialog?.owner || this.dialog?.owner, 0);
      if(this.isActiveParams.Not){
        return bSuccess ? false : true;
      }else{
        return bSuccess ? true : false;
      }
    }
    
    return true;
  }

  runActiveScript2(){
    if(this.isActive2){
      this.isActive2.setScriptParam(1, this.isActive2Params.Param1);
      this.isActive2.setScriptParam(2, this.isActive2Params.Param2);
      this.isActive2.setScriptParam(3, this.isActive2Params.Param3);
      this.isActive2.setScriptParam(4, this.isActive2Params.Param4);
      this.isActive2.setScriptParam(5, this.isActive2Params.Param5);
      this.isActive2.setScriptStringParam(this.isActive2Params.String);
      const bSuccess = this.isActive2.run(this.speaker || this.dialog?.owner || this.dialog?.owner, 0);
      if(this.isActive2Params.Not){
        return (bSuccess ? false : true);
      }else{
        return (bSuccess ? true : false);
      }
    }
    
    return true;
  }

  runActiveScripts(){
    return this.runActiveScript1() && this.runActiveScript2();
  }

  getActiveReplies(): number[] {
    let totalReplies = this.replies.length;
    let replyIds: number[] = [];
    for(let i = 0; i < totalReplies; i++){
      let replyLink = this.replies[i];
      if(replyLink.runActiveScripts()){
        replyIds.push(replyLink.index);
      }
    }
    return replyIds;
  }

  updateJournal(){
    const speaker = this.speaker || (this.nodeType == DLGNodeType.REPLY ? GameState.getCurrentPlayer() : this.speaker);
    if(this.quest){
      const allowOverrideHigher = false;
      GameState.JournalManager.AddJournalQuestEntry(this.quest, this.questEntry, allowOverrideHigher);
    }
    if(!this.text || this.text.length == 0 || this.isContinueDialog()){
      console.warn(`No text found for ${this.text} on ${this.speaker?.getName()}. not saving to journal`, this.isContinueDialog());
      return;
    }
    try{
      if(!speaker){
        console.error(`No speaker found for ${this.text}`);
        console.log(this);
        return;
      }
      console.log('saving', speaker.getName(), this.text);
      GameState.DialogMessageManager.AddEntry(
        new DialogMessageEntry(
          speaker.getName(), this.text
        )
      )
    }catch(e){
      console.error(e);
    }
  }

  update(delta: number = 0): boolean {
    this.elapsed += delta * 1000;
    this.processFadeOverlay();
    if(!!this.checkList.voiceOverError){
      if(this.elapsed >= this.delay){
        this.checkList.voiceOverComplete = true;
      }
    }
    return this.checkList.isComplete();
  }

  setNodeDelay(delay: number = 0){
    this.delay = delay;
  }

  processFadeOverlay(){
    if(this.checkList.fadeComplete) return;
    if(!this.fade.length){
      this.checkList.fadeComplete = true;
      return;
    }
    if(!this.fade.started){
      this.fade.started = true;
      switch(this.fade.type){
        case 1:
          GameState.FadeOverlayManager.FadeOut(0, this.fade.color.r, this.fade.color.g, this.fade.color.b, this.fade.delay);
        break;
        case 2:
          GameState.FadeOverlayManager.FadeIn(0, this.fade.color.r, this.fade.color.g, this.fade.color.b, this.fade.delay);
        break;
        case 3:
          GameState.FadeOverlayManager.FadeIn(this.fade.length, this.fade.color.r, this.fade.color.g, this.fade.color.b, this.fade.delay);
        break;
        case 4:
          GameState.FadeOverlayManager.FadeOut(this.fade.length, this.fade.color.r, this.fade.color.g, this.fade.color.b, this.fade.delay);
        break;
      }
    }
    if(this.elapsed >= (this.fade.delay + this.fade.length)){
      this.checkList.fadeComplete = true;
    }
  }

  loadResources(): Promise<void> {
    return new Promise( (resolve, reject) => {

    });
  }

  async loadLIP(): Promise<boolean> {
    const resref = this.getVoiceResRef();
    if(resref){
      const lip = await LIPObject.Load(resref);
      if (BitWise.InstanceOfObject(this.speaker, ModuleObjectType.ModuleCreature)) {
        (this.speaker as ModuleCreature).setLIP(lip);
      }
      return true;
    }else{
      return false;
    }
  }

  resetLIP(){
    if (BitWise.InstanceOfObject(this.speaker, ModuleObjectType.ModuleCreature)) {
      (this.speaker as ModuleCreature).setLIP(undefined);
    }
  }

  async playVoiceOver(audioEmitter: AudioEmitter): Promise<boolean> {
    const resref = this.getVoiceResRef();
    if(resref){
      await this.loadLIP();
      try{
        const audioNode = await audioEmitter.playStreamWave(resref);
        if(audioNode){
          audioNode.onended = () => {
            this.checkList.voiceOverComplete = true;
          }
          return true;
        }
        return false;
      }catch(e){
        this.checkList.voiceOverError = true;
        return false;
      }
    }else{
      this.checkList.voiceOverError = true;
      return false;
    }
  }

  getVoiceResRef(): string {
    if (this.sound != '') {
      return this.sound;
    }else if (this.vo_resref != '') {
      return this.vo_resref;
    }else{
      return '';
    }
  }

  getVideoEffect(): number {
    return this.camVidEffect == -1 || this.cameraAngle != DLGCameraAngle.ANGLE_PLACEABLE_CAMERA ? -1 : this.camVidEffect;
  }

  resetChecklist(){
    this.checkList = {
      isSkipped: false,
      cameraAnimationComplete: this.dialog.animatedCamera && this.cameraID > -1 && this.cameraAngle == DLGCameraAngle.ANGLE_ANIMATED_CAMERA ? false : true,
      voiceOverComplete: false,
      alreadyAllowed: false,
      fadeComplete: false,
      voiceOverError: false,
      isComplete: (): boolean => {
        if (this.checkList.alreadyAllowed || this.checkList.isSkipped) {
          return false;
        }
        if (!!this.dialog.animatedCamera && this.cameraID > -1 && this.cameraAngle == DLGCameraAngle.ANGLE_ANIMATED_CAMERA) {
          if (this.checkList.cameraAnimationComplete) {
            this.checkList.alreadyAllowed = true;
            return true;
          }
        } else {
          if (this.checkList.voiceOverComplete && this.checkList.fadeComplete) {
            this.checkList.alreadyAllowed = true;
            return true;
          }
        }
        return false;
      }
    };
  }

  static FromDialogStruct( struct: GFFStruct, dialog: DLGObject ){
    let node = new DLGNode(dialog);
    node.setDialog(dialog);

    node.quest = struct.get('Quest', node.quest);

    node.questEntry = struct.get('QuestEntry', node.questEntry);

    node.plotXPPercentage = struct.get('PlotXPPercentage', node.plotXPPercentage);

    node.plotIndex = struct.get('PlotIndex', node.plotIndex);

    node.listenerTag = struct.get('Listener', node.listenerTag);

    node.speakerTag = struct.get('Speaker', node.speakerTag);

    node.vo_resref = struct.get('VO_ResRef', node.vo_resref);

    node.sound = struct.get('Sound', node.sound);

    node.cameraID = struct.get('CameraID', node.cameraID);

    node.cameraAnimation = struct.get('CameraAnimation', node.cameraAnimation);

    node.cameraAngle = struct.get('CameraAngle', node.cameraAngle);

    node.camVidEffect = struct.get('CamVidEffect', node.camVidEffect);

    if(struct.hasField('Script')){
      const resref = struct.getFieldByLabel('Script').getValue();
      if(resref){
        const instance = GameState.NWScript.Load(resref);
        if(instance){
          node.script = instance;
          node.script.name = resref;
        }
      }
    }

    if(struct.hasField('Script2')){
      node.nodeEngineType = DLGNodeEngineType.K2;
      const resref = struct.getFieldByLabel('Script2').getValue();
      if(resref){
        const instance = GameState.NWScript.Load(resref);
        if(instance){
          node.script2 = instance;
          node.script2.name = resref;
        }
      }

      //k2 MODE
      node.scriptParams.Param1 = struct.get('ActionParam1', node.scriptParams.Param1);

      node.scriptParams.Param2 = struct.get('ActionParam2', node.scriptParams.Param2);

      node.scriptParams.Param3 = struct.get('ActionParam3', node.scriptParams.Param3);

      node.scriptParams.Param4 = struct.get('ActionParam4', node.scriptParams.Param4);

      node.scriptParams.Param5 = struct.get('ActionParam5', node.scriptParams.Param5);

      node.scriptParams.String = struct.get('ActionParamStrA', node.scriptParams.String);

      //k2 MODE
      node.script2Params.Param1 = struct.get('ActionParam1b', node.script2Params.Param1);

      node.script2Params.Param2 = struct.get('ActionParam2b', node.script2Params.Param2);

      node.script2Params.Param3 = struct.get('ActionParam3b', node.script2Params.Param3);

      node.script2Params.Param4 = struct.get('ActionParam4b', node.script2Params.Param4);

      node.script2Params.Param5 = struct.get('ActionParam5b', node.script2Params.Param5);

      node.script2Params.String = struct.get('ActionParamStrB', node.script2Params.String);

    }

    node.camFieldOfView = struct.get('CamFieldOfView', node.camFieldOfView);

    if(struct.hasField('RepliesList')){
      const structs = struct.getFieldByLabel('RepliesList').getChildStructs();
      node.entries = [];
      for(let i = 0; i < structs.length; i++){
        let replyStruct = structs[i];
        let linkNode = new DLGNode(dialog);

        linkNode.isActiveParams.Not = replyStruct.get('Not', linkNode.isActiveParams.Not);

        linkNode.isActiveParams.Param1 = replyStruct.get('Param1', linkNode.isActiveParams.Param1);

        linkNode.isActiveParams.Param2 = replyStruct.get('Param2', linkNode.isActiveParams.Param2);

        linkNode.isActiveParams.Param3 = replyStruct.get('Param3', linkNode.isActiveParams.Param3);

        linkNode.isActiveParams.Param4 = replyStruct.get('Param4', linkNode.isActiveParams.Param4);

        linkNode.isActiveParams.Param5 = replyStruct.get('Param5', linkNode.isActiveParams.Param5);

        linkNode.isActiveParams.String = replyStruct.get('ParamStrA', linkNode.isActiveParams.String);

        linkNode.isActive2Params.Not = replyStruct.get('Not2', linkNode.isActive2Params.Not);

        linkNode.isActive2Params.Param1 = replyStruct.get('Param1b', linkNode.isActive2Params.Param1);

        linkNode.isActive2Params.Param2 = replyStruct.get('Param2b', linkNode.isActive2Params.Param2);

        linkNode.isActive2Params.Param3 = replyStruct.get('Param3b', linkNode.isActive2Params.Param3);

        linkNode.isActive2Params.Param4 = replyStruct.get('Param4b', linkNode.isActive2Params.Param4);

        linkNode.isActive2Params.Param5 = replyStruct.get('Param5b', linkNode.isActive2Params.Param5);

        linkNode.isActive2Params.String = replyStruct.get('ParamStrB', linkNode.isActive2Params.String);

        if(replyStruct.hasField('Logic')){
          linkNode.Logic = !!replyStruct.getFieldByLabel('Logic').getValue();
        }

        if(replyStruct.hasField('Active')){
          const resref = replyStruct.getFieldByLabel('Active').getValue();
          if(resref){
            linkNode.isActive = GameState.NWScript.Load(resref) || new DummyScriptInstance(null);
            if(linkNode.isActive){
              linkNode.isActive.name = resref;
            }
          }
        }

        if(replyStruct.hasField('Active2')){
          const resref = replyStruct.getFieldByLabel('Active2').getValue();
          if(resref){
            linkNode.isActive2 = GameState.NWScript.Load(resref) || new DummyScriptInstance(null);
            if(linkNode.isActive2){
              linkNode.isActive2.name = resref;
            }
          }
        }

        linkNode.index = replyStruct.get('Index', linkNode.index);

        node.replies.push(linkNode);

      }
    }

    if(struct.hasField('EntriesList')){
      const structs = struct.getFieldByLabel('EntriesList').getChildStructs();
      node.replies = [];
      for(let i = 0; i < structs.length; i++){
        let entryStruct = structs[i];
        let linkNode = new DLGNode(dialog);
        
        linkNode.isActiveParams.Not = entryStruct.get('Not', linkNode.isActiveParams.Not);

        linkNode.isActiveParams.Param1 = entryStruct.get('Param1', linkNode.isActiveParams.Param1);

        linkNode.isActiveParams.Param2 = entryStruct.get('Param2', linkNode.isActiveParams.Param2);

        linkNode.isActiveParams.Param3 = entryStruct.get('Param3', linkNode.isActiveParams.Param3);

        linkNode.isActiveParams.Param4 = entryStruct.get('Param4', linkNode.isActiveParams.Param4);

        linkNode.isActiveParams.Param5 = entryStruct.get('Param5', linkNode.isActiveParams.Param5);

        linkNode.isActiveParams.String = entryStruct.get('ParamStrA', linkNode.isActiveParams.String);

        linkNode.isActive2Params.Not = entryStruct.get('Not2', linkNode.isActive2Params.Not);

        linkNode.isActive2Params.Param1 = entryStruct.get('Param1b', linkNode.isActive2Params.Param1);

        linkNode.isActive2Params.Param2 = entryStruct.get('Param2b', linkNode.isActive2Params.Param2);

        linkNode.isActive2Params.Param3 = entryStruct.get('Param3b', linkNode.isActive2Params.Param3);

        linkNode.isActive2Params.Param4 = entryStruct.get('Param4b', linkNode.isActive2Params.Param4);

        linkNode.isActive2Params.Param5 = entryStruct.get('Param5b', linkNode.isActive2Params.Param5);

        linkNode.isActive2Params.String = entryStruct.get('ParamStrB', linkNode.isActive2Params.String);

        if(entryStruct.hasField('Logic')){
          linkNode.Logic = !!entryStruct.getFieldByLabel('Logic').getValue();
        }

        if(entryStruct.hasField('Active')){
          const resref = entryStruct.getFieldByLabel('Active').getValue();
          if(resref){
            linkNode.isActive = GameState.NWScript.Load(resref) || new DummyScriptInstance(null);
            if(linkNode.isActive){
              linkNode.isActive.name = resref;
            }
          }
        }

        if(entryStruct.hasField('Active2')){
          const resref = entryStruct.getFieldByLabel('Active2').getValue();
          if(resref){
            linkNode.isActive2 = GameState.NWScript.Load(resref) || new DummyScriptInstance(null);
            if(linkNode.isActive2){
              linkNode.isActive2.name = resref;
            }
          }
        }

        linkNode.index = entryStruct.get('Index', linkNode.index);

        node.entries.push(linkNode);

      }
    }

    if(struct.hasField('AnimList')){
      const structs = struct.getFieldByLabel('AnimList').getChildStructs();
      for(let i = 0; i < structs.length; i++){
        let childStruct = structs[i];
        let animation = {
          animation: '',
          participant: '',
        };
        
        animation.animation = childStruct.get('Animation', animation.animation);
        
        if(childStruct.hasField('Participant')){
          animation.participant = childStruct.getFieldByLabel('Participant').getValue().toLocaleLowerCase();
        }

        node.animations.push(animation);
      }
    }

    node.text = struct.get('Text', node.text);

    if(struct.hasField('Delay')){
      node.delay = struct.getFieldByLabel('Delay').getValue() & 0xFFFFFFFF;
    }

    node.fade.type = struct.get('FadeType', node.fade.type);

    node.fade.length = struct.get('FadeLength', node.fade.length);

    node.fade.delay = struct.get('FadeDelay', node.fade.delay);

    if(struct.hasField('NodeUnskippable')){
      node.skippable = !struct.getFieldByLabel('NodeUnskippable').getValue();
    }else{
      node.skippable = true;
    }

    node.alienRaceNode = struct.get('AlienRaceNode', node.alienRaceNode);

    node.emotion = struct.get('Emotion', node.emotion);

    node.facialAnimation = struct.get('FacialAnim', node.facialAnimation);

    node.postProcessNode = struct.get('PostProcNode', node.postProcessNode);

    node.recordNoVOOverride = struct.get('RecordNoVOOverri', node.recordNoVOOverride);

    node.recordVO = struct.get('RecordVO', node.recordVO);

    if(struct.hasField('VOTextChanged')){
      node.voTextChanged = !!struct.getFieldByLabel('VOTextChanged').getValue();
    }

    return node;
  }

  getCompiledString(): string {
    let text = this.text;
    text = text.split('##')[0].replaceAll(/\{.*?\}/ig, '').trim();
    //if(this.speaker instanceof ModuleCreature){
      text = text.replace(/<FullName>/gm, GameState.PartyManager.ActualPlayerTemplate?.getFieldByLabel('FirstName')?.getValue());
      text = text.replace(/<FirstName>/gm, GameState.PartyManager.ActualPlayerTemplate?.getFieldByLabel('FirstName')?.getValue());
      text = text.replace(/<LastName>/gm, GameState.PartyManager.ActualPlayerTemplate?.getFieldByLabel('LastName')?.getValue());
      text = text.replace(/<CUSTOM(\d+)>/gm, function(match, p1, offset, string){
        return GameState.module.getCustomToken(parseInt(p1));
      });
    //}

    return text;
  }

  /**
   * Check if a dialog entry is a bark dialog node
   */
  isBarkDialog() {
    return this.replies.length == 1 /*&& !this.cameraAngle*/ && this.dialog.getReplyByIndex(this.replies[0].index).isEndDialog();
  }

  /**
   * Check if a dialog entry is a continue dialog node
   */
  isContinueDialog() {
    const parsedText = this.getCompiledString();
    if (this.nodeType == DLGNodeType.REPLY) {
      return parsedText == '' && this.entries.length;
    } else if (this.nodeType == DLGNodeType.ENTRY) {
      return parsedText == '' && this.replies.length;
    }
    return !parsedText;
  }

  /**
   * Check if a dialog entry is an end dialog node
   */
  isEndDialog() {
    const parsedText = this.getCompiledString();
    if (this.nodeType == DLGNodeType.REPLY) {
      return parsedText == '' && !this.entries.length;
    } else if (this.nodeType == DLGNodeType.ENTRY) {
      return parsedText == '' && !this.replies.length;
    }
    return !parsedText;
  }

}

