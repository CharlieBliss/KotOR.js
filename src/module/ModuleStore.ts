import { ModuleObject } from "@/module/ModuleObject";
import { ModuleItem } from "@/module/ModuleItem";
import { GFFDataType } from "@/enums/resource/GFFDataType";
import { NWScriptInstance } from "@/nwscript/NWScriptInstance";
import { GFFField } from "@/resource/GFFField";
import { GFFObject } from "@/resource/GFFObject";
import { GFFStruct } from "@/resource/GFFStruct";
import { ResourceLoader } from "@/loaders";
import { ResourceTypes } from "@/resource/ResourceTypes";
import { ModuleObjectType } from "@/enums/module/ModuleObjectType";
import { GameState } from "@/GameState";
// import { ModuleObjectManager } from "@/managers";

/**
* ModuleStore class.
* 
* Class representing merchant stores found in modules areas.
* 
* KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
* 
* @file ModuleStore.ts
* @author KobaltBlu <https://github.com/KobaltBlu>
* @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
* @memberof KotOR
*/
export class ModuleStore extends ModuleObject {
  buySellFlag: number;
  markDown: number;
  markUp: number;
  onOpenStore: any;
  resref: any;

  constructor( gff = new GFFObject() ){
    super(gff);
    this.objectType |= ModuleObjectType.ModuleStore;
    
    this.template = gff;
    this.buySellFlag = -1;
    this.markDown = 0;
    this.markUp = 0;
    this.onOpenStore = null;
    this.tag = '';
    this.inventory = [];

  }

  getInventory(){
    return this.inventory;
  }

  getMarkDown(){
    return this.markDown * .01;
  }

  getMarkUp(){
    return this.markUp * .01;
  }

  load(){
    // A placed store names its template in ResRef (it has no TemplateResRef)
    this.mergeTemplate(ResourceTypes['utm'], this.getResRef());
    this.initProperties();
  }

  initProperties(){
    
    if(!this.initialized){
      // A store template's ID is the store's number, not an object id
      this.id = this.template.RootNode.get('ObjectId', this.id);
      
      GameState.ModuleObjectManager.AddObjectById(this);
    }

    if(this.template.RootNode.hasField('BuySellFlag'))
      this.buySellFlag = this.template.getFieldByLabel('BuySellFlag').getValue()

    if(this.template.RootNode.hasField('LocName'))
      this.locName = this.template.getFieldByLabel('LocName').getCExoLocString();

    this.markDown = this.template.RootNode.get('MarkDown', this.markDown);

    this.markUp = this.template.RootNode.get('MarkUp', this.markUp);

    this.onOpenStore = this.template.RootNode.get('OnOpenStore', this.onOpenStore);
      
    this.initCommonProperties();

    this.rotation.x = this.template.RootNode.get('XOrientation', this.rotation.x);

    this.rotation.y = this.template.RootNode.get('YOrientation', this.rotation.y);

    this.rotation.z = this.template.RootNode.get('ZOrientation', this.rotation.z);

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
            
    if(this.template.RootNode.hasField('ItemList')){
      let items = this.template.RootNode.getFieldByLabel('ItemList').getChildStructs() || [];
      for(let i = 0; i < items.length; i++){
        const moduleItem = new ModuleItem(GFFObject.FromStruct(items[i]));
        this.inventory.push(moduleItem)
        moduleItem.load();
      }
    }
    
    this.initialized = true;

  }

  destroy(): void {
    super.destroy();
    if(this.area) this.area.detachObject(this);

    while(this.inventory.length){
      const item = this.inventory[0];
      if(item){
        item.destroy();
      }
      this.inventory.splice(0, 1);
    }
  }

  save(){
    let gff = new GFFObject();
    gff.FileType = 'UTM ';
    gff.RootNode.type = 6;

    gff.RootNode.addDWord('ObjectId', this.id);
    gff.RootNode.addCExoString('Tag', this.tag);
    gff.RootNode.addField( new GFFField(GFFDataType.CEXOLOCSTRING, 'LocName') ).setValue(this.locName);
    gff.RootNode.addInt('MarkDown', this.markDown);
    gff.RootNode.addInt('MarkUp', this.markUp);
    gff.RootNode.addField( new GFFField(GFFDataType.RESREF, 'OnOpenStore') ).setValue (this.onOpenStore instanceof NWScriptInstance ? this.onOpenStore.name : '' );
    gff.RootNode.addByte('BuySellFlag', this.buySellFlag);

    let itemList = gff.RootNode.addField( new GFFField(GFFDataType.LIST, 'ItemList') );
    for(let i = 0; i < this.inventory.length; i++){
      itemList.addChildStruct( this.inventory[i].save() );
    }

    gff.RootNode.addFloat('XPosition', this.position.x);
    gff.RootNode.addFloat('YPosition', this.position.y);
    gff.RootNode.addFloat('ZPosition', this.position.z);
    gff.RootNode.addFloat('XOrientation', this.rotation.x);
    gff.RootNode.addFloat('YOrientation', this.rotation.y);
    gff.RootNode.addFloat('ZOrientation', this.rotation.z);

    //SWVarTable
    let swVarTable = gff.RootNode.addField( new GFFField(GFFDataType.STRUCT, 'SWVarTable') );
    swVarTable.addChildStruct( this.getSWVarTableSaveStruct() );

    gff.RootNode.addField( this.actionQueueToActionList() );
    gff.RootNode.addByte('Commandable', 1);


    this.template = gff;
    return gff;
  }

}
