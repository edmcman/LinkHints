/*
 * BackgroundProgram - Options and lifecycle management
 * Tab state management has been moved to TopFrameController
 */

import iconsChecksum from "../icons/checksum";
import { addListener, fireAndForget, log, Resets } from "../shared/main";
import type {
  FromBackground,
  FromOptions,
  FromPopup,
  ToBackground,
  ToOptions,
  ToPopup,
} from "../shared/messages";
import {
  flattenOptions,
  getDefaults,
  getRawOptions,
  type OptionsData,
  type PartialOptions,
  unflattenOptions,
} from "../shared/options";
import type { TabsPerf } from "../shared/perf";
import { tweakable, unsignedInt } from "../shared/tweakable";

export const t = {
  PREVENT_OVERTYPING_DURATION: unsignedInt(100), // ms
};

export const tMeta = tweakable("Background", t);

export default class BackgroundProgram {
  options: OptionsData;
  
  resets = new Resets();
  
  tabsPerf: TabsPerf = {} as TabsPerf;

  constructor() {
    const mac = false;
    const defaults = getDefaults({ mac });
    this.options = {
      defaults,
      values: defaults,
      raw: {},
      errors: [],
      mac,
    };
  }

  async start(): Promise<void> {
    log("log", "BackgroundProgram#start", BROWSER, PROD);

    try {
      await this.updateOptions({ isInitial: true });
    } catch (errorAny) {
      const error = errorAny as Error;
      this.options.errors = [error.message];
    }

    if (!PROD) {
      await this.restoreTabsPerf();
    }

    const tabs = await browser.tabs.query({});

    this.resets.add(
      addListener(
        browser.runtime.onMessage,
        this.onMessage.bind(this),
        "BackgroundProgram#onMessage"
      ),
      addListener(
        browser.tabs.onActivated,
        this.onTabActivated.bind(this),
        "BackgroundProgram#onTabActivated"
      ),
      addListener(
        browser.tabs.onCreated,
        this.onTabCreated.bind(this),
        "BackgroundProgram#onTabCreated"
      ),
      addListener(
        browser.tabs.onUpdated,
        this.onTabUpdated.bind(this),
        "BackgroundProgram#onTabUpdated",
        BROWSER === "firefox" ? { properties: ["status", "pinned"] } : undefined
      ),
      addListener(
        browser.tabs.onRemoved,
        this.onTabRemoved.bind(this),
        "BackgroundProgram#onTabRemoved"
      )
    );

    fireAndForget(
      browser.browserAction.setBadgeBackgroundColor({ color: COLOR_BADGE }),
      "BackgroundProgram#start->setBadgeBackgroundColor"
    );

    fireAndForget(
      this.maybeOpenTutorial(),
      "BackgroundProgram#start->maybeOpenTutorial"
    );

    fireAndForget(
      this.maybeReopenOptions(),
      "BackgroundProgram#start->maybeReopenOptions"
    );

    log("log", "BackgroundProgram#start", "started", { tabs: tabs.length });
  }

  stop(): void {
    log("log", "BackgroundProgram#stop");
    this.resets.reset();
  }

  async sendContentMessage(
    message: FromBackground,
    { tabId, frameId }: { tabId: number; frameId: number | "all_frames" }
  ): Promise<void> {
    await (frameId === "all_frames"
      ? browser.tabs.sendMessage(tabId, message)
      : browser.tabs.sendMessage(tabId, message, { frameId }));
  }

  sendPopupMessage(message: ToPopup): void {
    log("log", "BackgroundProgram#sendPopupMessage", message);
    fireAndForget(
      this.sendBackgroundMessage({ type: "ToPopup", message }),
      "BackgroundProgram#sendPopupMessage",
      message
    );
  }

  sendOptionsMessage(message: ToOptions): void {
    log("log", "BackgroundProgram#sendOptionsMessage", message);
    fireAndForget(
      this.sendBackgroundMessage({ type: "ToOptions", message }),
      "BackgroundProgram#sendOptionsMessage",
      message
    );
  }

  async sendBackgroundMessage(message: FromBackground): Promise<void> {
    await browser.runtime.sendMessage(message);
  }

  onMessage(
    message: ToBackground,
    _sender: browser.runtime.MessageSender
  ): void {
    log("log", "BackgroundProgram#onMessage", message.type, message);

    switch (message.type) {
      case "FromOptions":
        fireAndForget(
          this.onOptionsMessage(message.message),
          "BackgroundProgram#onMessage->onOptionsMessage",
          message
        );
        break;

      case "FromPopup":
        fireAndForget(
          this.onPopupMessage(message.message),
          "BackgroundProgram#onMessage->onPopupMessage",
          message
        );
        break;

      case "FromWorker":
      case "FromRenderer":
        // Tab-specific messages handled by TopFrameController
        log("log", "BackgroundProgram#onMessage", "Delegating to TopFrameController");
        break;
    }
  }

  onPopupMessage(message: FromPopup): void {
    switch (message.type) {
      case "PopupScriptAdded":
        this.sendPopupMessage({
          type: "Init",
          logLevel: log.level,
          isEnabled: true,
        });
        break;
    }
  }

  async onOptionsMessage(
    message: FromOptions
  ): Promise<void> {
    switch (message.type) {
      case "OptionsScriptAdded":
        this.updateOptionsPageData();
        break;

      case "ResetOptions":
        await this.resetOptions();
        break;

      case "ResetPerf":
        this.tabsPerf = {} as TabsPerf;
        this.updateOptionsPageData();
        break;

      case "SaveOptions":
        await this.saveOptions(message.partialOptions);
        break;

      case "ToggleKeyboardCapture":
        // Keyboard capture handled by TopFrameController
        break;
    }
  }

  onTabCreated(tab: browser.tabs.Tab): void {
    log("log", "BackgroundProgram#onTabCreated", tab);
  }

  onTabActivated(info: {
    previousTabId?: number;
    tabId: number;
    windowId: number;
  }): void {
    log("log", "BackgroundProgram#onTabActivated", info);
  }

  onTabUpdated(
    tabId: number,
    changeInfo: browser.tabs._OnUpdatedChangeInfo,
    tab: browser.tabs.Tab
  ): void {
    log("log", "BackgroundProgram#onTabUpdated", tabId, changeInfo, tab);
  }

  onTabRemoved(tabId: number, info: browser.tabs._OnRemovedRemoveInfo): void {
    log("log", "BackgroundProgram#onTabRemoved", tabId, info);
  }

  async updateOptions({ isInitial = false }: { isInitial?: boolean } = {}): Promise<void> {
    const rawOptions = await getRawOptions();
    const [options] = unflattenOptions(rawOptions);

    this.options.values = options;
    this.options.raw = rawOptions;

    if (isInitial) {
      log.level = options.logLevel;
    }

    log("log", "BackgroundProgram#updateOptions", {
      isInitial,
      options,
      rawOptions,
    });
  }

  async saveOptions(partialOptions: PartialOptions): Promise<void> {
    log("log", "BackgroundProgram#saveOptions", partialOptions);
    
    const currentOptions = this.options.values;
    const newOptions = { ...currentOptions, ...partialOptions };
    const raw = flattenOptions(newOptions);

    await browser.storage.sync.set(raw);
    await this.updateOptions();
    this.updateOptionsPageData();
  }

  async resetOptions(): Promise<void> {
    await browser.storage.sync.clear();
    await this.updateOptions();
    this.updateOptionsPageData();
  }

  async updateTabsAfterOptionsChange(): Promise<void> {
    log("log", "BackgroundProgram#updateTabsAfterOptionsChange");

    // Notify all tabs about options change
    // TopFrameController in each tab will handle the update
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      if (tab.id !== undefined) {
        fireAndForget(
          browser.tabs.sendMessage(tab.id, {
            type: "OptionsChanged",
            options: this.options.values,
          }),
          "BackgroundProgram#updateTabsAfterOptionsChange",
          tab.id
        );
      }
    }
  }

  async maybeOpenTutorial(): Promise<void> {
    const { tutorialShown } = await browser.storage.local.get("tutorialShown");
    if (tutorialShown !== true) {
      if (t.PREFER_WINDOWS.value) {
        await browser.windows.create({
          focused: true,
          url: META_TUTORIAL,
        });
      } else {
        await browser.tabs.create({
          active: true,
          url: META_TUTORIAL,
        });
      }
      await browser.storage.local.set({ tutorialShown: true });
    }
  }

  async maybeReopenOptions(): Promise<void> {
    if (!PROD) {
      const { optionsPage } = await browser.storage.local.get("optionsPage");
      if (typeof optionsPage === "boolean") {
        const isActive = optionsPage;
        const activeTab = await getCurrentTab();
        await browser.runtime.openOptionsPage();
        if (!isActive && activeTab.id !== undefined) {
          await browser.tabs.update(activeTab.id, { active: true });
        }
      }
    }
  }

  updateOptionsPageData(): void {
    this.sendOptionsMessage({
      type: "StateSync",
      logLevel: log.level,
      options: this.options,
    });

    if (!PROD) {
      this.sendOptionsMessage({
        type: "PerfUpdate",
        perf: this.tabsPerf,
      });
    }
  }

  async restoreTabsPerf(): Promise<void> {
    try {
      const result = await browser.storage.local.get("tabsPerf");
      if (typeof result.tabsPerf === "object" && result.tabsPerf !== null) {
        this.tabsPerf = result.tabsPerf;
      }
    } catch (error) {
      log("error", "BackgroundProgram#restoreTabsPerf", error);
    }
  }
}

// Helper functions

async function getCurrentTab(): Promise<browser.tabs.Tab> {
  const tabs = await browser.tabs.query({
    active: true,
    windowId: browser.windows.WINDOW_ID_CURRENT,
  });
  if (tabs.length !== 1) {
    throw new Error(
      `getCurrentTab: Got an unexpected amount of tabs: ${tabs.length}`
    );
  }
  return tabs[0];
}
