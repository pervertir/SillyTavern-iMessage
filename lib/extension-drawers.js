// Top-bar drawers added by other extensions. Shared by the themes that don't draw SillyTavern's
// top bar (Discord, iMessage); each copies this file unchanged. Their icons would have nowhere to
// show, so each one gets a row in the extensions menu that clicks SillyTavern's hidden toggle.
//
// Uses the page (#top-settings-holder, #extensionsMenu) and SillyTavern's APP_READY event.

const STOCK = new Set(['ai-config-button', 'sys-settings-button', 'advanced-formatting-button', 'WI-SP-button',
    'user-settings-button', 'backgrounds-button', 'extensions-settings-button', 'persona-management-button',
    'rightNavHolder']);
const ROW = 'theme-extension-drawer';

function addRow(menu, drawer, toggle, owner) {
    const icon = toggle.querySelector('.drawer-icon') ?? toggle;
    const row = document.createElement('div');
    row.className = `list-group-item flex-container flexGap5 interactable ${ROW}`;
    row.tabIndex = 0;
    row.dataset.drawerOwner = owner;
    const glyph = document.createElement('div');
    glyph.className = [...icon.classList].filter(name => /^fa-|^fa$/.test(name)).join(' ');
    glyph.classList.add('extensionsMenuExtensionButton');
    const label = document.createElement('span');
    label.textContent = icon.title || toggle.title || drawer.id;
    row.append(glyph, label);
    // on the icon: some extensions listen there, and the click still reaches the toggle and drawer
    row.addEventListener('click', () => icon.click());
    menu.append(row);
}

/** Makes the rows match the page: one per other extension's drawer while on, none while off. */
function sync(on, owner) {
    const menu = document.getElementById('extensionsMenu');
    const holder = document.getElementById('top-settings-holder');
    if (!menu || !holder) return;
    menu.querySelectorAll(`.${ROW}[data-drawer-owner="${owner}"]`).forEach(row => row.remove());
    if (!on) return;
    for (const drawer of holder.querySelectorAll(':scope > .drawer')) {
        const toggle = drawer.querySelector(':scope > .drawer-toggle');
        if (toggle && !STOCK.has(drawer.id)) addRow(menu, drawer, toggle, owner);
    }
}

/**
 * @param {string} owner The theme's id: a theme that is installed but off must leave the rows alone
 * @param {() => boolean} isOn Whether the theme is on now
 * @returns {() => void} Call after the theme turns on or off
 */
export function watchExtensionDrawers(owner, isOn) {
    const holder = document.getElementById('top-settings-holder');
    if (holder) new MutationObserver(() => sync(isOn(), owner)).observe(holder, { childList: true });
    const update = () => sync(isOn(), owner);
    update();
    // an extension loaded before this one may have added its drawer before the menu existed
    const { eventSource, eventTypes } = SillyTavern.getContext();
    eventSource.on(eventTypes.APP_READY, update);
    return update;
}
