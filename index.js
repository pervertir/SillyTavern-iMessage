// iMessage theme: toggles the scoped styles in style.css, builds the Messages window
// (sidebar with the conversation list, conversation header) and a small settings panel.

import { initList, markCurrent, scheduleRefresh } from './list.js';
import { initMessages, refreshMessages } from './messages.js';
import { initSplit, resetSplits } from './split.js';
import { initMonograms } from './monograms.js';
import { refreshTitle, setDisguise } from './disguise.js';
import { initShell, openDrawer, refreshHeader, refreshPanelTitles } from './shell.js';
import { askToNotify, initAlerts, previewSound } from './alerts.js';
import { initKeys } from './keys.js';
import { initFeatures } from './features.js';
import { initImages } from './images.js';
import { initCustomize, openCustomize } from './customize.js';
import { initContacts } from './contacts.js';

const MODULE_NAME = 'iMessageTheme';
/** Folder path under scripts/extensions/, e.g. third-party/SillyTavern-iMessage */
const EXTENSION_FOLDER = new URL('.', import.meta.url).pathname
    .replace(/^.*\/scripts\/extensions\//, '')
    .replace(/\/$/, '');
const BODY_CLASS = 'imessage';
const MOBILE_QUERY = '(max-width: 1000px)';

const defaultSettings = Object.freeze({
    enabled: true,
    /** light, dark or system */
    appearance: 'system',
    /** The red, yellow and green window buttons at the top of the sidebar */
    windowButtons: true,
    /** "Delivered" / "Read" under your last message */
    receipts: true,
    /** The three-dot bubble while a reply is being written */
    typing: true,
    recentMax: 50,
    /** Long replies as several short bubbles, split at the ends of sentences */
    splitReplies: true,
    /** Image links in messages show as the pictures themselves */
    imageLinks: true,
    /** The background picked in Backgrounds, behind the conversation */
    wallpaper: false,
    /** Blur on the background, in pixels */
    wallpaperBlur: 12,
    /** How much the window color is laid over the background, in percent */
    wallpaperDim: 30,
    /** A soft sound when you send and when a reply arrives */
    sounds: true,
    /** Sound volume, in percent */
    soundVolume: 50,
    /** A system notification for replies that arrive while the tab is in the background */
    notify: false,
    /** Customize: theme variables, switches and your own CSS (customize.js) */
    customize: { tokens: {}, flags: {}, css: '' },
});

/** The theme settings field for each setting Customize can change */
const SETTING_FIELDS = {
    windowButtons: 'imsg_window_buttons',
    receipts: 'imsg_receipts',
    typing: 'imsg_typing',
    splitReplies: 'imsg_split',
    imageLinks: 'imsg_image_links',
    wallpaper: 'imsg_wallpaper',
    wallpaperBlur: 'imsg_wallpaper_blur',
    wallpaperDim: 'imsg_wallpaper_dim',
    sounds: 'imsg_sounds',
};

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    const settings = extensionSettings[MODULE_NAME];
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(settings, key)) {
            settings[key] = structuredClone(defaultSettings[key]);
        }
    }
    return settings;
}

function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
}

function isDark(settings) {
    return settings.appearance === 'dark' || (settings.appearance === 'system' && darkQuery.matches);
}

function applySettings() {
    const settings = getSettings();
    const body = document.body;
    const on = !!settings.enabled;
    body.classList.toggle(BODY_CLASS, on);
    document.documentElement.classList.toggle('imsg-html', on);
    body.classList.toggle('imsg-dark', on && isDark(settings));
    body.classList.toggle('imsg-lights', !!settings.windowButtons);
    body.classList.toggle('imsg-receipts', !!settings.receipts);
    body.classList.toggle('imsg-typing-on', !!settings.typing);
    body.classList.toggle('imsg-split-on', !!settings.splitReplies);
    body.classList.toggle('imsg-wall', on && !!settings.wallpaper);
    body.style.setProperty('--imsg-wall-blur', `${Number(settings.wallpaperBlur) || 0}px`);
    body.style.setProperty('--imsg-wall-dim', `${Number(settings.wallpaperDim) || 0}%`);
    setDisguise(on);
    refreshPanelTitles(on);
}

/** Phones show one pane at a time: the conversation list, or the open conversation. */
function showChatOnPhone() {
    if (window.matchMedia(MOBILE_QUERY).matches) {
        document.body.classList.add('imsg-m-chat');
    }
}

function setAppearance(appearance) {
    const settings = getSettings();
    settings.appearance = appearance;
    applySettings();
    saveSettings();
    const select = /** @type {HTMLSelectElement} */ (document.getElementById('imsg_appearance'));
    if (select) {
        select.value = appearance;
    }
}

function onChatChanged(chatId) {
    refreshHeader();
    refreshTitle();
    markCurrent();
    if (chatId) {
        showChatOnPhone();
    } else {
        document.body.classList.remove('imsg-m-chat');
    }
}

async function renderSettingsPanel() {
    const { renderExtensionTemplateAsync } = SillyTavern.getContext();
    const html = await renderExtensionTemplateAsync(EXTENSION_FOLDER, 'settings');
    const container = document.getElementById('extensions_settings2');
    if (!container || document.querySelector('.imsg-settings')) {
        return;
    }
    container.insertAdjacentHTML('beforeend', html);

    const settings = getSettings();
    const field = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id));
    const enabled = field('imsg_enabled');
    const appearance = /** @type {HTMLSelectElement} */ (document.getElementById('imsg_appearance'));
    const windowButtons = field('imsg_window_buttons');
    const receipts = field('imsg_receipts');
    const typing = field('imsg_typing');
    const recentMax = field('imsg_recent_max');
    const splitReplies = field('imsg_split');
    const imageLinks = field('imsg_image_links');
    const wallpaper = field('imsg_wallpaper');
    const wallpaperBlur = field('imsg_wallpaper_blur');
    const wallpaperDim = field('imsg_wallpaper_dim');
    const sounds = field('imsg_sounds');
    const soundVolume = field('imsg_sound_volume');
    const notify = field('imsg_notify');
    const showValues = () => {
        document.getElementById('imsg_sound_volume_value').textContent = `${settings.soundVolume}%`;
        document.getElementById('imsg_sound_options').classList.toggle('imsg-off', !settings.sounds);
        document.getElementById('imsg_wallpaper_blur_value').textContent = `${settings.wallpaperBlur}px`;
        document.getElementById('imsg_wallpaper_dim_value').textContent = `${settings.wallpaperDim}%`;
        document.getElementById('imsg_wallpaper_options').classList.toggle('imsg-off', !settings.wallpaper);
    };

    enabled.checked = settings.enabled;
    appearance.value = settings.appearance;
    windowButtons.checked = settings.windowButtons;
    receipts.checked = settings.receipts;
    typing.checked = settings.typing;
    recentMax.value = String(settings.recentMax);
    splitReplies.checked = settings.splitReplies;
    imageLinks.checked = settings.imageLinks;
    wallpaper.checked = settings.wallpaper;
    wallpaperBlur.value = String(settings.wallpaperBlur);
    wallpaperDim.value = String(settings.wallpaperDim);
    sounds.checked = settings.sounds;
    soundVolume.value = String(settings.soundVolume);
    notify.checked = settings.notify;
    showValues();

    const bind = (element, key, read, after) => {
        element.addEventListener('input', () => {
            settings[key] = read();
            applySettings();
            saveSettings();
            after?.();
        });
    };
    bind(enabled, 'enabled', () => enabled.checked, () => refreshMessages());
    bind(appearance, 'appearance', () => appearance.value);
    bind(windowButtons, 'windowButtons', () => windowButtons.checked);
    bind(receipts, 'receipts', () => receipts.checked);
    bind(typing, 'typing', () => typing.checked);
    bind(recentMax, 'recentMax', () => Math.min(500, Math.max(5, Number(recentMax.value) || defaultSettings.recentMax)), () => scheduleRefresh());
    bind(splitReplies, 'splitReplies', () => splitReplies.checked, () => {
        resetSplits();
        refreshMessages();
    });
    // turning it off redraws the messages, so the links come back as text
    bind(imageLinks, 'imageLinks', () => imageLinks.checked, () => SillyTavern.getContext().reloadCurrentChat());
    bind(wallpaper, 'wallpaper', () => wallpaper.checked, showValues);
    bind(wallpaperBlur, 'wallpaperBlur', () => Number(wallpaperBlur.value), showValues);
    bind(wallpaperDim, 'wallpaperDim', () => Number(wallpaperDim.value), showValues);
    document.getElementById('imsg_wallpaper_pick').addEventListener('click', () => openDrawer('backgrounds-button'));
    document.getElementById('imsg_customize').addEventListener('click', () => openCustomize());
    bind(sounds, 'sounds', () => sounds.checked, showValues);
    bind(soundVolume, 'soundVolume', () => Number(soundVolume.value), showValues);
    soundVolume.addEventListener('change', () => previewSound('receive'));
    document.getElementById('imsg_sound_send').addEventListener('click', () => previewSound('send'));
    document.getElementById('imsg_sound_receive').addEventListener('click', () => previewSound('receive'));
    bind(notify, 'notify', () => notify.checked, async () => {
        if (settings.notify && !(await askToNotify())) {
            settings.notify = false;
            notify.checked = false;
            saveSettings();
            toastr.info('Allow notifications for this site in your browser to get them.', 'Notifications are blocked');
        }
    });
}

async function init() {
    applySettings();
    darkQuery.addEventListener('change', applySettings);

    initShell({
        setAppearance,
        isDark: () => document.body.classList.contains('imsg-dark'),
        customize: () => openCustomize(),
    });
    const listLoaded = initList({ settings: getSettings, opened: showChatOnPhone });
    initSplit();
    initMessages();
    initMonograms();
    initAlerts({ settings: getSettings });
    initKeys();
    initFeatures();
    initImages({ settings: getSettings });
    initContacts();
    initCustomize({
        settings: getSettings,
        save: saveSettings,
        // a setting changed in Customize goes through its own field, so both stay in step
        setSetting: (key, value) => {
            const input = /** @type {HTMLInputElement} */ (document.getElementById(SETTING_FIELDS[key]));
            if (!input) {
                return;
            }
            if (input.type === 'checkbox') {
                input.checked = !!value;
            } else {
                input.value = String(value);
            }
            input.dispatchEvent(new Event('input', { bubbles: true }));
        },
        pickBackground: () => openDrawer('backgrounds-button'),
    });
    applySettings();

    const { eventSource, eventTypes } = SillyTavern.getContext();
    eventSource.on(eventTypes.CHAT_CHANGED, onChatChanged);
    eventSource.on(eventTypes.GROUP_UPDATED, refreshHeader);
    eventSource.on(eventTypes.CHARACTER_EDITED, refreshHeader);
    eventSource.on(eventTypes.CHARACTER_RENAMED, refreshHeader);
    eventSource.on(eventTypes.CHARACTER_RENAMED, refreshTitle);
    eventSource.on(eventTypes.GROUP_UPDATED, refreshTitle);
    onChatChanged(SillyTavern.getContext().getCurrentChatId());
    await Promise.race([listLoaded, delay(3000)]);
    endBoot();

    try {
        await renderSettingsPanel();
    } catch (error) {
        console.error('[iMessage] Could not render the settings panel', error);
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Lifts the blank loading cover once the Messages window has painted. */
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

/** A plain window-colored cover from the moment this code loads, as a Mac app opens. */
function bootLook() {
    const settings = SillyTavern.getContext().extensionSettings?.[MODULE_NAME];
    if (settings?.enabled === false) {
        return;
    }
    document.body.classList.add('imsg-booting');
    // never leave the cover up if something fails on the way
    setTimeout(endBoot, 20000);
    document.body.classList.toggle('imsg-dark', isDark({ ...defaultSettings, ...settings }));
}

bootLook();

const { eventSource, eventTypes } = SillyTavern.getContext();
eventSource.on(eventTypes.APP_READY, init);
