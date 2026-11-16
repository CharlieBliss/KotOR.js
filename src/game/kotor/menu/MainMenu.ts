import { AudioLoader } from "@/audio/AudioLoader";
import { CurrentGame } from "@/engine/CurrentGame";
import { MenuSaveLoadMode } from "@/enums/gui/MenuSaveLoadMode";
import { GameState } from "@/GameState";
import { GameMenu, LBL_3DView } from "@/gui";
import type { GUIListBox, GUILabel, GUIButton, GUIControl } from "@/gui";
import { MDLLoader, TextureLoader } from "@/loaders";
import { OdysseyModel } from "@/odyssey";
import { OdysseyModel3D } from "@/three/odyssey";
import { AudioEngine } from "@/audio/AudioEngine";
import { ApplicationProfile } from "@/utility/ApplicationProfile";
import { ApplicationEnvironment } from "@/enums/ApplicationEnvironment";
import * as THREE from "three";

/** Distance between the menu's button slots, in GUI units */
const MENU_SLOT_STEP = 30.5;

/**
 * MainMenu class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file MainMenu.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class MainMenu extends GameMenu {

  LB_MODULES: GUIListBox;
  LBL_3DVIEW: GUILabel;
  LBL_GAMELOGO: GUILabel;
  LBL_BW: GUILabel;
  LBL_LUCAS: GUILabel;
  LBL_MENUBG: GUILabel;
  BTN_LOADGAME: GUIButton;
  BTN_NEWGAME: GUIButton;
  BTN_MOVIES: GUIButton;
  BTN_OPTIONS: GUIButton;
  LBL_NEWCONTENT: GUILabel;
  BTN_WARP: GUIButton;
  BTN_EXIT: GUIButton;
  _3dViewModel: OdysseyModel3D;
  _3dView: LBL_3DView;
  bgMusicBuffer: ArrayBuffer;
  bgMusicResRef: string = 'mus_theme_cult';

  constructor(){
    super();
    this.gui_resref = 'mainmenu16x12';
    this.background = '1600x1200back';
    this.voidFill = true;
    this.userCanClose = false;
  }

  async menuControlInitializer(skipInit: boolean = false) {
    await super.menuControlInitializer();
    if(skipInit) return;
    return new Promise<void>((resolve, reject) => {
      this.selectedControl = this.BTN_NEWGAME;

      this.LB_MODULES.hide();
      this.LBL_BW.hide();
      this.LBL_LUCAS.hide();
      this.BTN_WARP.setText('GM Mode');
      this.BTN_WARP.show();
      this.BTN_WARP.addEventListener('click', (e) => {
        e.stopPropagation();
        GameState.EnterGMMode('danm14aa');
      });

      // The unused "new content" label becomes the menu entry for joining someone else's GM game
      this.LBL_NEWCONTENT.setTextAlignment(this.BTN_EXIT.text.alignment);
      this.LBL_NEWCONTENT.setText('Join GM Game');
      this.LBL_NEWCONTENT.show();
      this.LBL_NEWCONTENT.addEventListener('click', (e) => {
        e.stopPropagation();
        GameState.GMNetworkManager.events.dispatchEvent('open-join');
      });
      this.addMenuSlots([this.BTN_WARP, this.LBL_NEWCONTENT]);

      this.BTN_NEWGAME.addEventListener('click', (e) => {
        e.stopPropagation();
        GameState.CharGenManager.Start();
      });

      this.BTN_LOADGAME.addEventListener('click', (e) => {
        e.stopPropagation();
        //Game.LoadModule('danm14aa', null, () => { console.log('ready to load'); })
        this.manager.MenuSaveLoad.mode = MenuSaveLoadMode.LOADGAME;
        this.manager.MenuSaveLoad.open()
      });

      this.BTN_MOVIES.addEventListener('click', (e) => {
        e.stopPropagation();
        //this.Hide();
        this.manager.MainMovies.open();
        //Game.LoadModule('danm14aa', null, () => { console.log('ready to load'); })
      });

      this.BTN_OPTIONS.addEventListener('click', (e) => {
        e.stopPropagation();
        //this.Hide();
        this.manager.MainOptions.open();
      });

      this.BTN_EXIT.addEventListener('click', (e) => {
        e.stopPropagation();
        if (ApplicationProfile.ENV === ApplicationEnvironment.ELECTRON) {
          window.close();
        }else{
          if(window.opener){
            window.close();
            return;
          }
          alert('To exit the game in your browser, close this tab or window. For the best experience, open the game from the KotOR.js launcher so Exit Game works from the menu.');
        }
      });

      MDLLoader.loader.load('mainmenu').then((mdl: OdysseyModel) => {
        this.tGuiPanel.widget.userData.fill.visible = false;
        this._3dView = new LBL_3DView();
        this._3dView.setControl(this.LBL_3DVIEW);
        this._3dView.visible = true;
        (this.LBL_3DVIEW.getFill().material as THREE.ShaderMaterial).uniforms.map.value = this._3dView.texture.texture;
        (this.LBL_3DVIEW.getFill().material as THREE.ShaderMaterial).transparent = false;
        this._3dView.setControl(this.LBL_3DVIEW);
        (this.LBL_3DVIEW.getFill().material as any).visible = true;
        
        OdysseyModel3D.FromMDL(mdl, { 
          // manageLighting: false,
          context: this._3dView
        }).then( (model: OdysseyModel3D) => {
          console.log('Model Loaded', model);
          this._3dViewModel = model;
          
          this._3dView.camera.position.copy(model.camerahook.position);
          this._3dView.camera.quaternion.copy(model.camerahook.quaternion);

          this._3dView.addModel(this._3dViewModel);
          TextureLoader.LoadQueue().then(() => {
            this._3dViewModel.playAnimation(0, true);
            resolve();
          });
        }).catch((e: any) => {

        });
      });
    });
  }

  /**
   * The menu background has five button slots. Add more by repeating its middle slot, and move Quit to the
   * bottom so GM Mode and Join GM Game sit in the new slots, looking like the other menu entries.
   */
  addMenuSlots(buttons: GUIControl[]){
    const bg = this.LBL_MENUBG;
    const fill = bg?.border?.fill;
    if(!bg || !fill?.mesh || !buttons.length) return;

    const extra = buttons.length;
    const texHeight = bg.extent.height;
    const height = texHeight + MENU_SLOT_STEP * extra;
    // The texture is drawn in strips: down to just below its middle slot, then that slot again once per
    // extra slot, then the rest. Strips join either side of the texture's middle, where the curved side
    // brackets line up, and in the gaps between slots.
    const cut = texHeight / 2 + MENU_SLOT_STEP / 2;
    const resume = texHeight / 2 - MENU_SLOT_STEP / 2;
    const strips: [number, number][] = [[0, cut]];
    for(let i = 1; i < extra; i++) strips.push([resume, cut]);
    strips.push([resume, texHeight]);

    const positions: number[] = [];
    const uvs: number[] = [];
    const index: number[] = [];
    let drawnTop = 0;
    strips.forEach(([from, to], i) => {
      const y0 = 0.5 - drawnTop / height;
      const y1 = 0.5 - (drawnTop + to - from) / height;
      const v0 = 1 - from / texHeight;
      const v1 = 1 - to / texHeight;
      positions.push(-0.5, y0, 0,   0.5, y0, 0,   -0.5, y1, 0,   0.5, y1, 0);
      uvs.push(0, v0,   1, v0,   0, v1,   1, v1);
      const o = i * 4;
      index.push(o, o + 2, o + 1, o + 2, o + 3, o + 1);
      drawnTop += to - from;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    fill.geometry?.dispose();
    fill.geometry = geometry;
    fill.mesh.geometry = geometry;

    bg.setExtentHeight(height);
    bg.calculatePosition();
    bg.resizeControl();

    const quitTop = this.BTN_EXIT.extent.top;
    const place = (control: GUIControl, top: number) => {
      control.setExtentLeft(this.BTN_EXIT.extent.left);
      control.setExtentWidth(this.BTN_EXIT.extent.width);
      control.setExtentHeight(this.BTN_EXIT.extent.height);
      control.setExtentTop(top);
      control.calculatePosition();
      control.resizeControl();
    };
    buttons.forEach((control, i) => place(control, quitTop + MENU_SLOT_STEP * i));
    place(this.BTN_EXIT, quitTop + MENU_SLOT_STEP * extra);
  }

  Start(){
    return new Promise<void>( (resolve, reject) => {
      GameState.gmMode = false;
      // Back at the main menu means out of any GM session (e.g. a player quitting from Options)
      GameState.GMManager.active = false;
      if(GameState.GMNetworkManager.role !== 'offline') GameState.GMNetworkManager.disconnect();
      this.manager.ClearMenus();
      AudioLoader.LoadMusic(this.bgMusicResRef).then((data: Uint8Array) => {
        AudioEngine.GetAudioEngine().setAudioBuffer('BACKGROUND_MUSIC_DAY', data.buffer as ArrayBuffer, this.bgMusicResRef);
        AudioEngine.GetAudioEngine().areaMusicDayAudioEmitter.play();
        this.open();
        resolve();
      }, () => {
        this.open();
        console.error('Background Music not found', this.bgMusicResRef);
        resolve();
      });
    });
  }

  update(delta = 0) {
    super.update(delta);
    try {
      this._3dView.render(delta);
    } catch (e: any) {
      console.error(e);
    }
  }

  show() {
    super.show();
    if(this.bgMusicBuffer){
      AudioEngine.GetAudioEngine().setAudioBuffer('BACKGROUND_MUSIC_DAY', this.bgMusicBuffer, this.bgMusicResRef);
      AudioEngine.GetAudioEngine().areaMusicDayAudioEmitter.play();
    }
    GameState.AlphaTest = 0.5;
    CurrentGame.InitGameInProgressFolder(false).then( () => {

    });
  }

  triggerControllerDUpPress() {
    if (!this.selectedControl) {
      this.selectedControl = this.BTN_NEWGAME;
    }
    this.BTN_NEWGAME.onHoverOut();
    this.BTN_LOADGAME.onHoverOut();
    this.BTN_MOVIES.onHoverOut();
    this.BTN_OPTIONS.onHoverOut();
    this.BTN_EXIT.onHoverOut();
    if (this.selectedControl == this.BTN_EXIT) {
      this.selectedControl = this.BTN_OPTIONS;
    } else if (this.selectedControl == this.BTN_OPTIONS) {
      this.selectedControl = this.BTN_MOVIES;
    } else if (this.selectedControl == this.BTN_MOVIES) {
      this.selectedControl = this.BTN_LOADGAME;
    } else if (this.selectedControl == this.BTN_LOADGAME) {
      this.selectedControl = this.BTN_NEWGAME;
    } else if (this.selectedControl == this.BTN_NEWGAME) {
      this.selectedControl = this.BTN_EXIT;
    }
    this.selectedControl.onHoverIn();
  }

  triggerControllerDDownPress() {
    if (!this.selectedControl) {
      this.selectedControl = this.BTN_NEWGAME;
    }
    this.BTN_NEWGAME.onHoverOut();
    this.BTN_LOADGAME.onHoverOut();
    this.BTN_MOVIES.onHoverOut();
    this.BTN_OPTIONS.onHoverOut();
    this.BTN_EXIT.onHoverOut();
    if (this.selectedControl == this.BTN_NEWGAME) {
      this.selectedControl = this.BTN_LOADGAME;
    } else if (this.selectedControl == this.BTN_LOADGAME) {
      this.selectedControl = this.BTN_MOVIES;
    } else if (this.selectedControl == this.BTN_MOVIES) {
      this.selectedControl = this.BTN_OPTIONS;
    } else if (this.selectedControl == this.BTN_OPTIONS) {
      this.selectedControl = this.BTN_EXIT;
    } else if (this.selectedControl == this.BTN_EXIT) {
      this.selectedControl = this.BTN_NEWGAME;
    }
    this.selectedControl.onHoverIn();
  }

  triggerControllerAPress() {
    if (this.selectedControl) {
      this.selectedControl.click();
    }
  }

  triggerControllerBPress() {
    this.BTN_EXIT.click();
  }
  
}
