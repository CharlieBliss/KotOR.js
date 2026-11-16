import { GameEffect } from "@/effects/GameEffect";
import { GameState } from "@/GameState";
import { GameEffectDurationType } from "@/enums/effects/GameEffectDurationType";
import { GameEffectType } from "@/enums/effects/GameEffectType";
import { MDLLoader } from "@/loaders";
// import { TwoDAManager } from "@/managers/TwoDAManager";
import { OdysseyModel } from "@/odyssey";
import { OdysseyModel3D } from "@/three/odyssey";

/**
 * EffectBeam class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file EffectBeam.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class EffectBeam extends GameEffect {
  modelName: string;
  model: OdysseyModel3D;
  visualEffect: any;

  constructor(){
    super();
    this.type = GameEffectType.EffectBeam;

    //intList[0] : visualeffects.2da id
    //intList[1] : bodypart constant
    //intList[2] : hit or miss

    //objectList[0] : caster

    // this.modelName = undefined;
    // this.model = undefined;

  }

  initialize() {
    if(this.initialized)
      return this;
      
    const visualeffects2DA = GameState.TwoDAManager.datatables.get('visualeffects');
    if(visualeffects2DA){
      this.visualEffect = visualeffects2DA.getByID(this.getInt(0));
    }

    super.initialize();

    switch(this.visualEffect.progfx_duration){
      case 616:
        this.modelName = 'v_coldray_dur';
      break;
      case 612: 
        this.modelName = 'v_deathfld_dur';
      break;
      case 613: 
        this.modelName = 'v_drain_dur';
      break;
      case 611:
        this.modelName = 'v_drdkill_dur';
      break;
      case 610:
        this.modelName = 'v_drddisab_dur';
      break;
      case 620: 
        this.modelName = 'v_drdstun_dur';
      break;
      case 614:
        this.modelName = 'v_flame_dur';
      break;
      case 619:
        this.modelName = 'v_fstorm_dur';
      break;
      case 617:
        this.modelName = 'v_ionray01_dur';
      break;
      case 618:
        this.modelName = 'v_ionray02_dur';
      break;
      case 609:
        this.modelName = 'v_lightnx_dur';
      break;
      case 608:
        this.modelName = 'v_lightns_dur';
      break;
      case 621:
        this.modelName = 'v_fshock_dur';
      break;
      case 615:
        this.modelName = 'v_stunray_dur';
      break;
      default:
        this.modelName = 'v_coldray_dur';
      break;
    }
    return this;
  }

  loadModel(): Promise<void> {
    return new Promise<void>( ( resolve, reject) => {
      MDLLoader.loader.load(this.modelName)
      .then((mdl: OdysseyModel) => {
        OdysseyModel3D.FromMDL(mdl, {
          context: this.object.context,
          onComplete: (model: OdysseyModel3D) => {
            this.model = model;
            // Applied while the model was loading (addEffect applies at once): attach it now
            if(this.applied) this.attachBeam();
            resolve();
          }
        });
      }).catch(() => {
        resolve();
      });
    });
  }

  onApply(){
    if(this.applied)
      return;
      
    super.onApply();
    this.attachBeam();
    GameState.hooks.onHostVisualEffectApplied(this);
  }

  /** Hang the beam on its caster's model, its emitters aimed at the target (once both models are there) */
  attachBeam(){
    if(!(this.model instanceof OdysseyModel3D) || this.model.parent) return;
    const caster = this.getCaster();
    // Aimed at a creature, its model; aimed at a spot (Module.addEffect), the marker made for it there
    const target = this.object?.model || this.creator?.model;
    if(caster?.model instanceof OdysseyModel3D && target){
      //Add the effect to the casters model
      caster.model.add(this.model);
      //Set the target node of the BeamEffect emitter
      this.model.setEmitterTarget(target);
    }
  }

  /** The beam goes with the effect: off the caster's model (it stayed there after the power ended) */
  onRemove(){
    if(this.model instanceof OdysseyModel3D){
      this.model.removeFromParent();
      this.model.dispose();
      this.model = undefined;
    }
    super.onRemove();
  }

  update(delta = 0){
    super.update(delta);

    if(this.durationEnded && this.getDurationType() == GameEffectDurationType.TEMPORARY){
      return;
    }
  }

  getCaster(){
    return this.getObject(0);
  }

}
