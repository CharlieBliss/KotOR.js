import * as THREE from "three";
import { GameState } from "@/GameState";
import { MDLLoader, TextureLoader } from "@/loaders";
import { OdysseyModel3D } from "@/three/odyssey";
import type { OdysseyModel } from "@/odyssey";
import type { ModuleObject } from "@/module/ModuleObject";
import type { ModuleItem } from "@/module/ModuleItem";

/** A row of ammunitiontypes.2da: what a ranged weapon shoots */
interface IAmmunitionType {
  model: string;
  shotSound: string;
  impactSound: string;
}

interface IProjectile {
  caster: ModuleObject;
  target: ModuleObject;
  ammunition: IAmmunitionType;
  hit: boolean;
  /** Seconds until it leaves the weapon */
  delay: number;
  fired: boolean;
  from: THREE.Vector3;
  to: THREE.Vector3;
  elapsed: number;
  duration: number;
  model?: OdysseyModel3D;
  done: boolean;
}

const valid = (value: any): string => {
  const s = typeof value === 'string' ? value.trim() : '';
  return s && s !== '****' ? s.toLowerCase() : '';
};

/**
 * ProjectileManager class.
 *
 * Blaster bolts (and other ammunitiontypes.2da projectiles): a model that flies from the weapon's bullet hook
 * to the target's impact node, with the shot and impact sounds. The attack's damage is decided by the combat
 * round; the bolt only shows it. Missed shots fly past the target.
 *
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 *
 * @file ProjectileManager.ts
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class ProjectileManager {

  /** Metres per second */
  static SPEED = 22;
  /** Seconds between the shots of one round (multiple attacks, dual pistols) */
  static SHOT_SPACING = 0.25;
  /** How far past a missed target a bolt keeps flying (metres) */
  static MISS_OVERSHOOT = 4;
  /** The ammunition models' looping in-flight animation */
  static TRAVEL_ANIMATION = 'travel01';

  static projectiles: IProjectile[] = [];
  static models: Map<string, Promise<OdysseyModel | undefined>> = new Map();

  static tmpVec = new THREE.Vector3();
  static tmpDir = new THREE.Vector3();
  /** The ammunition models are drawn along their local Z axis */
  static boltAxis = new THREE.Vector3(0, 0, 1);

  /**
   * The ammunition a weapon fires, or undefined for melee weapons and unarmed attacks
   */
  static GetAmmunitionType(index: number): IAmmunitionType | undefined {
    if(!(index >= 1)) return undefined;
    const row = GameState.TwoDAManager?.datatables.get('ammunitiontypes')?.rows[index];
    if(!row) return undefined;
    const model = valid(row.model0) || valid(row.model);
    if(!model) return undefined;
    return {
      model,
      shotSound: valid(row.shotsound0),
      impactSound: valid(row.impactsound0),
    };
  }

  static GetWeaponAmmunitionIndex(weapon: ModuleItem | undefined): number {
    if(!weapon || !weapon.isRangedWeapon?.()) return -1;
    return weapon.baseItem?.ammunitionType ?? -1;
  }

  /**
   * A ranged attack: fire its bolt. Called by the combat round for each attack it resolves.
   * @param delay seconds until the shot leaves the weapon (the attack animation's damage delay)
   */
  static FireWeapon(caster: ModuleObject, target: ModuleObject, weapon: ModuleItem | undefined, hit: boolean, delay: number = 0): boolean {
    const ammunitionIndex = this.GetWeaponAmmunitionIndex(weapon);
    if(ammunitionIndex < 1 || !caster || !target) return false;
    if(!this.Launch(caster, target, ammunitionIndex, hit, delay)) return false;
    // GM sessions: players draw the same bolt
    if(GameState.gmMode) GameState.GMManager?.onHostProjectile(caster, target, ammunitionIndex, hit, delay);
    return true;
  }

  /**
   * Show a bolt of the given ammunitiontypes.2da row from caster to target
   */
  static Launch(caster: ModuleObject, target: ModuleObject, ammunitionIndex: number, hit: boolean, delay: number = 0): boolean {
    const ammunition = this.GetAmmunitionType(ammunitionIndex);
    if(!ammunition || !caster || !target) return false;

    // Shots in the same round leave one after another
    const queued = this.projectiles.filter((p) => p.caster === caster && !p.fired).length;
    const projectile: IProjectile = {
      caster,
      target,
      ammunition,
      hit,
      delay: Math.max(0, delay) + queued * this.SHOT_SPACING,
      fired: false,
      from: new THREE.Vector3(),
      to: new THREE.Vector3(),
      elapsed: 0,
      duration: 0,
      done: false,
    };
    this.projectiles.push(projectile);
    this.LoadModel(ammunition.model, caster).then((model) => {
      if(!model) return;
      if(projectile.done){
        model.dispose();
        return;
      }
      model.visible = projectile.fired;
      // The bolt is an emitter that only produces particles while its travel animation plays
      if(model.odysseyAnimations?.some((a) => a.name === this.TRAVEL_ANIMATION)){
        model.playAnimation(this.TRAVEL_ANIMATION, true);
      }
      projectile.model = model;
      GameState.scene?.add(model);
      TextureLoader.LoadQueue();
    });
    return true;
  }

  static async LoadModel(resRef: string, caster: ModuleObject): Promise<OdysseyModel3D | undefined> {
    let mdl = this.models.get(resRef);
    if(!mdl){
      mdl = MDLLoader.loader.load(resRef).catch((): undefined => undefined);
      this.models.set(resRef, mdl);
    }
    const source = await mdl;
    if(!source) return undefined;
    try{
      return await OdysseyModel3D.FromMDL(source, { context: caster.context });
    }catch(e){
      console.warn('ProjectileManager: could not build', resRef, e);
      return undefined;
    }
  }

  /** Where a shot leaves the weapon: its bullet hook, else roughly hand height */
  static GetMuzzlePosition(caster: ModuleObject, out: THREE.Vector3): THREE.Vector3 {
    const weaponModel = (caster as any).equipment?.RIGHTHAND?.model as OdysseyModel3D | undefined;
    const hook = weaponModel?.bullethook0;
    if(hook){
      hook.updateWorldMatrix(true, false);
      return hook.getWorldPosition(out);
    }
    return out.copy(caster.position).setZ(caster.position.z + 1.2);
  }

  /** Where a shot lands on the target: its impact node, else chest height */
  static GetImpactPosition(target: ModuleObject, out: THREE.Vector3): THREE.Vector3 {
    const impact = target.model?.impact;
    if(impact){
      impact.updateWorldMatrix(true, false);
      return impact.getWorldPosition(out);
    }
    return out.copy(target.position).setZ(target.position.z + 1.1);
  }

  static Fire(projectile: IProjectile){
    projectile.fired = true;
    this.GetMuzzlePosition(projectile.caster, projectile.from);
    this.GetImpactPosition(projectile.target, projectile.to);
    if(!projectile.hit){
      // Fly past the target, a little to one side
      const dir = this.tmpDir.copy(projectile.to).sub(projectile.from);
      const side = new THREE.Vector3(-dir.y, dir.x, 0).normalize().multiplyScalar((Math.random() < 0.5 ? -1 : 1) * 0.6);
      projectile.to.add(side).add(dir.normalize().multiplyScalar(this.MISS_OVERSHOOT));
    }
    projectile.duration = Math.max(0.05, projectile.from.distanceTo(projectile.to) / this.SPEED);
    if(projectile.ammunition.shotSound){
      projectile.caster.audioEmitter?.playSoundFireAndForget(projectile.ammunition.shotSound);
    }
  }

  static Finish(projectile: IProjectile){
    projectile.done = true;
    if(projectile.fired && projectile.hit && projectile.ammunition.impactSound){
      projectile.target.audioEmitter?.playSoundFireAndForget(projectile.ammunition.impactSound);
    }
    if(projectile.model){
      projectile.model.removeFromParent();
      projectile.model.dispose();
      projectile.model = undefined;
    }
  }

  static Update(delta: number = 0){
    if(!this.projectiles.length) return;
    for(const projectile of this.projectiles){
      if(projectile.done) continue;
      // The caster or target left the scene (scene change, destroyed)
      if(!projectile.caster.area || !projectile.target.area || (projectile.caster as any).destroyed){
        projectile.fired = false;
        this.Finish(projectile);
        continue;
      }

      if(!projectile.fired){
        projectile.delay -= delta;
        if(projectile.delay > 0) continue;
        this.Fire(projectile);
      }

      projectile.elapsed += delta;
      const t = Math.min(1, projectile.elapsed / projectile.duration);
      const model = projectile.model;
      if(model){
        model.visible = true;
        model.position.lerpVectors(projectile.from, projectile.to, t);
        const dir = this.tmpDir.copy(projectile.to).sub(projectile.from).normalize();
        model.quaternion.setFromUnitVectors(this.boltAxis, dir);
        model.update(delta);
      }
      if(t >= 1) this.Finish(projectile);
    }
    this.projectiles = this.projectiles.filter((p) => !p.done);
  }

  /** Drop every bolt in flight (leaving a module) */
  static Clear(){
    for(const projectile of this.projectiles){
      projectile.fired = false;
      this.Finish(projectile);
    }
    this.projectiles = [];
  }

}
