import type { GMCreatureSpawnConfig } from "@/managers/gm/GMTypes";
import { GFFObject } from "@/resource/GFFObject";
import * as THREE from "three";
import type { ModuleItem } from "@/module/ModuleItem";
import type { ModuleRoom } from "@/module/ModuleRoom";
import { AudioEmitter } from "@/audio/AudioEmitter";
import { CreatureClass } from "@/combat/CreatureClass";
import { EffectRacialType } from "@/effects";
import { GameEffectType } from "@/enums/effects/GameEffectType";
import { ModuleItemProperty } from "@/enums/module/ModuleItemProperty";
import { ModuleCreatureAnimState } from "@/enums/module/ModuleCreatureAnimState";
import { GFFDataType } from "@/enums/resource/GFFDataType";
import { GameState } from "@/GameState";
import { NWScriptInstance } from "@/nwscript/NWScriptInstance";
import { GFFField } from "@/resource/GFFField";
import { GFFStruct } from "@/resource/GFFStruct";
import { MDLLoader, ResourceLoader } from "@/loaders";
import { ResourceTypes } from "@/resource/ResourceTypes";
import { SSFObject } from "@/resource/SSFObject";
import { TalentFeat } from "@/talents/TalentFeat";
import { TalentObject } from "@/talents/TalentObject";
import { TalentSkill } from "@/talents/TalentSkill";
import { TalentSpell } from "@/talents/TalentSpell";
import { OdysseyModel3D, OdysseyObject3D } from "@/three/odyssey";
import { OdysseyModel, OdysseyModelAnimation } from "@/odyssey";
import { EquipmentSlots } from "@/module/creature/EquipmentSlots";
import type { CreatureEquipment } from "@/module/creature/EquipmentSlots";
import { ModuleCreatureArmorSlot } from "@/enums/module/ModuleCreatureArmorSlot";
import { LIPObject } from "@/resource/LIPObject";
import { Utility } from "@/utility/Utility";
import { EngineMode } from "@/enums/engine/EngineMode";
import { SSFType } from "@/enums/resource/SSFType";
import { ActionType } from "@/enums/actions/ActionType";
import { ActionParameterType } from "@/enums/actions/ActionParameterType";
import EngineLocation from "@/engine/EngineLocation";
import { AttackResult } from "@/enums/combat/AttackResult";
import { DLGObject } from "@/resource/DLGObject";
import { ITwoDAAnimation } from "@/interface/twoDA/ITwoDAAnimation";
import { SWCreatureAppearance } from "@/engine/rules/SWCreatureAppearance";
import { ICreatureAnimationState } from "@/interface/animation/ICreatureAnimationState";
import { IOverlayAnimationState } from "@/interface/animation/IOverlayAnimationState";
import { WeaponWield } from "@/enums/combat/WeaponWield";
import { AutoPauseState } from "@/enums/engine/AutoPauseState";
import { AudioEngine } from "@/audio/AudioEngine";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { GameEffectDurationType } from "@/enums/effects/GameEffectDurationType";
import { BitWise } from "@/utility/BitWise";
import { ModuleObjectConstant } from "@/enums/module/ModuleObjectConstant";
import { PerceptionType } from "@/enums/engine/PerceptionType";
import { AudioEmitterType } from "@/enums/audio/AudioEmitterType";
import { AudioPriorityGroup } from "@/enums/audio/AudioPriorityGroup";
import { CombatActionType } from "@/enums/combat/CombatActionType";
import { CombatRoundAction } from "@/combat";
import { GameEffectFactory } from "@/effects/GameEffectFactory";
import type { Action } from "@/actions/Action";
import { ModuleTriggerType } from "@/enums/module/ModuleTriggerType";
import { SkillType } from "@/enums/nwscript/SkillType";
import { EngineDebugType } from "@/enums/engine/EngineDebugType";
import { TextSprite3D } from "@/engine/TextSprite3D";
import { UIIconTimerType } from "@/enums/engine/UIIconTimerType";
import { ExperienceType } from "@/enums/engine/ExperienceType";
import { ModuleObjectScript } from "@/enums/module/ModuleObjectScript";
import { TalentObjectType } from "@/enums/engine/TalentObjectType";
import { CombatFeatType } from "@/enums/combat/CombatFeatType";
import type { ModuleCreature } from "@/module/ModuleCreature";

/**
 * Reading a creature from its template (its UTC blueprint merged under the data it was placed or saved
 * with) and writing it back out as a GFF.
 */
export class CreatureTemplate {

  /** Set a creature's properties from its template */
  static read(creature: ModuleCreature){
    try{
      creature.classes = [];
      creature.feats = [];
      creature.skills = GameState.SWRuleSet.skills.slice(0).map((skill: TalentSkill) => {
        return skill.clone();
      });
      
      if(!creature.initialized){
        if(BitWise.InstanceOfObject(creature, ModuleObjectType.ModulePlayer)){
          creature.id = GameState.ModuleObjectManager.GetNextPlayerId();
        }else if(creature.template.RootNode.hasField('ObjectId')){
          creature.id = creature.template.getFieldByLabel('ObjectId').getValue();
        }else if(creature.template.RootNode.hasField('ID')){
          creature.id = creature.template.getFieldByLabel('ID').getValue();
        }
        
        GameState.ModuleObjectManager.AddObjectById(creature);
      }

      if(creature.template.RootNode.hasField('Appearance_Type')){
        creature.setAppearance(creature.template.getFieldByLabel('Appearance_Type').getValue());
      }

      creature.bodyBag = creature.template.RootNode.get('BodyBag', creature.bodyBag);

      creature.bodyVariation = creature.template.RootNode.get('BodyVariation', creature.bodyVariation);

      creature.challengeRating = creature.template.RootNode.get('ChallengeRating', creature.challengeRating);

      if(creature.template.RootNode.hasField('ClassList')){
        let classes = creature.template.RootNode.getFieldByLabel('ClassList').getChildStructs();
        for(let i = 0; i < classes.length; i++){
          creature.classes.push(
            CreatureClass.FromCreatureClassStruct(classes[i])
          );
        }
      }

      if(creature.template.RootNode.hasField('Conversation')){
        creature.conversation = DLGObject.FromResRef(creature.template.getFieldByLabel('Conversation').getValue());
      }

      creature.currentForce = creature.template.RootNode.get('CurrentForce', creature.currentForce);

      creature.currentHitPoints = creature.template.RootNode.get('CurrentHitPoints', creature.currentHitPoints);

      creature.hitPoints = creature.template.RootNode.get('HitPoints', creature.hitPoints);

      creature.disarmable = creature.template.RootNode.get('Disarmable', creature.disarmable);
    
      creature.experience = creature.template.RootNode.get('Experience', creature.experience);

      if(creature.template.RootNode.hasField('Listening')){
        creature.setListening(creature.template.RootNode.getFieldByLabel('Listening').getValue());
      }
      if(creature.template.RootNode.hasField('Commandable')){
        creature.setCommadable(creature.template.RootNode.getFieldByLabel('Commandable').getValue());
      }

      if(creature.template.RootNode.hasField('ExpressionList')){
        let expressions = creature.template.RootNode.getFieldByLabel('ExpressionList').getChildStructs();
        for(let i = 0; i < expressions.length; i++){
          creature.setListeningPattern(
            expressions[i].getFieldByLabel('ExpressionString').getValue(),
            expressions[i].getFieldByLabel('ExpressionId').getValue()
          );
        }
      }
          
      if(creature.template.RootNode.hasField('FactionID')){
        creature.factionId = creature.template.getFieldByLabel('FactionID').getValue();
        if((creature.factionId & 0xFFFFFFFF) == -1){
          creature.factionId = 0;
        }
      }
      creature.faction = GameState.FactionManager.factions.get(creature.factionId);

      if(creature.template.RootNode.hasField('FeatList')){
        let feats = creature.template.RootNode.getFieldByLabel('FeatList').getChildStructs();
        for(let i = 0; i < feats.length; i++){
          creature.feats.push(
            new TalentFeat( feats[i].getFieldByLabel('Feat').getValue() )
          );
        }
      }

      creature.firstName = creature.template.RootNode.get('FirstName', creature.firstName);
      
      creature.forcePoints = creature.template.RootNode.get('ForcePoints', creature.forcePoints);
          
      creature.gender = creature.template.RootNode.get('Gender', creature.gender);
    
      creature.goodEvil = creature.template.RootNode.get('GoodEvil', creature.goodEvil);
        
      creature.isHologram = creature.template.RootNode.get('Hologram', creature.isHologram);

      creature.interruptable = creature.template.RootNode.get('Interruptable', creature.interruptable);

      creature.isPC = creature.template.RootNode.get('IsPC', creature.isPC);

      creature.lastName = creature.template.RootNode.get('LastName', creature.lastName);

      creature.maxHitPoints = creature.template.RootNode.get('MaxHitPoints', creature.maxHitPoints);

      creature.maxForcePoints = creature.template.RootNode.get('MaxForcePoints', creature.maxForcePoints);

      creature.min1HP = creature.template.RootNode.get('Min1HP', creature.min1HP);

      creature.naturalAC = creature.template.RootNode.get('NaturalAC', creature.naturalAC);

      creature.noPermDeath = creature.template.RootNode.get('NoPermDeath', creature.noPermDeath);

      creature.notReorienting = creature.template.RootNode.get('NotReorienting', creature.notReorienting);

      creature.partyInteract = creature.template.RootNode.get('PartyInteract', creature.partyInteract);

      if(creature.template.RootNode.hasField('PerceptionRange')){
        creature.perceptionRange = GameState.SWRuleSet.ranges[creature.template.getFieldByLabel('PerceptionRange').getValue()];
      }else{
        //https://forum.neverwintervault.org/t/perception-range/3191/9
        //It appears that PerceptionRange isn't saved inside the GIT file.
        //The original game appears to use PercepRngDefault when a creature is reloaded from a SaveGame
        creature.perceptionRange = GameState.SWRuleSet.ranges[11];
      }

      creature.phenotype = creature.template.RootNode.get('Phenotype', creature.phenotype);

      creature.plot = creature.template.RootNode.get('Plot', creature.plot);

      if(creature.template.RootNode.hasField('PortraitId')){
        creature.portraitId = creature.template.getFieldByLabel('PortraitId').getValue();
        creature.portrait = GameState.SWRuleSet.portraits[creature.portraitId];
      }
    
      creature.race = creature.template.RootNode.get('Race', creature.race);

      if(creature.template.RootNode.hasField('SkillList')){
        let skills = creature.template.RootNode.getFieldByLabel('SkillList').getChildStructs();
        for(let i = 0; i < skills.length; i++){
          creature.skills[i].rank = skills[i].getFieldByLabel('Rank').getValue();
        }
      }

      creature.soundSetFile = creature.template.RootNode.get('SoundSetFile', creature.soundSetFile);
    
      creature.subrace = creature.template.RootNode.get('SubRace', creature.subrace);

      creature.initCommonProperties();

      creature.textureVar = creature.template.RootNode.get('TextureVar', creature.textureVar);

      creature.walkRate = creature.template.RootNode.get('WalkRate', creature.walkRate);

      creature.str = creature.template.RootNode.get('Str', creature.str);
    
      creature.dex = creature.template.RootNode.get('Dex', creature.dex);
    
      creature.con = creature.template.RootNode.get('Con', creature.con);
    
      creature.cha = creature.template.RootNode.get('Cha', creature.cha);
    
      creature.wis = creature.template.RootNode.get('Wis', creature.wis);
    
      creature.int = creature.template.RootNode.get('Int', creature.int);

      creature.fortitudeSaveThrow = creature.template.RootNode.get('FortSaveThrow', creature.fortitudeSaveThrow);

      creature.reflexSaveThrow = creature.template.RootNode.get('RefSaveThrow', creature.reflexSaveThrow);

      creature.willSaveThrow = creature.template.RootNode.get('WillSaveThrow', creature.willSaveThrow);

        creature.subraceIndex = creature.template.RootNode.get('SubraceIndex', creature.subraceIndex);

      if(creature.template.RootNode.hasField('SWVarTable')){
        let localBools = creature.template.RootNode.getFieldByLabel('SWVarTable').getChildStructs()[0].getFieldByLabel('BitArray').getChildStructs();
        //console.log(localBools);
        for(let i = 0; i < localBools.length; i++){
          let data = localBools[i].getFieldByLabel('Variable').getValue();
          for(let bit = 0; bit < 32; bit++){
            creature._locals.Booleans[bit + (i*32)] = ( (data>>bit) % 2 != 0);
          }
        }
        let localNumbers = creature.template.RootNode.getFieldByLabel('SWVarTable').getChildStructs()[0].getFieldByLabel('ByteArray').getChildStructs();
        //console.log(localNumbers);
        for(let i = 0; i < localNumbers.length; i++){
          let data = localNumbers[i].getFieldByLabel('Variable').getValue();
          creature.setLocalNumber(i, data);
        }
      }

      creature.pm_Appearance = creature.template.RootNode.get('PM_Appearance', creature.pm_Appearance);

      if(creature.template.RootNode.hasField('PM_IsDisguised'))
        creature.pm_IsDisguised = !!creature.template.RootNode.getFieldByLabel('PM_IsDisguised').getValue();

      try{
        if(creature.template.RootNode.hasField('EffectList')){
          let effects = creature.template.RootNode.getFieldByLabel('EffectList').getChildStructs() || [];
          for(let i = 0; i < effects.length; i++){
            let effect = GameEffectFactory.EffectFromStruct(effects[i]);
            if(effect){
              effect.setAttachedObject(creature);
              effect.loadModel();
              //console.log('attached');
              creature.effects.push(effect);
              //creature.addEffect(effect);
            }
          }
        }
      }catch(e: any){
        console.error(e);
      }

      try{
        if(creature.template.RootNode.hasField('Equip_ItemList')){
          let equipment = creature.template.RootNode.getFieldByLabel('Equip_ItemList').getChildStructs() || [];
          for(let i = 0; i < equipment.length; i++){
            let strt = equipment[i];
            let equipped_item = undefined;
            let slot_type = strt.type;
            if(strt.hasField('EquippedRes')){
              equipped_item = new GameState.Module.ModuleArea.ModuleItem(strt.getFieldByLabel('EquippedRes').getValue());
            }else{
              equipped_item = new GameState.Module.ModuleArea.ModuleItem(GFFObject.FromStruct(strt));
            }
            
            const slotKey = EquipmentSlots.keyOf(slot_type);
            if(slotKey){
              creature.equipment[slotKey] = equipped_item;
            }else{
              console.warn('ModuleCreature.initProperties', 'Unhandled Equipment Slot', equipped_item);
            }
          }
        }
      }catch(e: any){
        console.error(e);
      }

      creature.parseEquipmentSlots();

      if(creature.template.RootNode.hasField('ItemList')){
        const inventory = creature.template.RootNode.getFieldByLabel('ItemList').getChildStructs();
        for(let i = 0; i < inventory.length; i++){
          creature.loadItem(GFFObject.FromStruct(inventory[i]));
        }
      }
      creature.loadSoundSet();

      //ActionList
      try{
        if(creature.template.RootNode.hasField('ActionList')){
          const actionStructs = creature.template.RootNode.getFieldByLabel('ActionList').getChildStructs();
          for(let i = 0, len = actionStructs.length; i < len; i++){
            const action = GameState.ActionFactory.FromStruct(actionStructs[i]);
            if(action){
              creature.actionQueue.add(action);
            }
          }
        }
      }catch(e: any){
        console.error(e);
      }

      //PerceptionList
      try{
        if(creature.template.RootNode.hasField('PerceptionList')){
          let perceptionList = creature.template.RootNode.getFieldByLabel('PerceptionList').getChildStructs();
          if(perceptionList.length){
            creature.perceptionList = [];
          }

          for(let i = 0, len = perceptionList.length; i < len; i++){
            const perception = perceptionList[i];

            const objectId = perception.getFieldByLabel('ObjectId').getValue();
            const data = perception.getFieldByLabel('PerceptionData').getValue() as PerceptionType;

            creature.perceptionList.push({
              object: undefined,
              objectId: objectId,
              data: data
            });
          }
        }
      }catch(e: any){
        console.error(e);
      }
    }catch(e: any){
      console.error(e);
    }

    if(creature.template.RootNode.hasField('Animation')){
      creature.setAnimationState(
        creature.template.getFieldByLabel('Animation').getValue()
      );
    }

    creature.initialized = true;

  }

  /** The creature as a GFF: its struct in a module's creature list or a save game */
  static write(creature: ModuleCreature){

    let gff = new GFFObject();
    gff.FileType = 'UTC ';
    
    gff.RootNode.addDWord('ObjectId', creature.id);
    gff.RootNode.addCExoString('Mod_CommntyName', 'Bad StrRef');
    if(creature.playerCreated){
      gff.RootNode.addByte('Mod_IsPrimaryPlr', 1);
    }
    
    gff.RootNode.addField( new GFFField(GFFDataType.CEXOLOCSTRING, 'Mod_FirstName') )
    gff.RootNode.addField( new GFFField(GFFDataType.CEXOLOCSTRING, 'Mod_LastName') )

    gff.RootNode.addInt('AIState', 0);

    gff.RootNode.addField( creature.actionQueueToActionList() );

    gff.RootNode.addInt('Age', 0);
    gff.RootNode.addByte('AmbientAnimState', 0);
    gff.RootNode.addInt('Animation', creature.animationState.index);
    //gff.RootNode.addByte('Appearance_Head', 1);
    gff.RootNode.addWord('Appearance_Type', creature.appearance);
    //gff.RootNode.addDWord('AreaId', 1);
    gff.RootNode.addShort('ArmorClass', creature.getAC());
    gff.RootNode.addByte('BodyBag', creature.bodyBag);
    gff.RootNode.addByte('Cha', creature.cha);
    gff.RootNode.addFloat('ChallengeRating', creature.challengeRating);

    //Classes
    let classList = gff.RootNode.addField( new GFFField(GFFDataType.LIST, 'ClassList') );
    for(let i = 0; i < creature.classes.length; i++){
      classList.addChildStruct( creature.classes[i].save() );
    }
    
    gff.RootNode.addByte('Color_Hair', 0);
    gff.RootNode.addByte('Color_Skin', 0);
    gff.RootNode.addByte('Color_Tattoo1', 0);
    gff.RootNode.addByte('Color_Tattoo2', 0);

    let combatInfoStruct = gff.RootNode.addField( new GFFField(GFFDataType.STRUCT, 'CombatInfo') );

    //TODO: CombatInfo

    let combatRoundDataStruct = gff.RootNode.addField( new GFFField(GFFDataType.STRUCT, 'CombatRoundData') );

    //TODO: CombatRoundData

    gff.RootNode.addByte('Commandable', creature.getCommadable() ? 1 : 0);
    gff.RootNode.addByte('Con', creature.con);
    gff.RootNode.addRESREF('Conversation', creature.conversation ? creature.conversation.resref : '');
    gff.RootNode.addByte('CreatnScrptFird',  creature.spawned ? 1 : 0 );
    gff.RootNode.addInt('CreatureSize', 3);
    gff.RootNode.addShort('CurrentForce', creature.currentForce);
    gff.RootNode.addShort('CurrentHitPoints', creature.currentHitPoints);
    gff.RootNode.addByte('DeadSelectable', 1);
    gff.RootNode.addCExoString('Deity', '');
    //gff.RootNode.addField( new GFFField(GFFDataType.CEXOLOCSTRING, 'Description') ).setValue();
    gff.RootNode.addByte('DetectMode', 1);
    gff.RootNode.addByte('Dex', creature.dex);
    gff.RootNode.addByte('Disarmable', 1);
    gff.RootNode.addByte('DuplicatingHead', 255);
    
    //Effects
    let effectList = gff.RootNode.addField( new GFFField(GFFDataType.LIST, 'EffectList') );
    for(let i = 0; i < creature.effects.length; i++){
      effectList.addChildStruct( creature.effects[i].save() );
    }

    //Equipment
    let equipItemList = gff.RootNode.addField( new GFFField(GFFDataType.LIST, 'Equip_ItemList') );
    for(const key of EquipmentSlots.ALL){
      const item = creature.equipment[key];
      if(!item){ continue; }
      const equipItem = item.save();
      equipItem.setType(EquipmentSlots.slotOf(key));
      equipItemList.addChildStruct(equipItem);
    }

    gff.RootNode.addDWord('Experience', creature.experience);
    
    let expressionList = gff.RootNode.addField( new GFFField(GFFDataType.LIST, 'ExpressionList') );
    let expressions = Object.keys(creature.listeningPatterns);
    for(let i = 0; i < expressions.length; i++){
      let expressionString = expressions[i];
      let expressionId = creature.listeningPatterns[expressionString];

      let expressionStruct = new GFFStruct();
      expressionStruct.addInt('ExpressionId',  expressionId );
      expressionStruct.addCExoString('ExpressionString',  expressionString );
      expressionList.addChildStruct(expressionStruct);
    }

    gff.RootNode.addWord('FactionID', creature.faction ? creature.faction.id : creature.factionId);

    //Feats
    let featList = gff.RootNode.addField( new GFFField(GFFDataType.LIST, 'FeatList') );
    for(let i = 0; i < creature.feats.length; i++){
      featList.addChildStruct( creature.feats[i].save() );
    }

    gff.RootNode.addField( new GFFField(GFFDataType.CEXOLOCSTRING, 'FirstName') ).setValue( creature.template.RootNode.getFieldByLabel('FirstName')?.getCExoLocString() );
    gff.RootNode.addShort('ForcePoints', creature.forcePoints);
    gff.RootNode.addField( new GFFField(GFFDataType.CHAR, 'FortSaveThrow') ).setValue(creature.fortitudeSaveThrow);
    gff.RootNode.addByte('Gender', creature.gender);
    gff.RootNode.addDWord('Gold', 0);
    gff.RootNode.addByte('GoodEvil', creature.goodEvil);
    gff.RootNode.addShort('HitPoints', creature.hitPoints);
    gff.RootNode.addByte('Int', creature.int);
    gff.RootNode.addByte('Interruptable', creature.interruptable ? 1 : 0);
    gff.RootNode.addByte('IsDestroyable', 1);
    gff.RootNode.addByte('IsPC',  creature.playerCreated ? 1 : 0);
    gff.RootNode.addByte('IsRaiseable', 1);
    if(creature.playerCreated){
      gff.RootNode.addInt('PlayerCreated', 1);
    }

    //Creature Inventory
    let itemList = gff.RootNode.addField( new GFFField(GFFDataType.LIST, 'ItemList') );
    for(let i = 0; i < creature.inventory.length; i++){
      let itemStruct = creature.inventory[i].save();
      itemList.addChildStruct(itemStruct);
    }

    gff.RootNode.addInt('JoiningXP',  creature.joiningXP ? creature.joiningXP : 0 );
    gff.RootNode.addField( new GFFField(GFFDataType.CEXOLOCSTRING, 'LastName') ).setValue( creature.template.RootNode.getFieldByLabel('LastName')?.getCExoLocString() );
    gff.RootNode.addByte('Listening',  creature.isListening );

    gff.RootNode.addShort('MaxForcePoints', creature.maxForcePoints);
    gff.RootNode.addShort('MaxHitPoints', creature.maxHitPoints);
    gff.RootNode.addByte('Min1HP', creature.min1HP);
    gff.RootNode.addByte('MovementRate', 0);
    gff.RootNode.addByte('NaturalAC', creature.naturalAC);
    gff.RootNode.addByte('NotReorienting', creature.notReorienting);

    gff.RootNode.addByte('PM_IsDisguised',  creature.hasEffect(GameEffectType.EffectDisguise) ? 1 : 0 );
    if( creature.hasEffect(GameEffectType.EffectDisguise) ){
      gff.RootNode.addWord('PM_Appearance',  creature.appearance );
    }

    gff.RootNode.addByte('PartyInteract', creature.partyInteract);

    //Save PerceptionLists
    let perceptionList = gff.RootNode.addField( new GFFField(GFFDataType.LIST, 'PerceptionList') );
    for(let i = 0; i < creature.perceptionList.length; i++){
      let percept = creature.perceptionList[i];

      let perceptionStruct = new GFFStruct();
      perceptionStruct.addDWord('ObjectId',  percept.objectId );
      perceptionStruct.addByte('PerceptionData',  (percept.data & 0xFF) );
      perceptionList.addChildStruct(perceptionStruct);
    }

    gff.RootNode.addByte('PerceptionRange', creature.perceptionRange?.id || 0);

    gff.RootNode.addInt('Phenotype', creature.phenotype);
    gff.RootNode.addByte('Plot', 0);
    gff.RootNode.addWord('PortraitId', creature.portraitId);
    gff.RootNode.addShort('PregameCurrent', 28);
    gff.RootNode.addByte('Race', creature.race);
    gff.RootNode.addField( new GFFField(GFFDataType.CHAR, 'RefSaveThrow') ).setValue(creature.reflexSaveThrow);

    let swVarTable = gff.RootNode.addField( new GFFField(GFFDataType.STRUCT, 'SWVarTable') );
    swVarTable.addChildStruct( creature.getSWVarTableSaveStruct() );

    //Scripts
    creature.saveScripts(gff.RootNode);

    //Skills
    let skillList = gff.RootNode.addField( new GFFField(GFFDataType.LIST, 'SkillList') );
    for(let i = 0; i < 8; i++){
      skillList.addChildStruct( creature.skills[i].save() );
    }

    gff.RootNode.addWord('SkillPoints',  creature.skillPoints ? creature.skillPoints : 0);
    gff.RootNode.addWord('SoundSetFile', creature.soundSetFile);
    gff.RootNode.addByte('StartingPackage', 0);
    gff.RootNode.addByte('StealthMode', 0);
    gff.RootNode.addByte('Str', creature.str);
    gff.RootNode.addCExoString('Subrace', '');
    gff.RootNode.addByte('SubraceIndex', creature.subrace);
    gff.RootNode.addCExoString('Tag', creature.tag);
    gff.RootNode.addByte('Tail', 0);
    gff.RootNode.addByte('UseBackupHead', 0);
    let varTable = gff.RootNode.addField( new GFFField(GFFDataType.LIST, 'VarTable') );
    gff.RootNode.addField( new GFFField(GFFDataType.CHAR, 'WillSaveThrow') ).setValue(creature.willSaveThrow);
    gff.RootNode.addByte('Wings', 0);
    gff.RootNode.addByte('Wis', creature.wis);

    gff.RootNode.addFloat('XPosition',  creature.position.x );
    gff.RootNode.addFloat('YPosition',  creature.position.y );
    gff.RootNode.addFloat('ZPosition',  creature.position.z );

    let theta = creature.rotation.z * Math.PI;

    gff.RootNode.addFloat('XOrientation',  1 * Math.cos(theta) );
    gff.RootNode.addFloat('YOrientation',  1 * Math.sin(theta) );
    gff.RootNode.addFloat('ZOrientation',  0 );

    gff.RootNode.addShort('fortbonus', creature.fortbonus);
    gff.RootNode.addShort('refbonus', creature.refbonus);
    gff.RootNode.addShort('refbonus', creature.refbonus);

    creature.template = gff;

    if(creature.npcId >= 0){
      GameState.PartyManager.NPCS[creature.npcId].template = creature.template;
    }

    return gff;

  }

  /** A blank creature template */
  static generate(): GFFObject {
    let template = new GFFObject();
    template.FileType = 'UTC ';

    template.RootNode.addField( new GFFField(GFFDataType.WORD, 'Appearance_Type') );
    template.RootNode.addField( new GFFField(GFFDataType.BYTE, 'BodyBag') );
    template.RootNode.addField( new GFFField(GFFDataType.BYTE, 'BodyVariation') );
    template.RootNode.addField( new GFFField(GFFDataType.BYTE, 'Cha') );
    template.RootNode.addField( new GFFField(GFFDataType.FLOAT, 'ChallengeRating') );
    template.RootNode.addField( new GFFField(GFFDataType.LIST, 'ClassList') );
    template.RootNode.addField( new GFFField(GFFDataType.CEXOSTRING, 'Comment') );
    template.RootNode.addField( new GFFField(GFFDataType.BYTE, 'Con') );
    template.RootNode.addField( new GFFField(GFFDataType.RESREF, 'Conversation') );
    template.RootNode.addField( new GFFField(GFFDataType.SHORT, 'CurrentForce') );
    template.RootNode.addField( new GFFField(GFFDataType.SHORT, 'CurrentHitPoints') );
    template.RootNode.addField( new GFFField(GFFDataType.CEXOSTRING, 'Deity') );
    template.RootNode.addField( new GFFField(GFFDataType.CEXOLOCSTRING, 'Description') );
    template.RootNode.addField( new GFFField(GFFDataType.BYTE, 'Dex') );
    template.RootNode.addField( new GFFField(GFFDataType.BYTE, 'Disarmable') );
    template.RootNode.addField( new GFFField(GFFDataType.LIST, 'Equip_ItemList') );
    template.RootNode.addField( new GFFField(GFFDataType.WORD, 'FactionID') );
    template.RootNode.addField( new GFFField(GFFDataType.LIST, 'FeatList') );
    template.RootNode.addField( new GFFField(GFFDataType.CEXOLOCSTRING, 'FirstName') );
    template.RootNode.addField( new GFFField(GFFDataType.SHORT, 'ForcePoints') );
    template.RootNode.addField( new GFFField(GFFDataType.BYTE, 'Gender') );
    template.RootNode.addField( new GFFField(GFFDataType.BYTE, 'GoodEvil') );
    template.RootNode.addField( new GFFField(GFFDataType.SHORT, 'HitPoints') );
    template.RootNode.addField( new GFFField(GFFDataType.BYTE, 'Int') );
    template.RootNode.addField( new GFFField(GFFDataType.BYTE, 'Interruptable') );
    template.RootNode.addField( new GFFField(GFFDataType.BYTE, 'IsPC') );
    template.RootNode.addField( new GFFField(GFFDataType.CEXOLOCSTRING, 'LastName') );
    template.RootNode.addField( new GFFField(GFFDataType.BYTE, 'LawfulChaotic') );
    template.RootNode.addField( new GFFField(GFFDataType.SHORT, 'MaxHitPoints') );
    template.RootNode.addField( new GFFField(GFFDataType.BYTE, 'Min1HP') );
    template.RootNode.addField( new GFFField(GFFDataType.BYTE, 'NaturalAC') );
    template.RootNode.addField( new GFFField(GFFDataType.BYTE, 'NoPermDeath') );
    template.RootNode.addField( new GFFField(GFFDataType.BYTE, 'NotReorienting') );
    template.RootNode.addByte('PalletID', 4);
    template.RootNode.addField( new GFFField(GFFDataType.BYTE, 'PartyInteract') );
    template.RootNode.addField( new GFFField(GFFDataType.BYTE, 'PerceptionRange') );
    template.RootNode.addField( new GFFField(GFFDataType.INT, 'Phenotype') );
    template.RootNode.addField( new GFFField(GFFDataType.BYTE, 'Plot') );
    template.RootNode.addField( new GFFField(GFFDataType.WORD, 'PortraitId') );
    template.RootNode.addField( new GFFField(GFFDataType.BYTE, 'Race') );
    template.RootNode.addField( new GFFField(GFFDataType.RESREF, 'ScriptAttacked') );
    template.RootNode.addField( new GFFField(GFFDataType.RESREF, 'ScriptDamaged') );
    template.RootNode.addField( new GFFField(GFFDataType.RESREF, 'ScriptDeath') );
    template.RootNode.addField( new GFFField(GFFDataType.RESREF, 'ScriptDialogue') );
    template.RootNode.addField( new GFFField(GFFDataType.RESREF, 'ScriptDisturbed') );
    template.RootNode.addField( new GFFField(GFFDataType.RESREF, 'ScriptEndDialogu') );
    template.RootNode.addField( new GFFField(GFFDataType.RESREF, 'ScriptEndRound') );
    template.RootNode.addField( new GFFField(GFFDataType.RESREF, 'ScriptHeartbeat') );
    template.RootNode.addField( new GFFField(GFFDataType.RESREF, 'ScriptOnBlocked') );
    template.RootNode.addField( new GFFField(GFFDataType.RESREF, 'ScriptOnNotice') );
    template.RootNode.addField( new GFFField(GFFDataType.RESREF, 'ScriptRested') );
    template.RootNode.addField( new GFFField(GFFDataType.RESREF, 'ScriptSpawn') );
    template.RootNode.addField( new GFFField(GFFDataType.RESREF, 'ScriptSpellAt') );
    template.RootNode.addField( new GFFField(GFFDataType.RESREF, 'ScriptUserDefine') );
    let skillList = template.RootNode.addField( new GFFField(GFFDataType.LIST, 'SkillList') );
    template.RootNode.addField( new GFFField(GFFDataType.WORD, 'SoundSetFile') )
    template.RootNode.addField( new GFFField(GFFDataType.LIST, 'SpecAbilityList') );
    template.RootNode.addField( new GFFField(GFFDataType.BYTE, 'Str') );
    template.RootNode.addField( new GFFField(GFFDataType.CEXOSTRING, 'Subrace') );
    template.RootNode.addField( new GFFField(GFFDataType.BYTE, 'SubraceIndex') );
    template.RootNode.addField( new GFFField(GFFDataType.CEXOSTRING, 'Tag') );
    template.RootNode.addField( new GFFField(GFFDataType.LIST, 'TemplateList') );
    template.RootNode.addField( new GFFField(GFFDataType.RESREF, 'TemplateResRef') );
    template.RootNode.addField( new GFFField(GFFDataType.BYTE, 'TextureVar') );
    template.RootNode.addField( new GFFField(GFFDataType.INT, 'WalkRate') );
    template.RootNode.addField( new GFFField(GFFDataType.BYTE, 'Wis') );
    template.RootNode.addField( new GFFField(GFFDataType.SHORT, 'fortbonus') );
    template.RootNode.addField( new GFFField(GFFDataType.SHORT, 'refbonus') );
    template.RootNode.addField( new GFFField(GFFDataType.SHORT, 'willbonus') );

    for(let i = 0; i < 8; i++){
      let _skill = new GFFStruct();
      _skill.addByte('Rank', 0);
      skillList.addChildStruct(_skill);
    }

    return template;
  }

}
