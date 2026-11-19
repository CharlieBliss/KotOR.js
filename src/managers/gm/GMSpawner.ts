import { GMFaction, gmItemResRef } from "@/managers/gm/GMVocab";
import { GMItems } from "@/managers/gm/GMItems";
import { GMTemplates } from "@/managers/gm/GMTemplates";
import type { GMGear } from "@/managers/gm/GMTemplates";
import { GMObjectKind } from "@/managers/gm/GMObjectKind";
import * as THREE from "three";
import { GameState } from "@/GameState";
import { ModuleCreatureArmorSlot } from "@/enums/module/ModuleCreatureArmorSlot";
import { GFFDataType } from "@/enums/resource/GFFDataType";
import { ResourceTypes } from "@/resource/ResourceTypes";
import { GFFObject } from "@/resource/GFFObject";
import { ResourceLoader } from "@/loaders";
import type { SaveGame } from "@/engine/SaveGame";
import { CharacterBuilder } from "@/engine/rules/CharacterBuilder";
import { CharacterRules } from "@/engine/rules/CharacterRules";
import type { GFFStruct } from "@/resource/GFFStruct";
import type { ICharacterBuild } from "@/engine/rules/CharacterBuilder";
import { TalentFeat, TalentSpell } from "@/talents";
import { ModuleObject, ModuleCreature, ModulePlayer, ModulePlaceable, ModuleItem } from "@/module";
import { Utility } from "@/utility/Utility";
import { GMNetworkManager, GMLootItem } from "@/managers/GMNetworkManager";
import type {
  GMCreatureSpawnConfig,
  GMCreatureTemplateInfo,
  GMPlaceableSpawnConfig,
  GMSceneBlueprint,
  GMPlayerSpawnConfig,
} from "@/managers/gm/GMTypes";
import { GMManager } from "@/managers/GMManager";
import { GMViewport } from "@/managers/gm/GMViewport";
import { GMReplication } from "@/managers/gm/GMReplication";
import { GMPlayers } from "@/managers/gm/GMPlayers";
import { CareersRuntime } from "@/managers/gm/careers/runtime";

/** Spawning GM objects: creatures, placeables and player characters from presets, game templates or saved descriptions, and kits of them. */
export class GMSpawner {
  /** A fresh, uncustomized copy of a placeable preset (lists copied, so edits never reach the preset) */
  static copyPlaceablePreset(preset: GMPlaceableSpawnConfig): GMPlaceableSpawnConfig {
    return {
      ...preset,
      scale: preset.scale ?? 1.0,
      zOffset: preset.zOffset ?? 0,
      modelKeywords: preset.modelKeywords ? [...preset.modelKeywords] : undefined,
      lootResRefs: [...(preset.lootResRefs || [])],
      customized: false,
    };
  }

  static getPlaceableAppearanceLabel(id: number): string {
    const app = GameState.AppearanceManager?.placeableAppearances?.get(id);
    return app?.label && app.label !== '****' ? `${app.label} (#${id})` : `#${id}`;
  }

  static findPlaceableAppearanceByLabel(label?: string): number | null {
    const wanted = (label || '').trim().toLowerCase();
    const map = GameState.AppearanceManager?.placeableAppearances;
    if (!wanted || !map) return null;
    let found: number | null = null;
    map.forEach((app, id) => {
      if (found === null && app && (app.label || '').toLowerCase() === wanted && app.modelname && app.modelname !== '****') {
        found = id;
      }
    });
    return found;
  }

  /**
   * The placeables.2da row a spawn config means: its exact label, else the checked model for its keywords,
   * else a loose keyword search (other games' tables), else its numeric id
   */
  static resolvePlaceableAppearance(config: Pick<GMPlaceableSpawnConfig, 'appearanceId' | 'appearanceLabel' | 'modelKeywords'>): number {
    const byLabel = this.findPlaceableAppearanceByLabel(config.appearanceLabel);
    if (byLabel !== null) return byLabel;
    const firstKeyword = (config.modelKeywords?.[0] || '').toLowerCase();
    const byKeyword = this.findPlaceableAppearanceByLabel(GMManager.PLACEABLE_KEYWORD_LABELS[firstKeyword]);
    if (byKeyword !== null) return byKeyword;
    return this.resolvePlaceableAppearanceId(config.modelKeywords, config.appearanceId ?? 52);
  }

  static resolvePlaceableAppearanceId(keywords?: string[], fallbackId: number = 52): number {
    const map = GameState.AppearanceManager?.placeableAppearances;
    if (!map || map.size === 0) return fallbackId;

    if (Array.isArray(keywords) && keywords.length > 0) {
      for (const kw of keywords) {
        const lowerKw = (kw || '').trim().toLowerCase();
        if (!lowerKw) continue;
        let matchedId = -1;
        map.forEach((app, id) => {
          if (matchedId >= 0 || !app) return;
          const model = (app.modelname || '').toLowerCase();
          const label = (app.label || '').toLowerCase();
          if (!model || model === '****') return;
          if (model.includes(lowerKw) || label.includes(lowerKw)) {
            matchedId = id;
          }
        });
        if (matchedId >= 0) return matchedId;
      }
    }

    const fbApp = map.get(fallbackId);
    if (fbApp && fbApp.modelname && fbApp.modelname !== '****') {
      return fallbackId;
    }

    let firstValid = fallbackId;
    map.forEach((app, id) => {
      if (firstValid === fallbackId && app?.modelname && app.modelname !== '****') {
        firstValid = id;
      }
    });
    return firstValid;
  }

  /**
   * Objects the area loads with the module are spawned by the area (ModuleArea.initAreaObjects); ones the GM
   * adds later are not. Without it they can't perceive or see anything (hasLineOfSight needs it), so NPCs
   * never notice enemies. Module scripts stay off in GM scenes, so their OnSpawn script doesn't run.
   */
  static markSpawned(obj: ModuleObject) {
    if (obj && !obj.spawned) obj.onSpawn(false);
  }

  /** A creature's appearance.2da row: its exact label if it has one, else its id */
  static resolveCreatureAppearance(config: Pick<GMCreatureSpawnConfig, 'appearanceId' | 'appearanceLabel'>): number {
    if (config.appearanceLabel) {
      const map = GameState.AppearanceManager?.appearances;
      if (map) {
        const wanted = config.appearanceLabel.toLowerCase();
        for (const [id, app] of map) {
          if (app?.label && app.label.toLowerCase() === wanted) return id;
        }
      }
    }
    return config.appearanceId ?? 28;
  }

  static creatureTemplateIndex: GMCreatureTemplateInfo[] | null = null;

  static creatureTemplateIndexLoading: Promise<GMCreatureTemplateInfo[]> | null = null;

  /** Read a creature template (.utc): its name, look, faction, stats, class and gear */
  static async describeCreatureTemplate(resRef: string): Promise<GMCreatureTemplateInfo | null> {
    const key = (resRef || '').toLowerCase();
    const buffer = await GMTemplates.loadBuffer(ResourceTypes.utc, key);
    if (!buffer) return null;
    try {
      const root = new GFFObject(buffer).RootNode;
      const value = (label: string, fallback: any = 0) => root.hasField(label) ? root.getFieldByLabel(label).getValue() : fallback;
      const first = root.hasField('FirstName') ? root.getFieldByLabel('FirstName').getCExoLocString().getValue() : '';
      const last = root.hasField('LastName') ? root.getFieldByLabel('LastName').getCExoLocString().getValue() : '';
      const appearanceId = Number(value('Appearance_Type', 0));
      const classRows = GameState.TwoDAManager?.datatables.get('classes')?.rows || {};
      const classStructs = root.hasField('ClassList') ? root.getFieldByLabel('ClassList').getChildStructs() : [];
      const classes = classStructs.map((st) => {
        const id = st.getFieldByLabel('Class')?.getValue() ?? 0;
        const row = classRows[id];
        const name = row ? (GameState.TLKManager?.GetStringById(Number(row.name))?.Value || row.label) : 'Class ' + id;
        return { id, level: Number(st.getFieldByLabel('ClassLevel')?.getValue() ?? 1), name };
      });
      const gear = root.hasField('Equip_ItemList') ? root.getFieldByLabel('Equip_ItemList').getChildStructs() : [];
      const slot = (s: number) => gear.find((st) => st.type === s)?.getFieldByLabel('EquippedRes')?.getValue() || '';
      return {
        resRef: key,
        name: [first, last].filter(Boolean).join(' ') || key,
        appearanceId,
        appearanceLabel: GameState.AppearanceManager?.appearances.get(appearanceId)?.label || '',
        factionId: Number(value('FactionID', 5)),
        hp: Number(value('MaxHitPoints', 0)) || Number(value('HitPoints', 0)),
        fp: Number(value('ForcePoints', 0)),
        level: classes.reduce((sum, c) => sum + c.level, 0) || 1,
        classId: classes[0]?.id ?? 0,
        classes: classes.map((c) => `${c.name} ${c.level}`).join(' / '),
        rightHandResRef: slot(ModuleCreatureArmorSlot.RIGHTHAND),
        leftHandResRef: slot(ModuleCreatureArmorSlot.LEFTHAND),
        armorResRef: slot(ModuleCreatureArmorSlot.ARMOR),
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * Rebuild a template at the level (and class) config.restat asks for, as levelling up would (CharacterBuilder):
   * class levels, feats, powers, skills and Force points. Going up, its main attack ability (the higher of
   * Strength and Dexterity) gains a point per four levels, as level-ups give them. Going down, its physical and
   * Force abilities shrink in proportion to the level above 10 (a level 20 rancor's Strength 45 is 24 at level 8),
   * but not below 14. Feats of its own that its class doesn't give (a beast's or a boss's) stay. Returns its new
   * vitality.
   */
  static restatTemplate(root: GFFStruct, config: GMCreatureSpawnConfig): number {
    const want = config.restat!;
    const get = (label: string, fallback: number) => root.hasField(label) ? Number(root.getFieldByLabel(label).getValue()) : fallback;
    const classStructs = root.hasField('ClassList') ? root.getFieldByLabel('ClassList').getChildStructs() : [];
    const oldLevel = classStructs.reduce((sum, st) => sum + (Number(st.getFieldByLabel('ClassLevel')?.getValue()) || 0), 0) || 1;
    const classId = want.classId ?? (Number(classStructs[0]?.getFieldByLabel('Class')?.getValue()) || 0);
    const level = Math.max(1, Math.min(50, Math.round(Number(want.level) || oldLevel)));

    const attributes = { str: get('Str', 14), dex: get('Dex', 14), con: get('Con', 14), int: get('Int', 10), wis: get('Wis', 12), cha: get('Cha', 10) };
    const labels = { str: 'Str', dex: 'Dex', con: 'Con', wis: 'Wis' } as const;
    if (level < oldLevel) {
      for (const key of Object.keys(labels) as (keyof typeof labels)[]) {
        const old = attributes[key];
        if (old <= 10) continue;
        attributes[key] = Math.round(Math.max(Math.min(old, 14), 10 + (old - 10) * level / oldLevel));
        GMTemplates.set(root, GFFDataType.BYTE, labels[key], attributes[key]);
      }
    } else {
      const shift = Math.floor(level / 4) - Math.floor(oldLevel / 4);
      const primary: 'str' | 'dex' = attributes.str >= attributes.dex ? 'str' : 'dex';
      attributes[primary] = Math.max(3, Math.min(255, attributes[primary] + shift));
      GMTemplates.set(root, GFFDataType.BYTE, labels[primary], attributes[primary]);
    }

    const build = CharacterBuilder.build({
      classId, level, attributes,
      alignment: config.factionId === GMFaction.HOSTILE ? 'dark' : 'light',
    });
    // Its own feats its class has nothing to do with stay; the class's are rebuilt for the new level
    const { code } = CharacterRules.featCodes(classId);
    const classFeats = new Set(CharacterRules.table('feat')
      .filter((row: any) => { const v = row[`${code}_list`]; return !!code && v !== undefined && v !== '' && v !== '****'; })
      .map((row: any) => Number(row.__index)));
    const own = root.hasField('FeatList')
      ? root.getFieldByLabel('FeatList').getChildStructs().map((st) => Number(st.getFieldByLabel('Feat')?.getValue())).filter((f) => Number.isFinite(f) && !classFeats.has(f))
      : [];
    GMTemplates.writeBuild(root, { ...build, feats: [...new Set([...build.feats, ...own])] }, classId, level);

    const hp = Math.max(1, Math.round(want.hp ?? build.maxHp));
    GMTemplates.set(root, GFFDataType.WORD, 'HitPoints', hp);
    GMTemplates.set(root, GFFDataType.WORD, 'CurrentHitPoints', hp);
    GMTemplates.set(root, GFFDataType.WORD, 'MaxHitPoints', hp);
    return hp;
  }

  /** Every creature template the game has (read once, then cached), for the template browser */
  static async loadCreatureTemplateIndex(): Promise<GMCreatureTemplateInfo[]> {
    if (this.creatureTemplateIndex) return this.creatureTemplateIndex;
    if (!this.creatureTemplateIndexLoading) {
      this.creatureTemplateIndexLoading = (async () => {
        const out: GMCreatureTemplateInfo[] = [];
        for (const resRef of GMManager.getAvailableUTCTemplates()) {
          const info = await this.describeCreatureTemplate(resRef);
          if (info) out.push(info);
        }
        out.sort((a, b) => a.name.localeCompare(b.name) || a.resRef.localeCompare(b.resRef));
        this.creatureTemplateIndex = out;
        return out;
      })().finally(() => { this.creatureTemplateIndexLoading = null; });
    }
    return this.creatureTemplateIndexLoading;
  }

  /** Place a template exactly as the game has it (its own faction too) */
  static creatureConfigFromTemplate(info: GMCreatureTemplateInfo): GMCreatureSpawnConfig {
    return {
      name: info.name,
      templateResRef: info.resRef,
      appearanceId: info.appearanceId,
      appearanceLabel: info.appearanceLabel || undefined,
      factionId: info.factionId,
      hp: info.hp,
      level: info.level,
      classId: info.classId,
    };
  }

  /**
   * Spawn a Creature / NPC in the current area
   */
  static async spawnCreature(
    config: GMCreatureSpawnConfig,
    position?: THREE.Vector3,
    facing?: number,
    existingNetId?: string
  ): Promise<ModuleCreature | null> {
    const area = GameState.module?.area;
    if (!area) return null;

    const targetLoc = position
      ? { position: position.clone(), facing: facing ?? 0 }
      : GMViewport.getCameraTargetSpawnPoint(3.5);

    const template = await GMTemplates.load(ResourceTypes.utc, config.templateResRef);
    const loadedFromUTC = !!template;
    const gff = template || new GFFObject();

    const root = gff.RootNode;
    // Remove TemplateResRef so creature.load() does not re-merge the unmodified .utc over our custom fields
    root.removeFieldByLabel('TemplateResRef');
    const setOrAdd = (type: GFFDataType, label: string, val: any) => GMTemplates.set(root, type, label, val);

    // A template keeps its own look, stats and gear unless the GM customized them
    const useConfig = !loadedFromUTC || !!config.customized;
    if (useConfig) {
      setOrAdd(GFFDataType.WORD, 'Appearance_Type', this.resolveCreatureAppearance(config));
    }
    const targetHp = config.hp || 50;
    setOrAdd(GFFDataType.WORD, 'FactionID', config.factionId ?? GMFaction.HOSTILE);
    if (useConfig) {
      setOrAdd(GFFDataType.WORD, 'HitPoints', targetHp);
      setOrAdd(GFFDataType.WORD, 'CurrentHitPoints', targetHp);
      setOrAdd(GFFDataType.WORD, 'MaxHitPoints', targetHp);
    }

    if (config.name) {
      GMTemplates.setText(root, 'FirstName', config.name);
      if (root.hasField('LastName')) GMTemplates.setText(root, 'LastName', '');
    }

    if (!loadedFromUTC) {
      setOrAdd(GFFDataType.BYTE, 'Str', 14);
      setOrAdd(GFFDataType.BYTE, 'Dex', 14);
      setOrAdd(GFFDataType.BYTE, 'Con', 14);
      setOrAdd(GFFDataType.BYTE, 'Int', 10);
      setOrAdd(GFFDataType.BYTE, 'Wis', 12);
      setOrAdd(GFFDataType.BYTE, 'Cha', 10);
      setOrAdd(GFFDataType.BYTE, 'NaturalAC', 2);
      setOrAdd(GFFDataType.BYTE, 'PerceptionRange', 13);
      setOrAdd(GFFDataType.BYTE, 'Race', 6);
      setOrAdd(GFFDataType.RESREF, 'ScriptAttacked', 'k_def_attacked01');
      setOrAdd(GFFDataType.RESREF, 'ScriptDamaged', 'k_def_damage01');
      setOrAdd(GFFDataType.RESREF, 'ScriptDeath', 'k_def_death01');
      setOrAdd(GFFDataType.RESREF, 'ScriptDialogue', 'k_def_dialogue01');
      setOrAdd(GFFDataType.RESREF, 'ScriptEndRound', 'k_def_combend01');
      setOrAdd(GFFDataType.RESREF, 'ScriptHeartbeat', 'k_def_heartbt01');
      setOrAdd(GFFDataType.RESREF, 'ScriptOnBlocked', 'k_def_blocked01');
      setOrAdd(GFFDataType.RESREF, 'ScriptOnNotice', 'k_def_percept01');
      setOrAdd(GFFDataType.RESREF, 'ScriptSpawn', 'k_def_spawn01');

      // What its class gives it at this level: feats, Force powers, skills and Force points
      const abilities = CharacterBuilder.build({
        classId: config.classId ?? 0,
        level: config.level || 4,
        attributes: { str: 14, dex: 14, con: 14, int: 12, wis: 14, cha: 12 },
        alignment: config.factionId === GMFaction.HOSTILE ? 'dark' : 'light',
      });
      GMTemplates.writeBuild(root, abilities, config.classId ?? 0, config.level || 4);
    }

    const restatHp = loadedFromUTC && config.restat ? this.restatTemplate(root, config) : 0;

    // Gear. Customized (or built without a template): the hands and armour are what the config says, '' for
    // empty. From a template: its own gear, with the config only filling an empty hand. Either way the template's
    // other slots (creature claws and hides, belts, implants) stay.
    GMTemplates.writeGear(root, config, useConfig);

    setOrAdd(GFFDataType.FLOAT, 'XPosition', targetLoc.position.x);
    setOrAdd(GFFDataType.FLOAT, 'YPosition', targetLoc.position.y);
    setOrAdd(GFFDataType.FLOAT, 'ZPosition', targetLoc.position.z);
    setOrAdd(GFFDataType.FLOAT, 'XOrientation', -Math.sin(targetLoc.facing));
    setOrAdd(GFFDataType.FLOAT, 'YOrientation', Math.cos(targetLoc.facing));

    const creature = new ModuleCreature(gff);
    // Its network id is fixed before it joins the area: world updates sent while its model loads must not
    // give it a second id (players would get a frozen duplicate)
    const netId = existingNetId || GMManager.getNextNetId('cre');
    GMManager.registerNetObject(netId, creature);
    creature.gmSpawning = true;
    creature.gmSpawnConfig = { ...config };
    if (config.barkText) {
      creature.gmBarkText = config.barkText;
    }
    if (config.stance) creature.setHeldStance(config.stance);

    area.attachObject(creature);
    creature.load();
    creature.firstName = config.name || creature.firstName;
    if (restatHp) {
      GMManager.setCreatureHP(creature, restatHp, restatHp);
    } else if (useConfig) {
      GMManager.setCreatureHP(creature, targetHp, targetHp);
    } else {
      // Some templates' current HP is above their maximum (it includes their Constitution bonus): start at full
      const full = Math.max(creature.getHP() || 0, creature.getMaxHP() || 0);
      if (full > 0) GMManager.setCreatureHP(creature, full, full);
    }
    GMManager.assignFaction(creature, config.factionId ?? GMFaction.HOSTILE);
    if (Array.isArray(config.lootResRefs)) {
      for (const resRef of config.lootResRefs) {
        if (resRef) creature.inventory.push(await this.createItemFromResRefAsync(resRef));
      }
    }

    const model = await creature.loadModel();
    // Removed or hidden while its model was still loading: discard the half-built replica cleanly
    if (creature.destroyed || !creature.box) {
      if (model) {
        model.removeFromParent();
        try { model.dispose(); } catch {}
      }
      delete creature.gmSpawning;
      return null;
    }
    if (model) {
      model.userData.moduleObject = creature;
      model.hasCollision = true;
    }
    creature.position.copy(targetLoc.position);
    creature.setFacing(targetLoc.facing, true);
    GameState.group.creatures.add(creature.container);

    creature.getCurrentRoom();
    creature.computeBoundingBox(true);
    this.markSpawned(creature);
    delete creature.gmSpawning;

    if (!existingNetId && GMNetworkManager.role !== 'offline') {
      GMNetworkManager.broadcastActorSpawn(GMReplication.serializeSingleActor(creature));
    }

    GMManager.notifyChange();
    return creature;
  }

  /**
   * Spawn an interactive Placeable or Container in the current area
   */
  static async spawnPlaceable(
    config: GMPlaceableSpawnConfig,
    position?: THREE.Vector3,
    facing?: number,
    existingNetId?: string
  ): Promise<ModulePlaceable | null> {
    const area = GameState.module?.area;
    if (!area) return null;

    const targetLoc = position
      ? { position: position.clone(), facing: facing ?? 0 }
      : GMViewport.getCameraTargetSpawnPoint(3.0);

    if (typeof config.zOffset === 'number' && config.zOffset !== 0) {
      targetLoc.position.z += config.zOffset;
    }

    const template = await GMTemplates.load(ResourceTypes.utp, config.templateResRef);
    const fromTemplate = !!template;
    const gff = template || new GFFObject();
    // A template keeps its own model, name and settings unless the GM customized them
    const useConfig = !fromTemplate || !!config.customized;
    const resolvedAppearanceId = useConfig
      ? this.resolvePlaceableAppearance(config)
      : (gff.RootNode.getFieldByLabel('Appearance')?.getValue() ?? this.resolvePlaceableAppearance(config));

    const root = gff.RootNode;
    root.removeFieldByLabel('TemplateResRef');
    const setOrAdd = (type: GFFDataType, label: string, val: any) => GMTemplates.set(root, type, label, val);

    if (useConfig) {
      GMTemplates.setText(root, 'LocName', config.name || 'Interactive Object');

      setOrAdd(GFFDataType.DWORD, 'Appearance', resolvedAppearanceId);
      setOrAdd(GFFDataType.BYTE, 'Useable', config.useable ? 1 : 0);
      setOrAdd(GFFDataType.BYTE, 'HasInventory', config.hasInventory ? 1 : 0);
      setOrAdd(GFFDataType.BYTE, 'Locked', config.locked ? 1 : 0);
      setOrAdd(GFFDataType.BYTE, 'OpenLockDC', config.openLockDC || 15);
      setOrAdd(GFFDataType.SHORT, 'HP', 50);
      setOrAdd(GFFDataType.SHORT, 'CurrentHP', 50);
    }
    // Placed objects can always be moved and interacted with
    setOrAdd(GFFDataType.BYTE, 'Static', 0);
    setOrAdd(GFFDataType.FLOAT, 'X', targetLoc.position.x);
    setOrAdd(GFFDataType.FLOAT, 'Y', targetLoc.position.y);
    setOrAdd(GFFDataType.FLOAT, 'Z', targetLoc.position.z);
    setOrAdd(GFFDataType.FLOAT, 'Bearing', targetLoc.facing);

    const plc = new ModulePlaceable(gff);
    const netId = existingNetId || GMManager.getNextNetId('plc');
    GMManager.registerNetObject(netId, plc);
    plc.gmSpawning = true;
    if (config.barkText) {
      plc.gmBarkText = config.barkText;
    }
    const scale = typeof config.scale === 'number' && config.scale > 0 ? config.scale : 1.0;
    plc.gmScale = scale;
    if (config.skillGate) plc.gmSkillGate = { ...config.skillGate };
    plc.gmSpawnConfig = {
      ...config,
      appearanceId: resolvedAppearanceId,
      scale,
      lootResRefs: Array.isArray(config.lootResRefs) ? [...config.lootResRefs] : []
    };

    area.attachObject(plc);
    plc.load();
    if (useConfig) {
      plc.appearance = resolvedAppearanceId;
      plc.useable = config.useable;
      plc.hasInventory = config.hasInventory;
      plc.locked = config.locked;
      plc.openLockDC = config.openLockDC || 15;
    }
    plc.position.copy(targetLoc.position);
    plc.bearing = targetLoc.facing;
    plc.rotation.set(0, 0, targetLoc.facing);

    // Populate container inventory items (on top of any the template carries)
    if ((useConfig ? config.hasInventory : plc.hasInventory) && Array.isArray(config.lootResRefs)) {
      for (const itemRes of config.lootResRefs) {
        if (!itemRes) continue;
        await this.addItemToObjectAsync(plc, itemRes);
      }
    }

    const model = await plc.loadModel();
    if (plc.destroyed || !plc.box) {
      if (model) {
        model.removeFromParent();
        try { model.dispose(); } catch {}
      }
      delete plc.gmSpawning;
      return null;
    }
    if (plc.container && scale !== 1.0) {
      plc.container.scale.setScalar(scale);
    }
    GameState.group.placeables.add(plc.container);

    if (model) {
      const pwk = await plc.loadWalkmesh(model.name);
      if (pwk?.mesh instanceof THREE.Object3D && pwk.faces && pwk.faces.length > 0) {
        GameState.walkmeshList.push(pwk.mesh);
        pwk.mat4.makeRotationFromEuler(plc.rotation);
        pwk.mat4.setPosition(plc.position.x, plc.position.y, plc.position.z + 0.01);
        pwk.mesh.geometry.applyMatrix4(pwk.mat4);
        pwk.updateMatrix();
        pwk.buildEdgeNormalHelpers();
        GameState.group.room_walkmeshes.add(pwk.mesh);
      }
    }

    plc.getCurrentRoom();
    plc.computeBoundingBox(true);
    this.markSpawned(plc);
    delete plc.gmSpawning;

    if (!existingNetId && GMNetworkManager.role !== 'offline') {
      GMNetworkManager.broadcastActorSpawn(GMReplication.serializeSingleActor(plc));
    }

    GMManager.notifyChange();
    return plc;
  }

  /**
   * Spawn a playable Player Character in the current area
   */
  /**
   * A player character's feats, Force powers, skill ranks, vitality and Force points: what its class and level
   * give it by the game's rules (CharacterBuilder), unless the config sets them explicitly
   */
  static buildPlayerAbilities(config: Partial<GMPlayerSpawnConfig>): ICharacterBuild {
    if (config.ruleset === 'careers') {
      return {
        classId: config.classId ?? 0,
        level: Math.max(1, Math.floor(config.level || 1)),
        feats: Array.isArray(config.featIds) ? [...config.featIds] : [],
        powers: Array.isArray(config.spellIds) ? [...config.spellIds] : [],
        skillRanks: Array.isArray(config.skillRanks) ? [...config.skillRanks] : new Array(8).fill(0),
        maxHp: typeof config.hp === 'number' && config.hp > 0 ? config.hp : 16,
        maxFp: typeof config.fp === 'number' && config.fp >= 0 ? config.fp : 0,
      };
    }
    const build = CharacterBuilder.build({
      classId: config.classId ?? 3,
      level: config.level || 1,
      attributes: {
        str: config.str || 14,
        dex: config.dex || 14,
        con: config.con || 14,
        int: config.int || 12,
        wis: config.wis || 14,
        cha: config.cha || 14,
      },
      alignment: config.alignment,
    });
    if (Array.isArray(config.featIds) && config.featIds.length) {
      build.feats = [...config.featIds];
      Object.assign(build, CharacterBuilder.vitalityWith(build.classId, build.level, {
        str: config.str || 14, dex: config.dex || 14, con: config.con || 14, int: config.int || 12, wis: config.wis || 14, cha: config.cha || 14,
      }, build.feats));
    }
    if (Array.isArray(config.spellIds) && config.spellIds.length) build.powers = [...config.spellIds];
    if (Array.isArray(config.skillRanks) && config.skillRanks.length) build.skillRanks = [...config.skillRanks];
    if (typeof config.hp === 'number' && config.hp > 0) build.maxHp = config.hp;
    if (typeof config.fp === 'number' && config.fp >= 0) build.maxFp = config.fp;
    return build;
  }

  static async spawnPlayerCharacter(
    config: GMPlayerSpawnConfig,
    position?: THREE.Vector3,
    facing?: number,
    existingNetId?: string
  ): Promise<ModulePlayer | null> {
    const area = GameState.module?.area;
    if (!area) return null;

    const targetLoc = position
      ? { position: position.clone(), facing: facing ?? 0 }
      : GMViewport.getCameraTargetSpawnPoint(3.0);

    const abilities = this.buildPlayerAbilities(config);
    const template = new GFFObject();
    const root = template.RootNode;
    const set = (type: GFFDataType, label: string, val: any) => GMTemplates.set(root, type, label, val);

    set(GFFDataType.DWORD, 'ObjectId', GameState.ModuleObjectManager.GetNextPlayerId());
    set(GFFDataType.WORD, 'Appearance_Type', config.appearanceId ?? 136);
    set(GFFDataType.WORD, 'PortraitId', config.portraitId ?? 15);
    set(GFFDataType.BYTE, 'Gender', config.gender ?? 0);
    set(GFFDataType.WORD, 'FactionID', GMFaction.PARTY);
    GMTemplates.setText(root, 'FirstName', config.name || 'Player Character');
    GMTemplates.setText(root, 'LastName', '');
    set(GFFDataType.WORD, 'HitPoints', abilities.maxHp);
    set(GFFDataType.WORD, 'CurrentHitPoints', abilities.maxHp);
    set(GFFDataType.WORD, 'MaxHitPoints', abilities.maxHp);
    set(GFFDataType.BYTE, 'Str', config.str || 14);
    set(GFFDataType.BYTE, 'Dex', config.dex || 14);
    set(GFFDataType.BYTE, 'Con', config.con || 14);
    set(GFFDataType.BYTE, 'Int', config.int || 12);
    set(GFFDataType.BYTE, 'Wis', config.wis || 14);
    set(GFFDataType.BYTE, 'Cha', config.cha || 14);
    set(GFFDataType.BYTE, 'GoodEvil', config.goodEvil ?? 50);
    set(GFFDataType.BYTE, 'NaturalAC', config.naturalAC ?? 2);
    set(GFFDataType.BYTE, 'PerceptionRange', 13);
    set(GFFDataType.WORD, 'SoundSetFile', config.gender === 1 ? 83 : 85);
    set(GFFDataType.BYTE, 'Race', config.race ?? 6);
    if (typeof config.subraceIndex === 'number') {
      set(GFFDataType.BYTE, 'SubraceIndex', config.subraceIndex);
    }
    if (config.saves) {
      set(GFFDataType.CHAR, 'FortSaveThrow', config.saves.fortitude);
      set(GFFDataType.CHAR, 'RefSaveThrow', config.saves.reflex);
      set(GFFDataType.CHAR, 'WillSaveThrow', config.saves.will);
    }

    // Scripts for party/player behavior
    set(GFFDataType.RESREF, 'ScriptAttacked', 'k_hen_attacked01');
    set(GFFDataType.RESREF, 'ScriptDamaged', 'k_hen_damage01');
    set(GFFDataType.RESREF, 'ScriptDialogue', 'k_hen_dialogue01');
    set(GFFDataType.RESREF, 'ScriptEndRound', 'k_hen_combend01');
    set(GFFDataType.RESREF, 'ScriptHeartbeat', 'k_hen_heartbt01');
    set(GFFDataType.RESREF, 'ScriptOnBlocked', 'k_hen_blocked01');
    set(GFFDataType.RESREF, 'ScriptOnNotice', 'k_hen_percept01');
    set(GFFDataType.RESREF, 'ScriptSpawn', 'k_hen_spawn01');

    // Class, Force powers, feats, skills and Force points, then gear
    GMTemplates.writeBuild(root, abilities, config.classId ?? 3, config.level || 8);
    GMTemplates.writeGear(root, config, true);

    const player = new ModulePlayer(template);
    player.gmPlayerConfig = { ...config };
    if (config.ownerPeerId) {
      player.gmOwnerPeerId = config.ownerPeerId;
    }
    player.npcId = -1;
    player.load();
    if (config.ruleset === 'careers' && config.careers) {
      player.careersRules = new CareersRuntime({ ...config.careers }, player);
    }
    GMManager.setCreatureHP(player, abilities.maxHp, abilities.maxHp);

    // Ensure runtime feats & spells are populated if not already
    {
      for (const fId of abilities.feats) {
        if (!player.getHasFeat(fId)) {
          player.addFeat(TalentFeat.From2DA({ __index: fId, ...(GameState.TwoDAManager.datatables.get('feat')?.rows?.[fId] || {}) }));
        }
      }
    }
    if (player.classes[0]) {
      for (const sId of abilities.powers) {
        if (!player.classes[0].spells.some(s => s.id === sId)) {
          player.classes[0].addSpell(new TalentSpell(sId));
        }
      }
    }

    // Starter items (Medpacs, Security Spikes). A network player's inventory is kept by the host
    // and sent to them; only characters controlled on this machine use the local inventory.
    const starterItems: GMLootItem[] = [{ resRef: 'g_i_medeqpmnt02', stack: 1 }, { resRef: 'g_i_secspike01', stack: 1 }];
    if (!config.ownerPeerId) {
      for (const entry of starterItems) {
        GameState.InventoryManager.addItem(await this.createItemFromResRefAsync(entry.resRef));
      }
    } else if (GMNetworkManager.role === 'host') {
      GMPlayers.addToPlayerInventory(player, starterItems);
    }

    return this.admitPlayer(player, targetLoc, {
      netIdPrefix: 'pc',
      existingNetId,
      // Other players' characters are world creatures here, not members of this machine's 3-slot party;
      // that keeps them off our HUD and out of party AI, and lets any number of players join
      remote: !!config.ownerPeerId && config.ownerPeerId !== GMNetworkManager.peerId,
      possess: !!config.possessImmediately,
    });
  }

  /**
   * Put a newly built player character into the scene: its model, the party (or the area, for another
   * player's character or a full party), a network id, players told about it, and possessed if asked
   */
  static async admitPlayer(
    player: ModulePlayer,
    loc: { position: THREE.Vector3; facing: number },
    opts: { netIdPrefix: string; existingNetId?: string; remote?: boolean; leadParty?: boolean; possess?: boolean }
  ): Promise<ModulePlayer> {
    const area = GameState.module.area;
    const pos = area.getNearestWalkablePoint ? area.getNearestWalkablePoint(loc.position, player.getHitDistance?.() || 0.5) : loc.position;
    player.position.copy(pos);
    player.setFacing(loc.facing, true);
    player.getCurrentRoom();

    const model = await player.loadModel();
    if (model) {
      model.userData.moduleObject = player;
      model.hasCollision = true;
    }

    if (!GMManager.spawnedPlayers.includes(player)) {
      GMManager.spawnedPlayers.push(player);
    }
    const party = GameState.PartyManager.party;
    if (opts.remote) {
      GameState.group.creatures.add(player.container);
      area.attachObject(player);
    } else {
      GameState.group.party.add(player.container);
      if (!party.includes(player)) {
        if (opts.leadParty) {
          party.unshift(player);
          if (party.length > 3) party.length = 3;
        } else if (party.length < 3) {
          party.push(player);
        } else {
          area.attachObject(player);
        }
      }
    }

    player.getCurrentRoom();
    player.computeBoundingBox(true);
    this.markSpawned(player);

    GMManager.registerNetObject(opts.existingNetId || GMManager.getNextNetId(opts.netIdPrefix), player);
    if (!opts.existingNetId && GMNetworkManager.role !== 'offline') {
      GMNetworkManager.broadcastActorSpawn(GMReplication.serializeSingleActor(player));
    }

    if (opts.possess) {
      GMManager.possessCharacter(player);
    }

    GMManager.notifyChange();
    return player;
  }

  /**
   * Load a Player Character from a SaveGame instance
   */
  static async loadPlayerFromSaveGame(saveGame: SaveGame, possessImmediately: boolean = true): Promise<ModulePlayer | null> {
    if (!saveGame || !GameState.module?.area) return null;
    try {
      await saveGame.initSaveGameResourceLoader();
      await saveGame.loadPIFO();
      await saveGame.loadPC();

      let template = saveGame.pc || GameState.PartyManager.PlayerTemplate;
      if (!template) {
        console.warn('[GMManager] SaveGame did not contain a valid PC template');
        return null;
      }

      const targetLoc = GMViewport.getCameraTargetSpawnPoint(3.0);
      const player = new ModulePlayer(template);
      player.npcId = -1;
      player.load();
      if (saveGame.PCNAME) {
        player.firstName = saveGame.PCNAME;
      }
      return await this.admitPlayer(player, targetLoc, { netIdPrefix: 'pc_save', possess: possessImmediately });
    } catch (e) {
      console.error('[GMManager] Failed to load PC from SaveGame:', e);
      return null;
    }
  }

  /**
   * Import a Player Character from an uploaded .utc file buffer
   */
  static async importPlayerFromUTCBuffer(buffer: Uint8Array, customName?: string, possessImmediately: boolean = true): Promise<ModulePlayer | null> {
    if (!buffer || !GameState.module?.area) return null;
    try {
      const gff = new GFFObject(buffer);
      const targetLoc = GMViewport.getCameraTargetSpawnPoint(3.0);
      const player = new ModulePlayer(gff);
      player.npcId = -1;
      player.load();
      if (customName) {
        player.firstName = customName;
      }
      GMManager.assignFaction(player, GMFaction.PARTY);
      return await this.admitPlayer(player, targetLoc, { netIdPrefix: 'pc_utc', leadParty: true, possess: possessImmediately });
    } catch (e) {
      console.error('[GMManager] Failed to import UTC player:', e);
      return null;
    }
  }

  static async createItemFromResRefAsync(itemResRef: string): Promise<ModuleItem> {
    const resKey = GMItems.forThisGame(itemResRef).toLowerCase().trim();
    const buffer = await GMTemplates.loadBuffer(ResourceTypes.uti, resKey);
    if (buffer) {
      const gff = new GFFObject(buffer);
      const item = new ModuleItem(gff);
      item.equippedRes = resKey;
      item.inventoryRes = resKey;
      if (!item.stackSize || item.stackSize < 1) item.stackSize = 1;
      item.initProperties();
      return item;
    }
    const item = new ModuleItem();
    item.equippedRes = resKey;
    item.inventoryRes = resKey;
    item.stackSize = 1;
    item.initProperties();
    return item;
  }

  static async addItemToObjectAsync(obj: ModuleObject, itemResRef: string): Promise<ModuleItem | null> {
    if (!obj || !itemResRef) return null;
    try {
      const item = await this.createItemFromResRefAsync(itemResRef);
      if (GMObjectKind.isPlaceable(obj)) {
        const plc = obj as ModulePlaceable;
        plc.hasInventory = true;
        plc.useable = true;
        plc.inventory.push(item);
      } else if (GMObjectKind.isCreature(obj)) {
        GameState.InventoryManager.addItem(item);
      }
      GMManager.notifyChange();
      return item;
    } catch (e) {
      console.error('[GMManager] Failed to add item async:', e);
      return null;
    }
  }

  static addItemToObject(obj: ModuleObject, itemResRef: string): ModuleItem | null {
    if (!obj || !itemResRef) return null;
    try {
      const resKey = itemResRef.toLowerCase().trim();
      const buffer = ResourceLoader.loadCachedResource(ResourceTypes.uti, resKey);
      const item = buffer ? new ModuleItem(new GFFObject(buffer)) : new ModuleItem();
      item.equippedRes = resKey;
      item.inventoryRes = resKey;
      if (!item.stackSize || item.stackSize < 1) item.stackSize = 1;
      if (!buffer) {
        item.load();
        // Also asynchronously hydrate from BIF if not in cache yet
        ResourceLoader.loadResource(ResourceTypes.uti, resKey).then((asyncBuf) => {
          if (asyncBuf && item.template) {
            item.template.merge(new GFFObject(asyncBuf));
            item.loaded = false;
            item.initProperties();
          }
        }).catch(() => {});
      } else {
        item.initProperties();
      }
      if (GMObjectKind.isPlaceable(obj)) {
        const plc = obj as ModulePlaceable;
        plc.hasInventory = true;
        plc.useable = true;
        plc.inventory.push(item);
      } else if (GMObjectKind.isCreature(obj)) {
        GameState.InventoryManager.addItem(item);
      }
      GMManager.notifyChange();
      return item;
    } catch (e) {
      console.error('[GMManager] Failed to add item:', e);
      return null;
    }
  }

  static async equipWeaponOnCreature(creature: ModuleCreature, slot: ModuleCreatureArmorSlot, itemResRef: string) {
    if (!creature) return;
    try {
      if (!itemResRef) {
        creature.unequipSlot(slot);
      } else {
        const item = await this.createItemFromResRefAsync(itemResRef);
        await creature.equipItem(slot, item);
      }
      if (GMNetworkManager.role !== 'offline') {
        GMNetworkManager.broadcastActorUpdate(GMReplication.serializeSingleActor(creature));
      }
      GMManager.notifyChange();
    } catch (e) {
      console.error('[GMManager] Failed to equip item on creature:', e);
    }
  }

  /**
   * Duplicate / Clone an existing Placeable or Creature slightly offset from its current position
   */
  static async duplicateObject(obj: ModuleObject): Promise<ModuleObject | null> {
    if (!obj || !GameState.module?.area) return null;
    const described = this.describeObject(obj);
    if (!described) return null;
    const offsetPos = new THREE.Vector3(obj.position.x + 1.5, obj.position.y + 1.0, obj.position.z);
    const cloned = await this.spawnDescribed(described, offsetPos, this.facingOf(obj));
    if (cloned) GMManager.selectObject(cloned);
    return cloned;
  }

  /** A creature's hands and armour as item resrefs ('' for empty) */
  static gearOf(cre: ModuleCreature): Required<GMGear> {
    // An item equipped after spawning (the combat AI drawing a sword from its pack) has no equipped resref: its
    // carried or template one names it
    const eq = cre?.equipment;
    return {
      rightHandResRef: gmItemResRef(eq?.RIGHTHAND),
      leftHandResRef: gmItemResRef(eq?.LEFTHAND),
      armorResRef: gmItemResRef(eq?.ARMOR),
    };
  }

  /** The item resrefs an object carries */
  static lootOf(obj: ModuleObject): string[] {
    return (obj?.inventory || []).map((i) => gmItemResRef(i)).filter(Boolean);
  }

  /** Which way an object faces (placeables keep a bearing, creatures a facing) */
  static facingOf(obj: ModuleObject): number {
    return GMObjectKind.isPlaceable(obj) ? (obj.bearing || 0) : ((obj as ModuleCreature).getFacing?.() || 0);
  }

  /**
   * A creature as the config that spawns it again as it is now: what it was spawned from (GM-placed) or its
   * module template, with its current side, health, gear, bark and stance
   */
  static describeCreature(cre: ModuleCreature): GMCreatureSpawnConfig {
    const base = cre.gmSpawnConfig;
    const mainClass = cre.getMainClass?.() || undefined;
    return {
      ...(base || {
        name: '',
        templateResRef: cre.getTemplateResRef() || undefined,
        appearanceId: cre.appearance || 28,
        level: cre.getTotalClassLevel?.() || 5,
        classId: mainClass ? mainClass.id : 0,
        // A module creature has no preset to fall back on: keep the look, health and gear it has now
        customized: true,
      }),
      name: cre.getName() || cre.firstName || base?.name || 'Actor',
      factionId: cre.factionId ?? GMFaction.HOSTILE,
      hp: cre.getMaxHP() || base?.hp || 50,
      ...this.gearOf(cre),
      barkText: cre.gmBarkText || '',
      stance: cre.heldStance || undefined,
      lootResRefs: base?.lootResRefs ? [...base.lootResRefs] : undefined,
    };
  }

  /**
   * A placeable as the config that spawns it again as it is now: what it was spawned from (GM-placed) or its
   * current model and settings, with its current lock, size, bark and skill gate
   */
  static describePlaceable(plc: ModulePlaceable): GMPlaceableSpawnConfig {
    const base = plc.gmSpawnConfig;
    return {
      ...(base || {
        name: plc.getName() || 'Placeable',
        appearanceId: plc.appearance || 52,
        useable: plc.useable,
        hasInventory: plc.hasInventory,
        openLockDC: plc.openLockDC || 15,
        lootResRefs: this.lootOf(plc),
      }),
      zOffset: 0,
      scale: plc.gmScale || base?.scale || 1.0,
      locked: plc.isLocked(),
      lootResRefs: base ? [...(base.lootResRefs || [])] : this.lootOf(plc),
      barkText: plc.gmBarkText || '',
      skillGate: plc.gmSkillGate ? { ...plc.gmSkillGate } : undefined,
    };
  }

  /** A creature or placeable as a config that spawns it again, or null for anything else */
  static describeObject(obj: ModuleObject):
    | { kind: 'creature'; config: GMCreatureSpawnConfig }
    | { kind: 'placeable'; config: GMPlaceableSpawnConfig }
    | null {
    if (GMObjectKind.isPlaceable(obj)) return { kind: 'placeable', config: this.describePlaceable(obj) };
    if (GMObjectKind.isCreature(obj)) return { kind: 'creature', config: this.describeCreature(obj) };
    return null;
  }

  /** Spawn what describeObject (or a saved kit / session) describes */
  static async spawnDescribed(
    described: { kind: 'creature'; config: GMCreatureSpawnConfig } | { kind: 'placeable'; config: GMPlaceableSpawnConfig },
    position: THREE.Vector3,
    facing: number
  ): Promise<ModuleObject | null> {
    return described.kind === 'creature'
      ? this.spawnCreature(described.config, position, facing)
      : this.spawnPlaceable(described.config, position, facing);
  }

  /**
   * Build a multi-placeable Scene Blueprint (e.g. Office Building, Ancient Temple, Command Center)
   * either in a freshly loaded clean default background (danm14aa or chosen module) or in the current scene.
   */
  static async buildSceneBlueprint(
    blueprint: GMSceneBlueprint,
    options?: {
      loadCleanBackgroundFirst?: boolean;
      backgroundModuleResRef?: string;
      clearExistingPlaceables?: boolean;
      spawnNPCs?: boolean;
      useCameraTargetAsOrigin?: boolean;
    }
  ) {
    if (!blueprint) return;
    const loadClean = options?.loadCleanBackgroundFirst ?? false;
    const targetModule = options?.backgroundModuleResRef || blueprint.recommendedModule || 'danm14aa';
    const spawnNPCs = options?.spawnNPCs ?? true;

    if (loadClean) {
      const loaded = await GMManager.loadScene(targetModule, {
        keepCreatures: false,
        keepTriggers: false,
        keepPlaceables: false,
        preserveParty: GMManager.preservePartyOnWarp
      });
      // Placed once the new scene is up (not awaited, like loadScene itself)
      GMManager.waitForScene(loaded, Infinity).then((ready) => {
        if (ready) return this.spawnBlueprintInCurrentArea(blueprint, { useCameraTargetAsOrigin: false, clearExistingPlaceables: false, spawnNPCs });
      });
      return;
    }

    await this.spawnBlueprintInCurrentArea(blueprint, {
      useCameraTargetAsOrigin: options?.useCameraTargetAsOrigin ?? false,
      clearExistingPlaceables: options?.clearExistingPlaceables ?? false,
      spawnNPCs
    });
  }

  static async spawnBlueprintInCurrentArea(
    blueprint: GMSceneBlueprint,
    options?: {
      useCameraTargetAsOrigin?: boolean;
      clearExistingPlaceables?: boolean;
      spawnNPCs?: boolean;
    }
  ) {
    const mod = GameState.module;
    if (!mod || !mod.area) return;

    if (options?.clearExistingPlaceables) {
      const allExisting = [...mod.area.placeables];
      for (const plc of allExisting) {
        GMManager.deleteObject(plc);
      }
    }

    let originX = mod.entryX || 0;
    let originY = mod.entryY || 0;
    let originZ = mod.entryZ || 0;
    let baseYaw = Math.atan2(mod.entryDirectionX || 0, mod.entryDirectionY || 1);

    if (options?.useCameraTargetAsOrigin) {
      const target = GMViewport.getCameraTargetSpawnPoint(3.0);
      originX = target.position.x;
      originY = target.position.y;
      originZ = target.position.z;
      const cam = GMViewport.getActiveThreeCamera();
      if (cam) {
        baseYaw = Math.atan2(target.position.x - cam.position.x, target.position.y - cam.position.y);
      }
    }

    const cosA = Math.cos(-baseYaw);
    const sinA = Math.sin(-baseYaw);

    for (const item of blueprint.items) {
      const worldX = originX + (item.dx * cosA - item.dy * sinA);
      const worldY = originY + (item.dx * sinA + item.dy * cosA);
      const groundZ = GMViewport.getGroundZAt(worldX, worldY, originZ);
      const worldZ = groundZ + (item.dz || 0);
      const worldFacing = Utility.NormalizeRadian(baseYaw + (item.yawDeg * Math.PI) / 180);

      await this.spawnPlaceable(
        {
          ...item.config,
          zOffset: 0
        },
        new THREE.Vector3(worldX, worldY, worldZ),
        worldFacing
      );
    }

    if ((options?.spawnNPCs ?? true) && Array.isArray(blueprint.creatures)) {
      for (const creItem of blueprint.creatures) {
        const worldX = originX + (creItem.dx * cosA - creItem.dy * sinA);
        const worldY = originY + (creItem.dx * sinA + creItem.dy * cosA);
        const groundZ = GMViewport.getGroundZAt(worldX, worldY, originZ);
        const worldZ = groundZ + (creItem.dz || 0);
        const worldFacing = Utility.NormalizeRadian(baseYaw + (creItem.yawDeg * Math.PI) / 180);

        await this.spawnCreature(
          creItem.config,
          new THREE.Vector3(worldX, worldY, worldZ),
          worldFacing
        );
      }
    }

    if (GMNetworkManager.role === 'host') {
      GMNetworkManager.sendWorldSnapshot();
    }
    GMManager.notifyChange();
  }

  /**
   * Spawn a group of one creature preset in a ring around a point (the camera target by default)
   */
  static async spawnEncounter(options: { presetIndex: number; count: number; spread?: number; factionId?: number; center?: THREE.Vector3 }): Promise<string[]> {
    const preset = GMManager.CREATURE_PRESETS[options.presetIndex] || GMManager.CREATURE_PRESETS[0];
    const count = Math.min(12, Math.max(1, Math.round(options.count || 1)));
    const spread = Math.max(0.5, options.spread ?? 2.5);
    const center = options.center || GMViewport.getCameraTargetSpawnPoint().position;
    const netIds: string[] = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const radius = count === 1 ? 0 : spread;
      const x = center.x + Math.cos(angle) * radius;
      const y = center.y + Math.sin(angle) * radius;
      const pos = new THREE.Vector3(x, y, GMViewport.getGroundZAt(x, y, center.z));
      const facing = Math.atan2(center.x - x, center.y - y);
      const cre = await this.spawnCreature(
        { ...preset, name: count > 1 ? `${preset.name} ${i + 1}` : preset.name, factionId: options.factionId ?? preset.factionId },
        pos,
        facing
      );
      if (cre) netIds.push(cre.gmNetId);
    }
    GMManager.notifyChange();
    return netIds;
  }
}
