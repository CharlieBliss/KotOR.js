import { GameState } from "@/GameState";
import { UIIconTimerType } from "@/enums/engine/UIIconTimerType";

const UI_TIMER_DURATION = 10;

/**
 * UINotificationManager class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file UINotificationManager.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class UINotificationManager {

  static ItemLostTimer: number = 0;
  static ItemReceivedTimer: number = 0;
  static PlotXPReceivedTimer: number = 0;
  static CreditsReceivedTimer: number = 0;
  static StealthXPReceivedTimer: number = 0;
  static JournalEntryAddedTimer: number = 0;
  static LightShiftTimer: number = 0;
  static DarkShiftTimer: number = 0;

  static bNotificationSoundQueued: boolean = false;
  static pendingNotificationSound: string = 'gui_quest';

  /** Look up the standard LightSide / DarkSide guisounds.2da resref (`mus_s_lightshort` / `mus_s_darkshort`) */
  static GetAlignmentShiftSound(alignment: 'light' | 'dark'): string {
    const label = alignment === 'light' ? 'LightSide' : 'DarkSide';
    const fallback = alignment === 'light' ? 'mus_s_lightshort' : 'mus_s_darkshort';
    const rows = GameState.TwoDAManager?.datatables?.get('guisounds')?.rows;
    if (rows) {
      for (const key of Object.keys(rows)) {
        const row = rows[key];
        if (String(row?.label || '').trim().toLowerCase() === label.toLowerCase()) {
          const ref = String(row.soundresref || '').trim().toLowerCase();
          if (ref && ref !== '****') return ref;
        }
      }
    }
    return fallback;
  }

  /** Play the standard Light Side / Dark Side shift music stinger on the local GUI audio emitter */
  static PlayAlignmentShiftSound(alignment: 'light' | 'dark', soundResRef?: string): void {
    const resRef = (soundResRef && soundResRef.trim()) ? soundResRef.trim().toLowerCase() : this.GetAlignmentShiftSound(alignment);
    GameState.guiAudioEmitter?.playSoundFireAndForget?.(resRef);
  }

  static EnableUINotificationIconType(type: UIIconTimerType) {
    this.bNotificationSoundQueued = true;
    this.pendingNotificationSound = 'gui_quest';
    switch(type) {
      case UIIconTimerType.ITEM_LOST:
        this.ItemLostTimer = UI_TIMER_DURATION;
        break;
      case UIIconTimerType.ITEM_RECEIVED:
        this.ItemReceivedTimer = UI_TIMER_DURATION;
        break;
      case UIIconTimerType.CREDITS_RECEIVED:
        this.CreditsReceivedTimer = UI_TIMER_DURATION;
        break;  
      case UIIconTimerType.JOURNAL_ENTRY_ADDED:
        this.JournalEntryAddedTimer = UI_TIMER_DURATION;
        break;
      case UIIconTimerType.LIGHT_SHIFT:
        this.LightShiftTimer = UI_TIMER_DURATION;
        this.pendingNotificationSound = this.GetAlignmentShiftSound('light');
        break;  
      case UIIconTimerType.DARK_SHIFT:
        this.DarkShiftTimer = UI_TIMER_DURATION;
        this.pendingNotificationSound = this.GetAlignmentShiftSound('dark');
        break;
      case UIIconTimerType.PLOT_XP_RECEIVED:
        this.PlotXPReceivedTimer = UI_TIMER_DURATION;
        break;  
      case UIIconTimerType.STEALTH_XP_RECEIVED:
        this.StealthXPReceivedTimer = UI_TIMER_DURATION;
        break;
    }
  }
  
}
