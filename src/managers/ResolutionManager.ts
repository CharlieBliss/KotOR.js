import { IScreenResolution } from "@/interface/graphics/IScreenResolution";

/**
 * ResolutionManager class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file ResolutionManager.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class ResolutionManager {

  public static vpScaleFactor: number = 1;

  /**
   * How much bigger the game's GUI (menus, the HUD) is drawn than its 800x600 layout's pixels. The GUI is laid
   * out in its own screen (getGUIWidth / getGUIHeight: the viewport divided by this) and the GUI camera spreads
   * that across the viewport, so on a large screen the HUD isn't left tiny. 'auto' (uiScaleSetting) is 1 up to
   * a 1080-pixel-tall view and grows in quarter steps above it.
   */
  public static uiScale: number = 1;
  public static uiScaleSetting: 'auto' | number = ResolutionManager.readUIScaleSetting();
  static UI_SCALE_KEY = 'kotorjs.uiScale';
  static UI_SCALE_BASE_HEIGHT = 1080;
  public static hpScaleFactor: number = 1;

  public static windowResolution: {width: number; height: number;} = {
    width: 0,
    height: 0
  };

  /**
   * When set (e.g. Forge module preview), viewport metrics use this element's
   * client box instead of the browser window.
   */
  public static viewportHost: HTMLElement | null = null;

  private static resolutionsGenerated: boolean = false;
  static #_screenResolution: IScreenResolution = {
    label: 'Auto Resolution',
    width: 1,
    height: 1,
    ratio: 1.33,
    isDynamicRes: true,
    getName: function(){ return this.label }
  };
  static availableResolutions: IScreenResolution[] = [];

  public static get screenResolution(): IScreenResolution {
    return this.#_screenResolution;
  };

  public static set screenResolution(res: IScreenResolution) {
    const isChanging = this.#_screenResolution != res;
    const oldRes = this.#_screenResolution;
    this.#_screenResolution = res;
    if(isChanging){
      this.processEventListener('onChange', res, oldRes);
    }
  };


  static #eventListeners: {[key: string]: Function[]} = {
    'onChange': [],
    'onResize': []
  };

  static addEventListener(key: string, func: Function){
    const el = this.#eventListeners[key];
    if(Array.isArray(el)){
      const canPush = el.indexOf(func) == -1;
      if(canPush){
        el.push(func);
      }
    }
  }

  static removeEventListener(key: string, func: Function){
    const el = this.#eventListeners[key];
    if(Array.isArray(el)){
      const idx = el.indexOf(func);
      const removeAll = typeof func === 'undefined';
      if(removeAll){
        this.#eventListeners[key] = [];
      }else if(idx >= 0){
        el.splice(idx, 1);
      }
    }
  }

  static processEventListener(key: string, ...args: any[]){
    const el = this.#eventListeners[key];
    if(Array.isArray(el)){
      for(let i = 0, len = el.length; i < len; i++){
        el[i](...args);
      }
    }
  }

  static setViewportHost(element: HTMLElement | null): void {
    this.viewportHost = element;
    this.syncWindowResolutionFromHost();
    this.recalculate();
  }

  static syncWindowResolutionFromHost(): void {
    if(this.viewportHost){
      this.windowResolution.width = Math.max(1, this.viewportHost.clientWidth);
      this.windowResolution.height = Math.max(1, this.viewportHost.clientHeight);
    }else{
      this.windowResolution.width = window.innerWidth;
      this.windowResolution.height = window.innerHeight;
    }
  }

  static getHostWidth(): number {
    if(this.viewportHost){
      return Math.max(1, this.viewportHost.clientWidth);
    }
    return window.innerWidth;
  }

  static getHostHeight(): number {
    if(this.viewportHost){
      return Math.max(1, this.viewportHost.clientHeight);
    }
    return window.innerHeight;
  }

  static getViewportWidth(): number {
    if(this.viewportHost){
      return this.getHostWidth();
    }
    return this.screenResolution.isDynamicRes ? window.innerWidth : this.screenResolution.width;
  }

  static getViewportHeight(): number {
    if(this.viewportHost){
      return this.getHostHeight();
    }
    return this.screenResolution.isDynamicRes ? window.innerHeight : this.screenResolution.height;
  }

  static getViewportWidthScaled(): number {
    if(this.viewportHost){
      return this.getHostWidth();
    }
    return this.screenResolution.isDynamicRes ? window.innerWidth : this.screenResolution.width * this.vpScaleFactor;
  }

  static getViewportHeightScaled(): number {
    if(this.viewportHost){
      return this.getHostHeight();
    }
    return this.screenResolution.isDynamicRes ? window.innerHeight : this.screenResolution.height * this.hpScaleFactor;
  }

  static getWindowWidth(): number {
    return this.windowResolution.width;
  }

  static getWindowHeight(): number {
    return this.windowResolution.height;
  }

  static readUIScaleSetting(): 'auto' | number {
    try {
      const raw = globalThis.localStorage?.getItem('kotorjs.uiScale');
      const n = Number(raw);
      return raw && Number.isFinite(n) && n >= 0.5 && n <= 4 ? n : 'auto';
    } catch (e) {
      return 'auto';
    }
  }

  /** Choose the GUI's scale: a number (0.5 - 4), or 'auto'. Remembered in this browser. */
  static setUIScale(setting: 'auto' | number){
    this.uiScaleSetting = setting === 'auto' ? 'auto' : Math.max(0.5, Math.min(4, Number(setting) || 1));
    try { globalThis.localStorage?.setItem(this.UI_SCALE_KEY, String(this.uiScaleSetting)); } catch (e) {}
    globalThis.dispatchEvent?.(new Event('resize'));
  }

  /** The scale 'auto' picks for a view this tall */
  static autoUIScale(height: number): number {
    return Math.max(1, Math.floor((height / this.UI_SCALE_BASE_HEIGHT) * 4) / 4);
  }

  /** The GUI's screen: the viewport in GUI pixels (see uiScale) */
  static getGUIWidth(): number {
    return this.getViewportWidth() / this.uiScale;
  }

  static getGUIHeight(): number {
    return this.getViewportHeight() / this.uiScale;
  }

  static getGUIWidthScaled(): number {
    return this.getViewportWidthScaled() / this.uiScale;
  }

  static getGUIHeightScaled(): number {
    return this.getViewportHeightScaled() / this.uiScale;
  }

  static recalculate(): void {
    const hostW = this.getHostWidth();
    const hostH = this.getHostHeight();
    this.windowResolution.width = hostW;
    this.windowResolution.height = hostH;
    // An embedded view (Forge's preview) keeps its GUI at 1:1
    this.uiScale = this.viewportHost ? 1 : (this.uiScaleSetting === 'auto' ? this.autoUIScale(this.getViewportHeight()) : this.uiScaleSetting);

    const scaleX = hostW / this.getViewportWidth();
    const scaleY = hostH / this.getViewportHeight();

    this.vpScaleFactor = 1.0;
    this.hpScaleFactor = 1.0;

    if(!this.viewportHost && !this.screenResolution.isDynamicRes){
      this.vpScaleFactor = scaleY;
      this.hpScaleFactor = scaleX;
    }
  }

  static getSupportedResolutions(){
    if(!this.resolutionsGenerated){
      this.availableResolutions.push({
        label: 'Auto Resolution',
        width: 1,
        height: 1,
        ratio: 1,
        isDynamicRes: true,
        getName: function(){ return this.label }
      });

      //4:3
      this.availableResolutions.push({
        label: '640 x 480 (4:3)',
        width: 640,
        height: 480,
        ratio: 1.33,
        isDynamicRes: false,
        getName: function(){ return this.label }
      });

      this.availableResolutions.push({
        label: '800 x 600 (4:3)',
        width: 800,
        height: 600,
        ratio: 1.33,
        isDynamicRes: false,
        getName: function(){ return this.label }
      });

      this.availableResolutions.push({
        label: '960 x 720 (4:3)',
        width: 960,
        height: 720,
        ratio: 1.33,
        isDynamicRes: false,
        getName: function(){ return this.label }
      });

      this.availableResolutions.push({
        label: '1024 x 768 (4:3)',
        width: 1024,
        height: 768,
        ratio: 1.33,
        isDynamicRes: false,
        getName: function(){ return this.label }
      });

      this.availableResolutions.push({
        label: '1280 x 1024 (4:3)',
        width: 1280,
        height: 1024,
        ratio: 1.33,
        isDynamicRes: false,
        getName: function(){ return this.label }
      });

      this.availableResolutions.push({
        label: '1600 x 1200 (4:3)',
        width: 1600,
        height: 1200,
        ratio: 1.33,
        isDynamicRes: false,
        getName: function(){ return this.label }
      });

      //16:9
      this.availableResolutions.push({
        label: '1280 x 720 (16:9)',
        width: 1280,
        height: 720,
        ratio: 1.78,
        isDynamicRes: false,
        getName: function(){ return this.label }
      });

      this.availableResolutions.push({
        label: '1600 x 900 (16:9)',
        width: 1600,
        height: 900,
        ratio: 1.78,
        isDynamicRes: false,
        getName: function(){ return this.label }
      });

      this.availableResolutions.push({
        label: '1920 x 1080 (16:9)',
        width: 1920,
        height: 1080,
        ratio: 1.78,
        isDynamicRes: false,
        getName: function(){ return this.label }
      });

      this.availableResolutions.push({
        label: '2048 x 1152 (16:9)',
        width: 2048,
        height: 1152,
        ratio: 1.78,
        isDynamicRes: false,
        getName: function(){ return this.label }
      });

      this.availableResolutions.push({
        label: '2880 x 1620 (16:9)',
        width: 2880,
        height: 1620,
        ratio: 1.78,
        isDynamicRes: false,
        getName: function(){ return this.label }
      });

      this.availableResolutions.push({
        label: '3072 x 1728 (16:9)',
        width: 3072,
        height: 1728,
        ratio: 1.78,
        isDynamicRes: false,
        getName: function(){ return this.label }
      });

      this.availableResolutions.push({
        label: '3840 x 2160 (16:9)',
        width: 3840,
        height: 2160,
        ratio: 1.78,
        isDynamicRes: false,
        getName: function(){ return this.label }
      });

      this.availableResolutions.push({
        label: '4096 x 2304 (16:9)',
        width: 4096,
        height: 2304,
        ratio: 1.78,
        isDynamicRes: false,
        getName: function(){ return this.label }
      });

      this.availableResolutions.push({
        label: '3440 x 1440 (Ultra-wide)',
        width: 3440,
        height: 1440,
        ratio: 2.39,
        isDynamicRes: false,
        getName: function(){ return this.label }
      });
      this.resolutionsGenerated = true;
    }

    return this.availableResolutions;

  }

}

window.addEventListener('resize', () => {
  ResolutionManager.syncWindowResolutionFromHost();
  ResolutionManager.recalculate();
});
