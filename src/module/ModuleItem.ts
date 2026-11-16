import { ModuleObject } from "@/module/ModuleObject";
import type { ModuleCreature } from "@/module/ModuleCreature";
import { BaseItem } from "@/engine/BaseItem";
import { EffectDisguise } from "@/effects/EffectDisguise";
import { WeaponWield } from "@/enums/combat/WeaponWield";
import { WeaponType } from "@/enums/combat/WeaponType";
import { GameEffectType } from "@/enums/effects/GameEffectType";
import { ModuleItemProperty } from "@/enums/module/ModuleItemProperty";
import { GFFDataType } from "@/enums/resource/GFFDataType";
import { GFFField } from "@/resource/GFFField";
import { GFFObject } from "@/resource/GFFObject";
import { GFFStruct } from "@/resource/GFFStruct";
import { MDLLoader, ResourceLoader } from "@/loaders";
import { ResourceTypes } from "@/resource/ResourceTypes";
import { TalentSpell } from "@/talents";
import { OdysseyModel3D } from "@/three/odyssey";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { CombatFeatType } from "@/enums/combat/CombatFeatType";
import { BitWise } from "@/utility/BitWise";
import { Dice } from "@/utility/Dice";
import { ItemProperty } from "@/engine/ItemProperty";
import { GameState } from "@/GameState";
import { ActionParameterType, GameEffectDurationType, ModuleCreatureAnimState, SkillType } from "@/enums";
import type { SWWeaponSound } from "@/engine/rules/SWWeaponSound";

/**
* ModuleItem class.
* 
* Class representing an item found in module areas, placeable, creatures, etc...
* 
* KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
* 
* @file ModuleItem.ts
* @author KobaltBlu <https://github.com/KobaltBlu>
* @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
* @memberof KotOR
*/
export class ModuleItem extends ModuleObject {
  equippedRes: any;
  baseItemId: number;
  baseItem: BaseItem;
  addCost: number;
  cost: number;
  modelVariation: number;
  textureVariation: number;
  palleteID: number;
  loaded: boolean;
  properties: ItemProperty[];
  possessor: any;
  descIdentified: any;
  stolen: any;
  infinite: any;
  inventoryRes: any;
  stackSize: any;
  charges: any;
  deleting: any;
  dropable: any;
  identified: any;
  maxCharges: any;
  newItem: any;
  nonEquippable: any;
  pickpocketable: any;

  upgradeItems: any = {};
  upgrades: number = 0;
  upgradeLevel: number = 0;
  upgradeSlot0: number = -1;
  upgradeSlot1: number = -1;
  upgradeSlot2: number = -1;
  upgradeSlot3: number = -1;
  upgradeSlot4: number = -1;
  upgradeSlot5: number = -1;
  weaponSound: SWWeaponSound;

  constructor ( gff = new GFFObject() ) {
    super();
    this.objectType |= ModuleObjectType.ModuleItem;

    if(typeof gff === 'string'){
      this.equippedRes = gff;
      this.template = new GFFObject();
      this.template.RootNode.addRESREF('EquippedRes', gff);
    }else{
      this.template = gff;
    }

    // if(gff instanceof GFFObject && gff.RootNode.hasField('ObjectId')){
    //   this.id = gff.getFieldByLabel('ObjectId').getValue();
    // }else if(gff instanceof GFFObject && gff.RootNode.hasField('ID')){
    //   this.id = gff.getFieldByLabel('ID').getValue();
    // }else{
    //   this.id = -1;
    // }

    //this.id = -1;

    this.baseItemId = 0;
    this.addCost = 0;
    this.cost = 0;
    this.modelVariation = 0;
    this.textureVariation = 1;
    this.palleteID = 0;
    this.stackSize = 1;
    this.loaded = false;
    this.properties = [];
    this.upgradeItems = {};
    this.placedInWorld = false;
    this.possessor = undefined;

    this.initProperties();

  }

  clone(): ModuleItem {
    const nItem = new ModuleItem(this.template);
    nItem.initProperties();
    if(nItem.template){
      nItem.template.getFieldByLabel('StackSize')?.setValue(1);
    }
    nItem.stackSize = 1;
    return nItem;
  }

  update(delta = 0){
    if(this.model instanceof OdysseyModel3D)
      this.model.update(delta);
  }

  getDescription(){
    return this.descIdentified;
  }

  getBaseItemId(): number {
    return this.baseItemId;
  }

  getBaseItem(): BaseItem {
    return this.baseItem;
  }

  getBodyVariation(){
    return this.baseItem.bodyVar;
  }

  getModelVariation(){
    return this.modelVariation || 1;
  }

  getTextureVariation(){
    return this.textureVariation || 1;
  }

  getIcon(){
    return 'i'+this.baseItem.itemClass+'_'+("000" + this.getModelVariation()).slice(-3);
  }

  getWeaponWield(): WeaponWield{
    return this.baseItem.weaponWield;
  }

  getWeaponType(): WeaponType {
    return this.baseItem.weaponType;
  }

  isRangedWeapon(){
    return this.baseItem.rangedWeapon;
  }

  isStolen(){
    return this.stolen;
  }

  isInfinite(){
    return this.infinite;
  }

  getPropertiesList(){
    if(this.template.RootNode.hasField('PropertiesList')){
      return this.template.RootNode.getFieldByLabel('PropertiesList').getChildStructs();
    }
    return null;
  }

  isDisguise(){
    for(let i = 0, len = this.properties.length; i < len; i++){
      let property = this.properties[i];
      if(property.isUseable() && property.is(ModuleItemProperty.Disguise)){
        return true;
      }
    }
    return false;
  }

  getDisguiseAppearance(){
    for(let i = 0, len = this.properties.length; i < len; i++){
      let property = this.properties[i];
      if(property.isUseable() && property.is(ModuleItemProperty.Disguise)){
        return property.getValue();
      }
    }
    return 0;
  }

  getDisguiseAppearanceId(){
    for(let i = 0, len = this.properties.length; i < len; i++){
      let property = this.properties[i];
      if(property.isUseable() && property.is(ModuleItemProperty.Disguise)){
        return property.subType;
      }
    }
    return -1;
  }

  getName(){
    return this.getLocalizedName();
  }

  getEquippedRes(){
    return this.equippedRes;
  }

  getInventoryRes(){
    return this.inventoryRes;
  }

  getStackSize(){
    return this.stackSize || 1;
  }

  setStackSize(value: number){
    return this.stackSize = value;
  }

  getLocalizedName(){
    return this.localizedName?.getValue ? (this.localizedName.getValue() || '').replace(/\0[\s\S]*$/g,'') : (this.tag || this.equippedRes || this.inventoryRes || 'Item');
  }

  getPalleteID(){
    return this.palleteID;
  }

  getTag(){
    return this.tag;
  }

  getACBonus(){
    let bonus = 0;
    for(let i = 0, len = this.properties.length; i < len; i++){
      let property = this.properties[i];
      if(property.isUseable() && property.is(ModuleItemProperty.Armor)){
        bonus += property.getValue();
      }
    }
    return (this.baseItem?.baseAC || 0) + bonus;
  }

  getDexBonus(){
    if(this.baseItemId){
      return this.baseItem.dexBonus || 0;
    }
    return 0;
  }

  getAttackBonus(): number {
    let bonus = 0;
    for(let i = 0, len = this.properties.length; i < len; i++){
      let property = this.properties[i];
      if(property.isUseable() && property.is(ModuleItemProperty.AttackBonus)){
        bonus += property.getValue();
        break;
      }
    }

    if(BitWise.InstanceOfObject(this.possessor, ModuleObjectType.ModuleCreature)){
      switch(this.getWeaponWield()){
        case WeaponWield.BLASTER_PISTOL:
          if(this.possessor.getHasFeat(CombatFeatType.WEAPON_FOCUS_BLASTER)){
            bonus += 1;
          }
        break;
        case WeaponWield.BLASTER_RIFLE:
          if(this.possessor.getHasFeat(CombatFeatType.WEAPON_FOCUS_BLASTER_RIFLE)){
            bonus += 1;
          }
        break;
        case WeaponWield.BLASTER_HEAVY:
          if(this.possessor.getHasFeat(CombatFeatType.WEAPON_FOCUS_HEAVY_WEAPONS)){
            bonus += 1;
          }
        break;
        case WeaponWield.ONE_HANDED_SWORD:
        case WeaponWield.TWO_HANDED_SWORD:
        case WeaponWield.STUN_BATON:
          if(this.baseItemId == 8 || this.baseItemId == 9 || this.baseItemId == 10){
            if(this.possessor.getHasFeat(CombatFeatType.WEAPON_FOCUS_LIGHTSABER)){
              bonus += 1;
            }
          }else if(this.possessor.getHasFeat(CombatFeatType.WEAPON_FOCUS_MELEE_WEAPONS)){
            bonus += 1;
          }
        break;
      }
    }

    return bonus;
  }

  getBaseDamage(){
    if(this.baseItem.numDice){
      return Dice.roll(this.baseItem.numDice, this.baseItem.die);
    }
    return 0;
  }

  getBaseDamageType(): number {
    if(this.baseItem){
      return Math.log2(this.baseItem.damageFlags) & 0xFF;
    }
    return 0;
  }

  getMonsterDamage(){
    for(let i = 0, len = this.properties.length; i < len; i++){
      let property = this.properties[i];
      if(property.isUseable() && property.is(ModuleItemProperty.Monster_Damage)){
        return property.getValue();
      }
    }
    return 0;
  }

  hasDamageBonus(): boolean {
    for(let i = 0, len = this.properties.length; i < len; i++){
      let property = this.properties[i];
      if(property.isUseable() && property.is(ModuleItemProperty.Damage)){
        return true;
      }
    }
    return false;
  }

  getDamageBonus(): number {
    for(let i = 0, len = this.properties.length; i < len; i++){
      let property = this.properties[i];
      if(property.isUseable() && property.is(ModuleItemProperty.Damage)){
        return property.getValue();
      }
    }
    return 0;
  }

  getDamageBonusType(): number {
    for(let i = 0, len = this.properties.length; i < len; i++){
      let property = this.properties[i];
      if(property.isUseable() && property.is(ModuleItemProperty.Damage)){
        return property.getSubType()?.id || 0;
      }
    }
    return 0;
  }

  getDamageFlags(): number {
    return this.baseItem.damageFlags;
  }

  getCriticalThreatRangeMin(){
    return 20 - this.baseItem.criticalThreat;
  }

  getCriticalThreatRangeMax(){
    return 20;
  }

  /** The bonus this item gives to an ability (0 STR, 1 DEX, 2 CON, 3 INT, 4 WIS, 5 CHA) */
  getAbilityBonus(ability: number){
    for(let i = 0, len = this.properties.length; i < len; i++){
      const property = this.properties[i];
      if(property.isUseable() && property.is(ModuleItemProperty.Ability, ability)){
        return property.getValue();
      }
    }
    return 0;
  }


  isUpgradable(){
    for(let i = 0, len = this.properties.length; i < len; i++){
      let property = this.properties[i];
      if(property.upgradeType >= 0){
        return true;
      }
    }
    return false;
  }

  castAmmunitionAtTarget(oCaster: ModuleObject, oTarget: ModuleObject){
    if(typeof oTarget != 'undefined'){
      let ammunitiontype = this.baseItem.ammunitionType;
      if( ammunitiontype >= 1 ){
        const _2DA = GameState.TwoDAManager.datatables.get('ammunitiontypes');
        if(_2DA){
          let ammunition = _2DA.rows[ammunitiontype];
          if(typeof ammunition != 'undefined'){
            
          }
        }
      }

    }
  }

  /**
   * The spells.2da row a Cast Spell property casts. In KotOR its subtype is that row itself (a medpac's 64 is
   * ITEM_ABILITY_MED_PACK, a frag grenade's 87 ITEM_ABILITY_GRENADE_FRAGMENTATION). iprp_spells.2da is a table
   * left over from Neverwinter Nights: its spellindex points at unrelated powers, so it isn't used.
   */
  static GetCastSpellId(property: ItemProperty): number {
    const spellId = Number(property?.subType);
    if(!Number.isInteger(spellId) || spellId < 0) return -1;
    const spells = GameState.TwoDAManager.datatables.get('spells');
    return !spells || spells.rows[spellId] ? spellId : -1;
  }

  /**
   * What one use of a Cast Spell property costs, from iprp_chargecost.2da (its cost table, 3):
   * Single_Use takes one from the stack, N_Charges/Use takes N charges; anything else is free.
   */
  static GetCastSpellUseCost(property: ItemProperty): { single: boolean; charges: number } {
    const IPRP_CHARGECOST = 3;
    if(property?.costTable !== IPRP_CHARGECOST) return { single: false, charges: 0 };
    const label = String(GameState.TwoDAManager.datatables.get('iprp_chargecost')?.rows[property.costValue]?.label || '');
    if(label === 'Single_Use') return { single: true, charges: 0 };
    const charges = label.match(/^(\d+)_Charges?\/Use$/);
    return { single: false, charges: charges ? parseInt(charges[1]) : 0 };
  }

  /**
   * Who a usable item is used on, from the spell it casts: 'hostile' for grenades and droid weapons (an enemy),
   * 'self' for the rest (medpacs, stims, adrenals, shields, repair kits); undefined if it can't be used now.
   */
  getUseTargeting(): 'self' | 'hostile' | undefined {
    const property = this.getUsableCastSpellProperties()[0];
    if(!property) return undefined;
    const spell = GameState.TwoDAManager.datatables.get('spells')?.rows[ModuleItem.GetCastSpellId(property)];
    if(!spell) return undefined;
    const hostile = String(spell.impactscript || '').toLowerCase() === 'k_sup_grenade' ||
      (spell.forcehostile !== undefined && spell.forcehostile !== '****' && spell.forcehostile !== '');
    return hostile ? 'hostile' : 'self';
  }

  /** The resref that names this item (equipped or carried) */
  getItemResRef(): string {
    return this.getEquippedRes?.() || this.getInventoryRes?.() || this.getTemplateResRef?.() || '';
  }

  /** The item's usable Cast Spell properties, with enough charges left for a use */
  getUsableCastSpellProperties(): ItemProperty[] {
    return (this.properties || []).filter((property) => {
      if(!property.isUseable() || !property.is(ModuleItemProperty.CastSpell)) return false;
      if(ModuleItem.GetCastSpellId(property) < 0) return false;
      const cost = ModuleItem.GetCastSpellUseCost(property);
      return !cost.charges || (Number(this.charges) || 0) >= cost.charges;
    });
  }

  /**
   * The item's spell went off: pay for the use. A single-use item (medpac, grenade, stim) loses one from
   * its stack and is gone at none; a charged one (energy shield, armband) loses its charges per use.
   */
  spendUse(spellId: number, user?: ModuleObject){
    const property = (this.properties || []).find((p) => p.is(ModuleItemProperty.CastSpell) && ModuleItem.GetCastSpellId(p) === spellId);
    if(!property) return;
    const cost = ModuleItem.GetCastSpellUseCost(property);
    if(cost.charges){
      this.charges = Math.max(0, (Number(this.charges) || 0) - cost.charges);
      return;
    }
    if(!cost.single) return;
    const stack = this.getStackSize() || 1;
    if(stack > 1){
      this.setStackSize(stack - 1);
      return;
    }
    // Used up: take it out of whichever inventory holds it
    const party = GameState.InventoryManager?.inventory;
    if(party && party.includes(this)){
      GameState.InventoryManager.removeItem(this);
    }
    for(const owner of [user, this.possessor] as any[]){
      const list = owner?.inventory;
      const i = Array.isArray(list) ? list.indexOf(this) : -1;
      if(i >= 0) list.splice(i, 1);
    }
    this.setStackSize(0);
  }

  useItemOnObject(oCaster: ModuleCreature, oTarget: ModuleObject){
    for(let i = 0, len = this.properties.length; i < len; i++){
      let property = this.properties[i];
      if(!property.isUseable()){ continue; }

      if(property.is(ModuleItemProperty.CastSpell)){
        if(!this.getUsableCastSpellProperties().includes(property)){ continue; }
        const action = new GameState.ActionFactory.ActionItemCastSpell();
        action.setParameter(0, ActionParameterType.DWORD, oTarget);
        action.setParameter(1, ActionParameterType.DWORD, oTarget.area);
        action.setParameter(2, ActionParameterType.FLOAT, oTarget.position.x);
        action.setParameter(3, ActionParameterType.FLOAT, oTarget.position.y);
        action.setParameter(4, ActionParameterType.FLOAT, oTarget.position.z);
        action.setParameter(5, ActionParameterType.INT, ModuleItem.GetCastSpellId(property));
        action.setParameter(6, ActionParameterType.INT, 1);
        action.setParameter(7, ActionParameterType.FLOAT, 1.0);
        action.setParameter(8, ActionParameterType.INT, -1);
        action.setParameter(9, ActionParameterType.INT, -1);
        action.setParameter(10, ActionParameterType.DWORD, this);
        action.setParameter(11, ActionParameterType.STRING, '');
        oCaster.actionQueue.add(action);
        // One use casts one spell
        return;
      }else if(property.is(ModuleItemProperty.ThievesTools)){
        const action = new GameState.ActionFactory.ActionUnlockObject();
        action.setParameter(0, ActionParameterType.DWORD, oTarget);
        action.setParameter(1, ActionParameterType.DWORD, this);
        oCaster.actionQueue.add(action);
      }else if(property.is(ModuleItemProperty.Trap)){
        const action = new GameState.ActionFactory.ActionSetMine();
        action.setParameter(0, ActionParameterType.DWORD, this);
        action.setParameter(1, ActionParameterType.DWORD, oTarget);
        action.setParameter(2, ActionParameterType.FLOAT, oTarget.position.x);
        action.setParameter(3, ActionParameterType.FLOAT, oTarget.position.y);
        action.setParameter(4, ActionParameterType.FLOAT, oTarget.position.z);
        oCaster.actionQueue.add(action);
      }
    }
  }

  load(){
    // Once loaded (or from a save game) the template is already complete
    const resRef = this.loaded ? '' : (this.getEquippedRes() || this.getInventoryRes());
    const merged = this.mergeTemplate(ResourceTypes['uti'], resRef);
    this.initProperties();
    return merged;
  }

  async loadModel(): Promise<OdysseyModel3D> {
    if(!this.baseItem){ 
      this.model = new OdysseyModel3D;
      return this.model;
    }

    let itemclass = this.baseItem.itemClass;
    let defaultModel = this.baseItem.defaultModel;
    itemclass = itemclass.replace(/\0[\s\S]*$/g,'').trim().toLowerCase();
    defaultModel = defaultModel.replace(/\0[\s\S]*$/g,'').trim().toLowerCase();

    if(defaultModel != 'i_null'){
      defaultModel = this.nthStringConverter(defaultModel, this.getModelVariation());
      if(!parseInt(defaultModel.substr(-3))){
        defaultModel = itemclass+'_'+(('000'+this.getModelVariation()).substr(-3));
      }
    }

    try{
      const mdl = await MDLLoader.loader.load(defaultModel);
      const model = await OdysseyModel3D.FromMDL(mdl, {
        context: this.context,
        lighting: true,
        //castShadow: false,
        //receiveShadow: false
      });
      this.model = model;
      return this.model;
    }catch(e){
      this.model = new OdysseyModel3D;
      return this.model;
    }
  }

  nthStringConverter(name = '', nth = 1){
    let value = nth.toString();
    name = name.substr(0, name.length - value.length);
    return name + value;
  }

  /**
   * Set the weapon powered state and update the powered animation
   * @param powered - Whether the weapon should be powered
   */
  setPowered(powered: boolean){
    const currentAnimL = this.model?.animationManager?.currentAnimation || this.model?.odysseyAnimationMap?.get('off');
    if(!currentAnimL){ return; }

    //power up
    if(powered){
      switch(currentAnimL.name){
        case 'off':
          this.model.playAnimation('powerup');
        break;
        case 'powerup':
        break;
        default:
          this.model.playAnimation('powered', true);
        break;
      }
      return;
    }
    
    //power down
    switch(currentAnimL.name){
      case 'powered':
        this.model.playAnimation('powerdown');
      break;
      case 'powerdown':
      break;
      default:
        this.model.playAnimation('off', true);
      break;
    }
  }

  static FromResRef(resRef: string): ModuleItem {
    const buffer = ResourceLoader.loadCachedResource(ResourceTypes['uti'], resRef);
    if(buffer){
      const item = new ModuleItem(new GFFObject(buffer));
      item.initProperties();
      return item;
    }
    return undefined;
  }

  getSpells(){
    let spells = [];

    //propertyName, subType, costTable, costValue, param1, param1Value, chanceAppear, usesPerDay, useable, upgradeType
    for(let i = 0, len = this.properties.length; i < len; i++){
      let property = this.properties[i];
      //Activate Item
      if(property.propertyName == ModuleItemProperty.CastSpell){
        spells.push(new TalentSpell(property.subType));
      }
    }

    return spells;
  }

  initProperties(){

    if(this.loaded){
      return;
    }
    
    if(!this.initialized){
      if(this.template.RootNode.hasField('ObjectId')){
        this.id = this.template.getFieldByLabel('ObjectId').getValue();
      }else if(this.template.RootNode.hasField('ID')){
        this.id = this.template.getFieldByLabel('ID').getValue();
      }
      
      GameState.ModuleObjectManager.AddObjectById(this);
    }

    if(this.template.RootNode.hasField('AddCost'))
      this.addCost = parseInt(this.template.getFieldByLabel('AddCost').getValue());

    if(this.template.RootNode.hasField('BaseItem')){
      this.baseItemId = this.template.getFieldByLabel('BaseItem').getValue();
      this.baseItem = BaseItem.From2DA(this.baseItemId);
    }

    this.charges = this.template.RootNode.get('Charges', this.charges);

    if(this.template.RootNode.hasField('Cost'))
      this.cost = parseInt(this.template.getFieldByLabel('Cost').getValue());

    this.deleting = this.template.RootNode.get('DELETING', this.deleting);

    this.descIdentified = this.template.RootNode.get('DescIdentified', this.descIdentified);

    this.description = this.template.RootNode.get('Description', this.description);

    this.dropable = this.template.RootNode.get('Dropable', this.dropable);
      
    this.equippedRes = this.template.RootNode.get('EquippedRes', this.equippedRes);

    this.identified = this.template.RootNode.get('Identified', this.identified);

    this.infinite = this.template.RootNode.get('Infinite', this.infinite);

    this.inventoryRes = this.template.RootNode.get('InventoryRes', this.inventoryRes);
  
    if(this.template.RootNode.hasField('LocalizedName'))
      this.localizedName = this.template.RootNode.getFieldByLabel('LocalizedName').getCExoLocString();
        
    this.maxCharges = this.template.RootNode.get('MaxCharges', this.maxCharges);

    this.modelVariation = this.template.RootNode.get('ModelVariation', this.modelVariation);
    
    this.newItem = this.template.RootNode.get('NewItem', this.newItem);
        
    this.nonEquippable = this.template.RootNode.get('NonEquippable', this.nonEquippable);
  
    this.pickpocketable = this.template.RootNode.get('Pickpocketable', this.pickpocketable);
      
    this.plot = this.template.RootNode.get('Plot', this.plot);

    if(this.template.RootNode.hasField('PropertiesList')){
      let propertiesList = this.template.getFieldByLabel('PropertiesList').getChildStructs();
      this.properties = [];
      for(let i = 0, len = propertiesList.length; i < len; i++){
        this.properties.push( 
          new ItemProperty( 
            GFFObject.FromStruct( propertiesList[i] ), this 
          ) 
        );
      }
    }

    this.stackSize = this.template.RootNode.get('StackSize', this.stackSize);

    this.stolen = this.template.RootNode.get('Stolen', this.stolen);

    if(this.template.RootNode.hasField('Tag'))
      this.tag = this.template.getFieldByLabel('Tag').getValue().replace(/\0[\s\S]*$/g,'');

    this.textureVariation = this.template.RootNode.get('TextureVar', this.textureVariation);

    this.upgrades = this.template.RootNode.get('Upgrades', this.upgrades);

    this.upgradeLevel = this.template.RootNode.get('UpgradeLevel', this.upgradeLevel);

    this.upgradeSlot0 = this.template.RootNode.get('UpgradeSlot0', this.upgradeSlot0);

    this.upgradeSlot1 = this.template.RootNode.get('UpgradeSlot1', this.upgradeSlot1);

    this.upgradeSlot2 = this.template.RootNode.get('UpgradeSlot2', this.upgradeSlot2);

    this.upgradeSlot3 = this.template.RootNode.get('UpgradeSlot3', this.upgradeSlot3);

    this.upgradeSlot4 = this.template.RootNode.get('UpgradeSlot4', this.upgradeSlot4);

    this.upgradeSlot5 = this.template.RootNode.get('UpgradeSlot5', this.upgradeSlot5);

    this.position.x = this.template.RootNode.get('XPosition', this.position.x);

    this.position.y = this.template.RootNode.get('YPosition', this.position.y);

    this.position.z = this.template.RootNode.get('ZPosition', this.position.z);

    this.xOrientation = this.template.RootNode.get('XOrientation', this.xOrientation);

    this.yOrientation = this.template.RootNode.get('YOrientation', this.yOrientation);

    this.zOrientation = this.template.RootNode.get('ZOrientation', this.zOrientation);

    this.palleteID = this.template.RootNode.get('PaletteID', this.palleteID);

    this.weaponSound = GameState.SWRuleSet.weaponSounds[this.baseItem?.poweredItem];

    this.initialized = true

  }

  setPossessor( oCreature: ModuleCreature){
    this.possessor = oCreature;
  }

  getPossessor(){
    return this.possessor;
  }

  onEquip(oCreature: ModuleCreature){
    console.log('ModuleItem.onEquip', oCreature, this);
    if(this.isDisguise()){
      oCreature.removeEffectsByType( GameEffectType.EffectDisguise ); //EFFECT_DISGUISE
      let eDisguise = new EffectDisguise();
      eDisguise.setInt(0, this.getDisguiseAppearanceId());
      eDisguise.setCreator(this);
      eDisguise.setAttachedObject(oCreature);
      oCreature.addEffect( eDisguise );
    }
    if(GameState.PartyManager.party.indexOf(oCreature) >= 0){
      GameState.InventoryManager.removeItem(this);
    }else{
      //oCreature.inventory.push(this);
    }
    this.setPossessor(oCreature);
  }

  onUnEquip(oCreature: ModuleCreature){
    console.log('ModuleItem.onUnEquip', oCreature, this);
    oCreature.removeEffectsByCreator(this);
    if(GameState.PartyManager.party.indexOf(oCreature) >= 0){
      GameState.InventoryManager.addItem(this);
    }else{
      //oCreature.inventory.push(this);
    }
    this.setPossessor(undefined);
  }

  destroy(): void {
    super.destroy();
    if(this.placedInWorld){
      if(this.area) this.area.detachObject(this);
    }
  }

  save(){
    let itemStruct = new GFFStruct(0);

    if(this.id >= 0)
      itemStruct.addDWord('ObjectId', this.id);
    
    itemStruct.addInt('BaseItem', this.getBaseItemId());
    itemStruct.addCExoString('Tag', this.tag);
    itemStruct.addByte('Identified', this.identified);
    itemStruct.addField( new GFFField(GFFDataType.CEXOLOCSTRING, 'Description') ).setValue(this.template.getFieldByLabel('Description')?.getCExoLocString());
    itemStruct.addField( new GFFField(GFFDataType.CEXOLOCSTRING, 'DescIdentified') ).setValue(this.template.getFieldByLabel('DescIdentified')?.getCExoLocString());
    itemStruct.addField( new GFFField(GFFDataType.CEXOLOCSTRING, 'LocalizedName') ).setValue(this.template.getFieldByLabel('LocalizedName')?.getCExoLocString());
    itemStruct.addWord('StackSize', this.stackSize);
    itemStruct.addByte('Stolen', this.stolen);
    itemStruct.addDWord('Upgrades', this.upgrades);
    itemStruct.addByte('Dropable', this.dropable);
    itemStruct.addByte('Pickpocketable', 1);
    itemStruct.addByte('ModelVariation', this.modelVariation);
    itemStruct.addByte('Charges', this.charges);
    itemStruct.addByte('MaxCharges', this.maxCharges);
    itemStruct.addDWord('Cost', this.cost);
    itemStruct.addDWord('AddCost', this.addCost);
    itemStruct.addByte('Plot', this.plot);

    let propertiesList = itemStruct.addField( new GFFField(GFFDataType.LIST, 'PropertiesList') );
    for(let i = 0; i < this.properties.length; i++){
      propertiesList.addChildStruct( this.properties[i].save() );
    }

    itemStruct.addFloat('XPosition', this.position.x);
    itemStruct.addFloat('YPosition', this.position.y);
    itemStruct.addFloat('ZPosition', this.position.z);
    itemStruct.addFloat('XOrientation', this.xOrientation);
    itemStruct.addFloat('YOrientation', this.yOrientation);
    itemStruct.addFloat('ZOrientation', this.zOrientation);
    itemStruct.addByte('NonEquippable', this.nonEquippable);
    itemStruct.addByte('NewItem', this.newItem);
    itemStruct.addByte('DELETING', 0);

    return itemStruct;
  }

}
