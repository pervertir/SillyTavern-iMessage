// Keyboard shortcuts, as a Mac app has them (Ctrl in place of ⌘ elsewhere):
// ⌘F or ⌘K search conversations, ⌥⌘N new message, ⌃⌘S hide or show the sidebar, ⌘, settings,
// Esc closes the open sheet.
// The app's own ↑ (edit your last message) keeps working.

import { closeDrawers, newMessage, openDrawer, toggleSidebar } from './shell.js';

function isMac() {
    return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

function focusSearch() {
    document.body.classList.remove('imsg-m-chat');
    const input = /** @type {HTMLInputElement} */ (document.querySelector('#imsg-sidebar .imsg-search input'));
    input?.focus();
    input?.select();
}

function onKeyDown(event) {
    if (!document.body.classList.contains('imessage') || event.defaultPrevented) {
        return;
    }
    const command = isMac() ? event.metaKey : event.ctrlKey;
    const key = event.key.toLowerCase();

    if (command && !event.shiftKey && !event.altKey && (key === 'f' || key === 'k')) {
        event.preventDefault();
        focusSearch();
        return;
    }
    if (command && event.altKey && event.code === 'KeyN') {
        event.preventDefault();
        newMessage();
        return;
    }
    // ⌃⌘S on a Mac, as in Messages; Ctrl+Shift+S elsewhere
    if (event.code === 'KeyS' && (isMac() ? event.metaKey && event.ctrlKey : event.ctrlKey && event.shiftKey) && !event.altKey) {
        event.preventDefault();
        toggleSidebar();
        return;
    }
    if (command && !event.altKey && key === ',') {
        event.preventDefault();
        openDrawer('user-settings-button');
        return;
    }
    // Esc closes an open sheet, unless a dialog, menu or field is handling it
    if (key === 'escape' && !document.querySelector('dialog.popup[open]')
        && document.getElementById('imsg-menu')?.hidden !== false
        && document.querySelector('#top-settings-holder .drawer-content.openDrawer')
        && !/** @type {HTMLElement} */ (event.target).closest?.('.edit_textarea, .select2-container')) {
        closeDrawers();
    }
}

export function initKeys() {
    document.addEventListener('keydown', onKeyDown);
}
