// iMessage theme for SillyTavern. Every style is scoped to body.imessage (style.css); the
// modules in src/ build the Messages window and its native panels while the theme is on.

import { MODULE_NAME, defaultSettings, getSettings, isDark, onSystemAppearanceChange, saveSettings } from './src/config.js';
import { isPhone } from './src/dom.js';
import { renderPanel, setSetting, showSetting } from './src/panel.js';
import { events, isOn, startTheme, stopTheme } from './src/power.js';
import { registerTheme, reloadPage } from './src/shared/theme-exclusive.js';
import { initAlerts } from './src/alerts.js';
import { initBackgrounds, openBackgrounds } from './src/backgrounds.js';
import { initContacts } from './src/contacts.js';
import { initCustomize, openCustomize } from './src/customize.js';
import { refreshTitle, setDisguise } from './src/disguise.js';
import { initFeatures } from './src/features.js';
import { initImages } from './src/images.js';
import { initKeys } from './src/keys.js';
import { initList, markCurrent, scheduleRefresh } from './src/list.js';
import { initMessages, refreshMessages } from './src/messages.js';
import { initMonograms } from './src/monograms.js';
import { initShell, refreshHeader, refreshPanelTitles } from './src/shell.js';
import { initSplit, resetSplits } from './src/split.js';
import { initWorldInfo } from './src/worldinfo.js';

/** Folder path under scripts/extensions/, e.g. third-party/SillyTavern-iMessage */
const EXTENSION_FOLDER = new URL('.', import.meta.url).pathname
    .replace(/^.*\/scripts\/extensions\//, '')
    .replace(/\/$/, '');
const BODY_CLASS = 'imessage';
const BOOT_TIMEOUT_MS = 20000;

/** Body classes that follow a setting while the theme is on */
const SETTING_CLASSES = {
    'imsg-lights': 'windowButtons',
    'imsg-receipts': 'receipts',
    'imsg-typing-on': 'typing',
    'imsg-split-on': 'splitReplies',
    'imsg-wall': 'wallpaper',
};

/** The one-theme-at-a-time helper shared by our themes */
let exclusive = null;

/** Whether the theme's parts are in the page */
let running = false;

/** Whether init() has run, i.e. this code was already in use before an update */
let initialized = false;

function applySettings() {
    const settings = getSettings();
    const body = document.body;
    const on = !!settings.enabled;
    body.classList.toggle(BODY_CLASS, on);
    document.documentElement.classList.toggle('imsg-html', on);
    body.classList.toggle('imsg-dark', on && isDark(settings));
    for (const [name, key] of Object.entries(SETTING_CLASSES)) {
        body.classList.toggle(name, on && !!settings[key]);
    }
    if (on) {
        body.style.setProperty('--imsg-wall-blur', `${Number(settings.wallpaperBlur) || 0}px`);
        body.style.setProperty('--imsg-wall-dim', `${Number(settings.wallpaperDim) || 0}%`);
    }
    setDisguise(on);
    refreshPanelTitles(on);
    if (on !== running) {
        running = on;
        on ? startTheme() : stopTheme();
    }
}

/** Phones show one pane at a time: the conversation list, or the open conversation. */
function showChatOnPhone() {
    if (isPhone()) {
        document.body.classList.add('imsg-m-chat');
    }
}

function setAppearance(appearance) {
    getSettings().appearance = appearance;
    applySettings();
    saveSettings();
    showSetting('appearance', appearance);
}

function onChatChanged(chatId) {
    if (!isOn()) {
        return;
    }
    refreshHeader();
    refreshTitle();
    markCurrent();
    if (chatId) {
        showChatOnPhone();
    } else {
        document.body.classList.remove('imsg-m-chat');
    }
}

function disable() {
    getSettings().enabled = false;
    applySettings();
    showSetting('enabled', false);
    saveSettings();
    refreshMessages();
}

async function init() {
    initialized = true;
    applySettings();
    exclusive = registerTheme({
        id: 'imessage',
        name: 'iMessage',
        folder: 'SillyTavern-iMessage',
        settingsKey: MODULE_NAME,
        bodyClass: BODY_CLASS,
        isEnabled: () => !!getSettings().enabled,
        disable,
        pauseUserTheme: () => getSettings().pauseUserTheme !== false,
    });
    onSystemAppearanceChange(applySettings);

    initShell({
        setAppearance,
        isDark: () => document.body.classList.contains('imsg-dark'),
        customize: () => openCustomize(),
    });
    const listLoaded = initList({ opened: showChatOnPhone });
    initSplit();
    initMessages();
    initMonograms();
    initAlerts();
    initKeys();
    initFeatures();
    initImages();
    initContacts();
    initBackgrounds();
    initWorldInfo();
    initCustomize({ setSetting, pickBackground: () => openBackgrounds() });
    applySettings();

    const { eventTypes, getCurrentChatId } = SillyTavern.getContext();
    const eventSource = events();
    eventSource.on(eventTypes.CHAT_CHANGED, onChatChanged);
    for (const type of [eventTypes.GROUP_UPDATED, eventTypes.CHARACTER_EDITED, eventTypes.CHARACTER_RENAMED]) {
        eventSource.on(type, refreshHeader);
    }
    for (const type of [eventTypes.CHARACTER_RENAMED, eventTypes.GROUP_UPDATED]) {
        eventSource.on(type, refreshTitle);
    }
    onChatChanged(getCurrentChatId());
    await Promise.race([listLoaded, delay(3000)]);
    endBoot();

    try {
        await renderPanel({
            folder: EXTENSION_FOLDER,
            apply: applySettings,
            after: {
                enabled: () => {
                    refreshMessages();
                    if (getSettings().enabled) {
                        exclusive?.activated();
                        reloadWhenOn('iMessage is on.');
                    } else {
                        exclusive?.changed();
                    }
                },
                pauseUserTheme: () => exclusive?.changed(),
                recentMax: () => scheduleRefresh(),
                splitReplies: () => {
                    resetSplits();
                    refreshMessages();
                },
                // turning it off redraws the messages, so the links come back as text
                imageLinks: () => SillyTavern.getContext().reloadCurrentChat(),
            },
        });
    } catch (error) {
        console.error('[iMessage] Could not render the settings panel', error);
    }
}

/**
 * Reloads the page once the settings are saved, so the theme starts from a fresh page whenever
 * it's loaded into one that's already running. Called on a user's action only (installing,
 * turning on, updating), so it can't repeat by itself.
 */
function reloadWhenOn(message) {
    if (getSettings().enabled) {
        reloadPage(SillyTavern.getContext().translate(message), { stillWanted: () => !!getSettings().enabled });
    }
}

/** ST calls this right after installing the extension and loading it (manifest "hooks"). */
export function onInstall() {
    reloadWhenOn('iMessage is installed.');
}

/**
 * ST calls this after updating the extension. The running code is the old version, so the page
 * reloads to load the new one. An update made while the page loads, before init(), already
 * loads the new code.
 */
export function onUpdate() {
    if (initialized) {
        reloadWhenOn('iMessage was updated.');
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Lifts the loading cover once the Messages window has painted. */
function endBoot() {
    const body = document.body;
    if (!body.classList.contains('imsg-booting')) {
        return;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
        body.classList.add('imsg-boot-done');
        setTimeout(() => body.classList.remove('imsg-booting', 'imsg-boot-done'), 250);
    }));
}

/** A plain window-colored cover from the moment this code loads, so ST's own UI never flashes. */
function bootLook() {
    const settings = SillyTavern.getContext().extensionSettings?.[MODULE_NAME];
    if (settings?.enabled === false) {
        return;
    }
    document.body.classList.add('imsg-booting');
    setTimeout(endBoot, BOOT_TIMEOUT_MS);
    document.body.classList.toggle('imsg-dark', isDark({ ...defaultSettings, ...settings }));
}

bootLook();

const { eventSource, eventTypes } = SillyTavern.getContext();
eventSource.on(eventTypes.APP_READY, init);
