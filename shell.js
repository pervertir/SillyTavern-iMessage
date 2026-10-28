// The Messages window around the app: the sidebar's toolbar (window buttons, the app menu and
// compose), the conversation header, the app's menus as Mac sheets with a Done button, and the
// empty pane while no conversation is open.

import { buildMonogram, monogramize } from './monograms.js';

const HEADER_ID = 'imsg-head';
const MENU_ID = 'imsg-menu';

/** The app's menus, named the way a Mac app would list them, in its own order */
const PANELS = [
    { id: 'ai-config-button', content: 'left-nav-panel', label: 'Response Settings' },
    { id: 'sys-settings-button', content: 'rm_api_block', label: 'Connections' },
    { id: 'advanced-formatting-button', content: 'AdvancedFormatting', label: 'Formatting' },
    { id: 'WI-SP-button', content: 'WorldInfo', label: 'World Info' },
    { id: 'user-settings-button', content: 'user-settings-block', label: 'Settings' },
    { id: 'backgrounds-button', content: 'Backgrounds', label: 'Backgrounds' },
    { id: 'extensions-settings-button', content: 'rm_extensions_block', label: 'Extensions' },
    { id: 'persona-management-button', content: 'PersonaManagement', label: 'Personas' },
    { id: 'rightNavHolder', content: 'right-nav-panel', label: 'Contacts' },
];

let shellOptions = { setAppearance: (_appearance) => {}, isDark: () => false };

function t(text) {
    return SillyTavern.getContext().translate(text);
}

/** An icon button drawn with one of the theme's SF-style symbols (--imsg-sym-<name>). */
export function symbolButton(className, label, symbol) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = `imsg-sym-button ${className}`.trim();
    element.title = t(label);
    element.setAttribute('aria-label', t(label));
    const glyph = document.createElement('i');
    glyph.className = 'imsg-sym';
    glyph.style.setProperty('--imsg-glyph', `var(--imsg-sym-${symbol})`);
    element.append(glyph);
    return element;
}

/** Clicks one of the app's drawer toggles, the way its own top bar does. */
export function toggleDrawer(drawerId) {
    document.querySelector(`#${drawerId} > .drawer-toggle`)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

/** Opens a drawer unless it's already open. */
export function openDrawer(drawerId) {
    if (!document.querySelector(`#${drawerId} > .drawer-content`)?.classList.contains('openDrawer')) {
        toggleDrawer(drawerId);
    }
}

/** Closes every open drawer. */
export function closeDrawers() {
    for (const content of document.querySelectorAll('#top-settings-holder .drawer-content.openDrawer')) {
        if (content.classList.contains('pinnedOpen')) {
            // Mac sheets don't pin, and the theme hides the pins, so a pinned one gets unpinned
            /** @type {HTMLInputElement} */ (content.querySelector('input[id$="_panel_pin"]'))?.click();
        }
        const drawer = content.closest('.drawer');
        if (drawer?.id) {
            toggleDrawer(drawer.id);
        }
    }
}

/** Clicks an entry of the app's chat options menu (the ☰ by the message box). */
export function clickOption(id) {
    const options = [...document.querySelectorAll(`#options #${id}`)];
    (options.find(x => !x.classList.contains('displayNone')) ?? options[0])?.click();
}

/** New Message: pick someone from Contacts. */
export function newMessage() {
    openDrawer('rightNavHolder');
    document.getElementById('rm_button_characters')?.click();
}

function closeMenu() {
    const menu = document.getElementById(MENU_ID);
    if (menu) {
        menu.hidden = true;
    }
    menuAnchor?.classList.remove('imsg-pressed');
    menuAnchor = null;
}

let menuAnchor = null;

function getMenu() {
    let menu = document.getElementById(MENU_ID);
    if (menu) {
        return menu;
    }
    menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    document.body.append(menu);
    document.addEventListener('pointerdown', (event) => {
        const target = /** @type {Node} */ (event.target);
        if (!menu.hidden && !menu.contains(target) && !menuAnchor?.contains(target)) {
            closeMenu();
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !menu.hidden) {
            closeMenu();
        }
    });
    window.addEventListener('resize', closeMenu);
    return menu;
}

/**
 * Opens a Mac menu under a button (or at a point), or closes it when it's already open there.
 * Items with no label are separators; `checked` puts a tick before the label.
 * @param {HTMLElement} anchor
 * @param {Array<{label?: string, run?: () => void, checked?: boolean, danger?: boolean}>} items
 * @param {{x: number, y: number}} [point] Where a right-click happened
 */
export function toggleMenu(anchor, items, point) {
    const menu = getMenu();
    if (!menu.hidden && menuAnchor === anchor && !point) {
        closeMenu();
        return;
    }
    closeMenu();
    menu.replaceChildren(...items.map(({ label, run, checked, danger }) => {
        if (!label) {
            const line = document.createElement('div');
            line.className = 'imsg-menu-sep';
            line.setAttribute('role', 'separator');
            return line;
        }
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'imsg-menu-item';
        item.classList.toggle('imsg-menu-checked', !!checked);
        item.classList.toggle('imsg-menu-danger', !!danger);
        item.setAttribute('role', checked === undefined ? 'menuitem' : 'menuitemcheckbox');
        if (checked !== undefined) {
            item.setAttribute('aria-checked', String(!!checked));
        }
        item.textContent = t(label);
        item.addEventListener('click', () => {
            closeMenu();
            run?.();
        });
        return item;
    }));
    menu.hidden = false;
    menuAnchor = anchor;
    anchor.classList.add('imsg-pressed');
    const box = anchor.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    let left = point ? point.x : box.left;
    let top = point ? point.y : box.bottom + 4;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    if (top + height > window.innerHeight - 8) {
        top = Math.max(8, (point ? point.y : box.top - 4) - height);
    }
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    /** @type {HTMLElement} */ (menu.querySelector('.imsg-menu-item'))?.focus({ preventScroll: true });
}

/** The app menu: every menu of the app, then the appearance. */
function appMenuItems() {
    const dark = shellOptions.isDark();
    return [
        { label: 'New Message', run: newMessage },
        {},
        ...PANELS.filter(({ id }) => document.getElementById(id)).map(({ id, label }) => ({ label, run: () => openDrawer(id) })),
        {},
        { label: 'Light Mode', checked: !dark, run: () => shellOptions.setAppearance('light') },
        { label: 'Dark Mode', checked: dark, run: () => shellOptions.setAppearance('dark') },
        { label: 'Match System', run: () => shellOptions.setAppearance('system') },
    ];
}

/** The sidebar's toolbar: window buttons, then the app menu and compose on the right. */
export function buildSidebarToolbar() {
    const bar = document.createElement('div');
    bar.className = 'imsg-side-bar';

    const lights = document.createElement('div');
    lights.className = 'imsg-lights';
    const light = (className, label, run) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `imsg-light ${className}`;
        button.title = t(label);
        button.setAttribute('aria-label', t(label));
        button.addEventListener('click', run);
        return button;
    };
    lights.append(
        light('imsg-light-close', 'Close conversation', () => {
            clickOption('option_close_chat');
            document.body.classList.remove('imsg-m-chat');
        }),
        light('imsg-light-min', 'Hide sidebar', () => document.body.classList.toggle('imsg-side-hidden')),
        light('imsg-light-full', 'Enter full screen', () => {
            if (document.fullscreenElement) {
                document.exitFullscreen?.();
            } else {
                document.documentElement.requestFullscreen?.().catch(() => {});
            }
        }),
    );

    // iPhone: "Edit" opens the same app menu
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'imsg-text-button imsg-edit';
    edit.textContent = t('Edit');
    edit.addEventListener('click', () => toggleMenu(edit, appMenuItems()));

    const menu = symbolButton('imsg-app-menu', 'More', 'ellipsis-circle');
    menu.addEventListener('click', () => toggleMenu(menu, appMenuItems()));
    const compose = symbolButton('imsg-compose', 'New Message', 'compose');
    compose.addEventListener('click', newMessage);

    const spacer = document.createElement('div');
    spacer.className = 'imsg-spacer';
    bar.append(lights, edit, spacer, menu, compose);
    return bar;
}

function openProfile() {
    openDrawer('rightNavHolder');
}

function createHeader() {
    const sheld = document.getElementById('sheld');
    if (!sheld || document.getElementById(HEADER_ID)) {
        return;
    }
    const head = document.createElement('div');
    head.id = HEADER_ID;

    const back = symbolButton('imsg-back', 'Messages', 'chevron-left');
    back.addEventListener('click', () => {
        closeDrawers();
        document.body.classList.remove('imsg-m-chat');
    });

    // Mac: "To: Name"; iPhone: the picture with the name under it
    const who = document.createElement('button');
    who.type = 'button';
    who.className = 'imsg-head-who';
    who.title = t('Details');
    const to = document.createElement('span');
    to.className = 'imsg-head-to';
    to.textContent = `${t('To')}:`;
    const avatar = document.createElement('span');
    avatar.className = 'imsg-avatar';
    const name = document.createElement('span');
    name.className = 'imsg-head-name';
    who.append(avatar, to, name);
    who.addEventListener('click', openProfile);

    const actions = document.createElement('div');
    actions.className = 'imsg-head-actions';
    const video = symbolButton('imsg-head-video', 'New conversation', 'video');
    video.addEventListener('click', () => clickOption('option_start_new_chat'));
    const info = symbolButton('imsg-head-info', 'Details', 'info');
    info.addEventListener('click', () => toggleMenu(info, [
        { label: 'Details', run: openProfile },
        { label: 'Conversation History', run: () => clickOption('option_select_chat') },
        { label: 'New Conversation', run: () => clickOption('option_start_new_chat') },
        {},
        {
            label: 'Close Conversation', run: () => {
                clickOption('option_close_chat');
                document.body.classList.remove('imsg-m-chat');
            },
        },
    ]));
    actions.append(video, info);

    const showSide = symbolButton('imsg-show-side', 'Show sidebar', 'sidebar');
    showSide.addEventListener('click', () => document.body.classList.remove('imsg-side-hidden'));

    head.append(back, showSide, who, actions);
    sheld.prepend(head);
}

/** A group's picture: up to three of its members' pictures in a cluster, as Messages shows a group. */
export function buildGroupAvatar(group) {
    const context = SillyTavern.getContext();
    const cluster = document.createElement('span');
    cluster.className = 'imsg-cluster';
    const members = (group?.members ?? []).slice(0, 3)
        .map(avatarId => context.characters.find(x => x.avatar === avatarId))
        .filter(Boolean);
    cluster.dataset.count = String(Math.max(1, members.length));
    if (!members.length) {
        cluster.append(buildMonogram(group?.name ?? ''));
        return cluster;
    }
    for (const character of members) {
        const face = document.createElement('span');
        face.className = 'imsg-face';
        const img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        img.src = context.getThumbnailUrl('avatar', character.avatar);
        face.append(img);
        cluster.append(face);
        monogramize(img, character.name);
    }
    return cluster;
}

/** Puts the open conversation's character or group in the header. */
export function refreshHeader() {
    const head = document.getElementById(HEADER_ID);
    if (!head) {
        return;
    }
    const context = SillyTavern.getContext();
    const avatar = head.querySelector('.imsg-avatar');
    const name = head.querySelector('.imsg-head-name');
    avatar.replaceChildren();
    delete avatar.dataset.imsgMonoFor;
    avatar.classList.remove('imsg-mono');

    const group = context.groupId ? context.groups.find(x => String(x.id) === String(context.groupId)) : null;
    const character = !group && context.characterId !== undefined ? context.characters[context.characterId] : null;
    document.body.classList.toggle('imsg-no-chat', !(group || character));
    document.body.classList.toggle('imsg-group', !!group);

    if (group) {
        avatar.append(buildGroupAvatar(group));
        name.textContent = group.name;
    } else if (character) {
        const img = document.createElement('img');
        img.alt = '';
        img.src = context.getThumbnailUrl('avatar', character.avatar);
        avatar.append(img);
        name.textContent = character.name;
        monogramize(img, character.name);
    } else {
        name.textContent = '';
    }
}

/** The pane while no conversation is open */
function createEmptyState() {
    const sheld = document.getElementById('sheld');
    if (!sheld || document.getElementById('imsg-empty')) {
        return;
    }
    const empty = document.createElement('div');
    empty.id = 'imsg-empty';
    const text = document.createElement('p');
    text.textContent = t('No Conversation Selected');
    empty.append(text);
    sheld.append(empty);
}

/** A Mac sheet's title bar with Done, on top of each of the app's menus. */
function createPanelHeads() {
    for (const { id, label } of PANELS) {
        const content = document.querySelector(`#${id} > .drawer-content`);
        if (!content || content.querySelector(':scope > .imsg-panel-head')) {
            continue;
        }
        const head = document.createElement('div');
        head.className = 'imsg-panel-head';
        const title = document.createElement('span');
        title.className = 'imsg-panel-title';
        title.textContent = t(label);
        const done = document.createElement('button');
        done.type = 'button';
        done.className = 'imsg-text-button imsg-done';
        done.textContent = t('Done');
        done.addEventListener('click', () => {
            if (content.classList.contains('openDrawer')) {
                toggleDrawer(id);
            }
        });
        head.append(title, done);
        content.prepend(head);
    }
}

/** Keeps the panels' title bars out of the way while the theme is off. */
export function refreshPanelTitles(enabled) {
    document.body.classList.toggle('imsg-panels', enabled);
}

/**
 * Mirrors which menu is open as classes (drawer.imsg-open, body.imsg-menu-open), so the styles
 * don't need page-wide :has() checks, which re-check the whole page on every change.
 */
function trackDrawers() {
    const drawers = [...document.querySelectorAll('#top-settings-holder > .drawer')];
    const update = () => {
        let any = false;
        for (const drawer of drawers) {
            const open = !!drawer.querySelector(':scope > .drawer-content.openDrawer');
            drawer.classList.toggle('imsg-open', open);
            any ||= open;
        }
        document.body.classList.toggle('imsg-menu-open', any);
    };
    const observer = new MutationObserver(update);
    for (const drawer of drawers) {
        const content = drawer.querySelector(':scope > .drawer-content');
        if (content) {
            observer.observe(content, { attributes: true, attributeFilter: ['class'] });
        }
    }
    update();
}

/**
 * @param {object} options
 * @param {(appearance: string) => void} options.setAppearance Switches between light, dark and the system's
 * @param {() => boolean} options.isDark Whether the dark look is showing
 */
export function initShell(options) {
    shellOptions = options;
    createHeader();
    createEmptyState();
    createPanelHeads();
    trackDrawers();
    refreshHeader();
}
