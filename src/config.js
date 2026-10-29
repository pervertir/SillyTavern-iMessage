// The theme's saved settings, under extension_settings.iMessageTheme.

export const MODULE_NAME = 'iMessageTheme';

export const defaultSettings = Object.freeze({
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
    /** Background blur, in pixels */
    wallpaperBlur: 12,
    /** How much of the window color is laid over the background, in percent */
    wallpaperDim: 30,
    sounds: true,
    /** Sound volume, in percent */
    soundVolume: 50,
    /** A system notification for replies that arrive while the tab is in the background */
    notify: false,
    /** Set aside the user's Custom CSS and UI theme while this theme is on */
    pauseUserTheme: true,
    /** Customize: theme variables, switches and the user's own CSS */
    customize: { tokens: {}, flags: {}, css: '' },
});

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

/** The settings object, created and filled in with defaults on first use. */
export function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    extensionSettings[MODULE_NAME] ??= structuredClone(defaultSettings);
    const settings = extensionSettings[MODULE_NAME];
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(settings, key)) {
            settings[key] = structuredClone(defaultSettings[key]);
        }
    }
    return settings;
}

export function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
}

export function isDark(settings) {
    return settings.appearance === 'dark' || (settings.appearance === 'system' && darkQuery.matches);
}

export function onSystemAppearanceChange(handler) {
    darkQuery.addEventListener('change', handler);
}
