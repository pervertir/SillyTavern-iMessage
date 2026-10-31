// The theme's block in SillyTavern's Extensions panel (settings.html).

import { defaultSettings, getSettings, saveSettings } from './config.js';
import { askToNotify, previewSound } from './alerts.js';
import { openBackgrounds } from './backgrounds.js';
import { openCustomize } from './customize.js';

/**
 * Each setting the panel shows: its field, how the field's value is read, and what else to do
 * after it changes.
 * @type {Record<string, {id: string, read?: (input: HTMLInputElement) => any, after?: () => void}>}
 */
const FIELDS = {
    enabled: { id: 'imsg_enabled' },
    pauseUserTheme: { id: 'imsg_pause_user_theme' },
    appearance: { id: 'imsg_appearance' },
    windowButtons: { id: 'imsg_window_buttons' },
    receipts: { id: 'imsg_receipts' },
    typing: { id: 'imsg_typing' },
    chatNames: { id: 'imsg_chat_names' },
    recentMax: {
        id: 'imsg_recent_max',
        read: (input) => Math.min(500, Math.max(5, Number(input.value) || defaultSettings.recentMax)),
    },
    splitReplies: { id: 'imsg_split' },
    imageLinks: { id: 'imsg_image_links' },
    wallpaper: { id: 'imsg_wallpaper' },
    wallpaperBlur: { id: 'imsg_wallpaper_blur' },
    wallpaperDim: { id: 'imsg_wallpaper_dim' },
    sounds: { id: 'imsg_sounds' },
    soundVolume: { id: 'imsg_sound_volume' },
    notify: { id: 'imsg_notify' },
};

function input(key) {
    return /** @type {HTMLInputElement} */ (document.getElementById(FIELDS[key].id));
}

function readField(key) {
    const field = input(key);
    if (FIELDS[key].read) {
        return FIELDS[key].read(field);
    }
    if (field.type === 'checkbox') {
        return field.checked;
    }
    return field.type === 'range' ? Number(field.value) : field.value;
}

function writeField(key, value) {
    const field = input(key);
    if (!field) {
        return;
    }
    if (field.type === 'checkbox') {
        field.checked = !!value;
    } else {
        field.value = String(value);
    }
}

function showValues() {
    const settings = getSettings();
    document.getElementById('imsg_sound_volume_value').textContent = `${settings.soundVolume}%`;
    document.getElementById('imsg_sound_options').classList.toggle('imsg-off', !settings.sounds);
    document.getElementById('imsg_wallpaper_blur_value').textContent = `${settings.wallpaperBlur}px`;
    document.getElementById('imsg_wallpaper_dim_value').textContent = `${settings.wallpaperDim}%`;
    document.getElementById('imsg_wallpaper_options').classList.toggle('imsg-off', !settings.wallpaper);
}

/** Changes a setting through its field, so the panel and the theme stay in step (used by Customize). */
export function setSetting(key, value) {
    const field = input(key);
    if (!field) {
        return;
    }
    writeField(key, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Shows a setting's value without applying it again. */
export function showSetting(key, value) {
    writeField(key, value);
}

/**
 * @param {object} hooks
 * @param {string} hooks.folder The extension's folder under scripts/extensions
 * @param {() => void} hooks.apply Applies the settings to the page
 * @param {Partial<Record<string, () => void>>} hooks.after Extra work after a setting changes, by key
 */
export async function renderPanel({ folder, apply, after }) {
    const container = document.getElementById('extensions_settings2');
    if (!container || document.querySelector('.imsg-settings')) {
        return;
    }
    const html = await SillyTavern.getContext().renderExtensionTemplateAsync(folder, 'settings');
    container.insertAdjacentHTML('beforeend', html);

    const settings = getSettings();
    for (const key of Object.keys(FIELDS)) {
        writeField(key, settings[key]);
        input(key).addEventListener('input', () => {
            settings[key] = readField(key);
            apply();
            saveSettings();
            showValues();
            after[key]?.();
        });
    }
    showValues();

    const click = (id, run) => document.getElementById(id).addEventListener('click', run);
    click('imsg_wallpaper_pick', () => openBackgrounds());
    click('imsg_customize', () => openCustomize());
    click('imsg_sound_send', () => previewSound('send'));
    click('imsg_sound_receive', () => previewSound('receive'));
    input('soundVolume').addEventListener('change', () => previewSound('receive'));
    input('notify').addEventListener('input', async () => {
        if (settings.notify && !(await askToNotify())) {
            settings.notify = false;
            input('notify').checked = false;
            saveSettings();
            toastr.info('Allow notifications for this site in your browser to get them.', 'Notifications are blocked');
        }
    });
}
