// Backgrounds window, laid out like Photos: sources and folders in a sidebar, a picture grid
// beside it. ST's own Backgrounds panel stays in the page, hidden; this window reads from it and
// clicks its tiles, so locking, folders and uploads keep ST's behavior.

import { background_settings, getBackgroundPath } from '../../../../backgrounds.js';
import { events, onStop } from './power.js';
import { toggleMenu } from './shell.js';
import { button, context, element, glyph, isPhone, overlayOpen, t } from './dom.js';

const ROOT_ID = 'imsg-backgrounds';
const ALL = 'all';
const CHAT = 'chat';

/** What's on screen: the source (all, chat or a folder id) and the search */
let view = { source: ALL, needle: '', picked: false };
let folderMap = {};
let observer = null;
let redrawTimer = 0;

// ── The app's hidden panel ──

/** Puts the app's panel back at the top level, where it lists every background. */
function appAtTop() {
    if (document.getElementById('Backgrounds')?.classList.contains('in-folder-view')) {
        document.getElementById('bg_back_to_folders')?.click();
    }
}

/** The app's tab: 0 your backgrounds, 1 this conversation's. */
function appTab(index) {
    const tabs = /** @type {any} */ (window).$?.('#bg_tabs');
    if (tabs?.data('ui-tabs') && tabs.tabs('option', 'active') !== index) {
        tabs.tabs('option', 'active', index);
    }
}

function appTile(file, custom) {
    appAtTop();
    const list = document.getElementById(custom ? 'bg_custom_content' : 'bg_menu_content');
    return [...(list?.querySelectorAll('.bg_example') ?? [])].find((x) => x.getAttribute('bgfile') === file) ?? null;
}

function appAction(file, custom, action) {
    const tile = appTile(file, custom);
    /** @type {HTMLElement} */ (tile?.querySelector(`.jg-button[data-action="${action}"]`))?.click();
    scheduleRedraw();
}

function lockedUrl() {
    return context().chatMetadata?.custom_background ?? null;
}

function urlOf(tile) {
    return /** @type {any} */ (window).$?.(tile).data('url') ?? '';
}

/** Every picture the app lists, with what the grid needs. */
function readPictures() {
    appAtTop();
    const read = (listId, custom) => [...(document.getElementById(listId)?.querySelectorAll('.bg_example') ?? [])].map((tile) => {
        const file = tile.getAttribute('bgfile') ?? '';
        const name = (custom ? file.split('/').pop() : file) ?? '';
        return {
            file,
            custom,
            name: name.replace(/\.[^.]+$/, ''),
            url: urlOf(tile),
            thumb: custom ? file : context().getThumbnailUrl('bg', file),
            // the thumbnail is 160px wide, too soft for a tile on a high-density screen
            full: custom ? null : getBackgroundPath(file),
        };
    });
    return { system: read('bg_menu_content', false), chat: read('bg_custom_content', true) };
}

function readFolders() {
    return [...document.querySelectorAll('#bg_folder_grid .bg_folder_tile:not(.bg_new_folder_tile)')].map((tile) => ({
        id: tile.getAttribute('data-folder-id'),
        name: tile.querySelector('.bg_folder_tile_name')?.textContent ?? '',
    })).filter((folder) => folder.id);
}

async function loadFolderMap() {
    try {
        const response = await fetch('/api/backgrounds/folders', {
            method: 'POST',
            headers: context().getRequestHeaders(),
            body: JSON.stringify({}),
        });
        folderMap = response.ok ? ((await response.json()).imageFolderMap ?? {}) : {};
    } catch {
        folderMap = {};
    }
}

// ── Doing things ──

function usePicture(picture, { everywhere = false } = {}) {
    const tile = appTile(picture.file, picture.custom);
    if (!tile) {
        return;
    }
    // the app's own click; Shift sets it everywhere even when this conversation has its own
    tile.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: everywhere }));
    scheduleRedraw();
}

function upload() {
    appTab(view.source === CHAT ? 1 : 0);
    document.getElementById('add_bg_button')?.click();
}

function pictureMenu(picture, anchor, point) {
    const locked = lockedUrl();
    const isLocked = !!locked && locked === picture.url;
    const items = [
        { label: 'Use', run: () => usePicture(picture) },
    ];
    if (!picture.custom && locked) {
        items.push({ label: 'Use Everywhere', run: () => usePicture(picture, { everywhere: true }) });
    }
    items.push(isLocked
        ? { label: 'Stop Using for This Chat', run: () => appAction(picture.file, picture.custom, 'unlock') }
        : { label: 'Use for This Chat Only', run: () => appAction(picture.file, picture.custom, 'lock') });
    items.push({});
    if (picture.custom) {
        items.push({ label: 'Add to My Backgrounds', run: () => appAction(picture.file, true, 'copy') });
    } else {
        items.push({ label: 'Rename…', run: () => appAction(picture.file, false, 'edit') });
        items.push({ label: 'Add to Folder…', run: () => appAction(picture.file, false, 'folder') });
        if (view.source !== ALL && view.source !== CHAT) {
            items.push({ label: 'Make Folder Cover', run: () => appAction(picture.file, false, 'set-cover') });
        }
    }
    items.push({}, { label: 'Delete…', danger: true, run: () => appAction(picture.file, picture.custom, 'delete') });
    toggleMenu(anchor, items, point);
}

function folderMenu(folder, anchor, point) {
    const tile = document.querySelector(`#bg_folder_grid .bg_folder_tile[data-folder-id="${CSS.escape(folder.id)}"]`);
    toggleMenu(anchor, [
        { label: 'Rename Folder…', run: () => /** @type {HTMLElement} */ (tile?.querySelector('[data-action="rename-folder"]'))?.click() },
        { label: 'Delete Folder…', danger: true, run: () => /** @type {HTMLElement} */ (tile?.querySelector('[data-action="delete-folder"]'))?.click() },
    ], point);
}

// ── Drawing ──

function sourceRow(id, label, count, symbol) {
    const row = button(`imsg-cn-row imsg-bg-source${view.source === id && view.picked ? ' imsg-cn-current' : ''}`);
    const icon = element('span', 'imsg-bg-source-icon');
    icon.append(glyph(symbol));
    row.append(icon, element('span', 'imsg-cn-row-name', label), element('span', 'imsg-cn-row-note', String(count)));
    row.addEventListener('click', () => {
        view.source = id;
        view.picked = true;
        render();
    });
    return row;
}

function renderSide(side, pictures, folders) {
    const list = side.querySelector('.imsg-cn-scroll');
    const library = element('div', 'imsg-cn-section');
    library.append(
        element('h3', 'imsg-cn-section-title', t('Library')),
        sourceRow(ALL, t('My Backgrounds'), pictures.system.length, 'photo'),
        sourceRow(CHAT, t('This Chat'), pictures.chat.length, 'bubble'),
    );
    const parts = [library];
    if (folders.length) {
        const box = element('div', 'imsg-cn-section');
        box.append(element('h3', 'imsg-cn-section-title', t('Folders')));
        for (const folder of folders) {
            const count = pictures.system.filter((x) => (folderMap[x.file] ?? []).includes(folder.id)).length;
            const row = sourceRow(folder.id, folder.name, count, 'folder');
            row.querySelector('.imsg-cn-row-name').textContent = folder.name;
            row.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                folderMenu(folder, row, { x: event.clientX, y: event.clientY });
            });
            box.append(row);
        }
        parts.push(box);
    }
    const scroll = list.scrollTop;
    list.replaceChildren(...parts);
    list.scrollTop = scroll;
}

function buildTile(picture) {
    const locked = lockedUrl();
    const current = locked ? picture.url === locked : !picture.custom && picture.file === background_settings.name;
    const isLocked = !!locked && picture.url === locked;
    const tile = button(`imsg-bg-tile${current ? ' imsg-bg-current' : ''}`);
    tile.title = picture.name;
    const frame = element('span', 'imsg-bg-frame');
    const img = element('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = picture.thumb;
    if (picture.full) {
        img.srcset = `${picture.thumb} 1x, ${picture.full} 2x`;
    }
    frame.append(img);
    if (current) {
        const badge = element('span', 'imsg-bg-badge');
        badge.append(glyph(isLocked ? 'lock' : 'check'));
        frame.append(badge);
    }
    const more = element('span', 'imsg-bg-more');
    more.setAttribute('role', 'button');
    more.setAttribute('aria-label', t('More'));
    more.append(glyph('ellipsis'));
    more.addEventListener('click', (event) => {
        event.stopPropagation();
        pictureMenu(picture, more);
    });
    frame.append(more);
    tile.append(frame, element('span', 'imsg-bg-name', picture.name));
    tile.addEventListener('click', () => usePicture(picture));
    tile.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        pictureMenu(picture, tile, { x: event.clientX, y: event.clientY });
    });
    return tile;
}

function renderGrid(pane, pictures, folders) {
    const folder = folders.find((x) => x.id === view.source);
    if (view.source !== ALL && view.source !== CHAT && !folder) {
        view.source = ALL;
    }
    const shown = (view.source === CHAT ? pictures.chat : pictures.system)
        .filter((x) => !folder || (folderMap[x.file] ?? []).includes(folder.id))
        .filter((x) => !view.needle || x.name.toLowerCase().includes(view.needle.toLowerCase()));
    const title = view.source === CHAT ? t('This Chat') : folder?.name ?? t('My Backgrounds');

    const bar = element('header', 'imsg-cn-pane-bar');
    const back = button('imsg-cn-back', 'Library', () => {
        view.picked = false;
        render();
    });
    back.prepend(glyph('chevron-left'));
    const add = button('imsg-sym-button imsg-cn-add-menu');
    add.setAttribute('aria-label', t('Add Photos'));
    add.title = t('Add Photos');
    add.append(glyph('plus'));
    add.addEventListener('click', upload);
    bar.append(back, element('h2', 'imsg-cn-pane-title', title), add);

    const status = element('div', 'imsg-bg-status');
    const locked = lockedUrl();
    if (locked) {
        status.append(element('span', '', t('This chat has its own background.')));
        const unlock = button('imsg-bg-link', 'Use My Background Again', () => {
            const tile = [...document.querySelectorAll('#bg_menu_content .bg_example, #bg_custom_content .bg_example')].find((x) => urlOf(x) === locked);
            /** @type {HTMLElement} */ (tile?.querySelector('.jg-button[data-action="unlock"]'))?.click();
            scheduleRedraw();
        });
        status.append(unlock);
    } else {
        status.append(element('span', '', context().getCurrentChatId?.() ? t('Click a picture to use it everywhere. Right-click for more.') : t('Click a picture to use it.')));
    }

    const grid = element('div', 'imsg-bg-grid');
    if (shown.length) {
        grid.append(...shown.map(buildTile));
    } else {
        const empty = element('div', 'imsg-cn-empty', view.needle ? t('No Results') : view.source === CHAT ? t('No pictures for this chat yet') : t('No Backgrounds'));
        grid.append(empty);
    }
    const scroll = pane.querySelector('.imsg-bg-grid')?.scrollTop ?? 0;
    pane.replaceChildren(bar, status, grid);
    grid.scrollTop = scroll;
}

function render() {
    const root = document.getElementById(ROOT_ID);
    if (!root) {
        return;
    }
    const pictures = readPictures();
    const folders = readFolders();
    renderSide(root.querySelector('.imsg-cn-side'), pictures, folders);
    renderGrid(root.querySelector('.imsg-cn-detail'), pictures, folders);
    root.classList.toggle('imsg-cn-has-detail', view.picked);
}

function scheduleRedraw() {
    clearTimeout(redrawTimer);
    redrawTimer = setTimeout(async () => {
        await loadFolderMap();
        render();
    }, 120);
}

function close() {
    document.getElementById(ROOT_ID)?.remove();
    document.removeEventListener('keydown', onKey, true);
    observer?.disconnect();
    observer = null;
}

function onKey(event) {
    if (event.key !== 'Escape' || overlayOpen()) {
        return;
    }
    event.stopPropagation();
    const root = document.getElementById(ROOT_ID);
    if (view.picked && isPhone()) {
        view.picked = false;
        render();
    } else if (root) {
        close();
    }
}

/** Opens Backgrounds. */
export async function openBackgrounds() {
    close();
    view = { source: ALL, needle: '', picked: true };

    const root = element('div', 'imsg-cn imsg-bg');
    root.id = ROOT_ID;
    const win = element('div', 'imsg-cn-window');
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-modal', 'true');
    win.setAttribute('aria-label', t('Backgrounds'));

    const side = element('div', 'imsg-cn-side');
    const bar = element('header', 'imsg-cn-bar');
    const add = button('imsg-sym-button imsg-cn-add-menu');
    add.setAttribute('aria-label', t('Add'));
    add.title = t('Add');
    add.append(glyph('plus'));
    add.addEventListener('click', () => toggleMenu(add, [
        { label: 'Add Photos…', run: upload },
        { label: 'New Folder…', run: () => document.getElementById('bg_add_folder_button')?.click() },
    ]));
    bar.append(button('imsg-cn-done', 'Done', close), element('h1', 'imsg-cn-title', t('Backgrounds')), add);
    const searchBox = element('label', 'imsg-search imsg-cn-search');
    searchBox.append(glyph('search'));
    const search = element('input');
    search.type = 'search';
    search.placeholder = t('Search');
    search.setAttribute('aria-label', search.placeholder);
    search.addEventListener('input', () => {
        view.needle = search.value;
        view.picked = true;
        render();
    });
    searchBox.append(search);
    const listWrap = element('div', 'imsg-cn-listwrap');
    listWrap.append(element('div', 'imsg-cn-scroll'));
    side.append(bar, searchBox, listWrap);
    const detail = element('section', 'imsg-cn-detail imsg-bg-detail');
    win.append(side, detail);
    root.append(win);
    root.addEventListener('mousedown', (event) => {
        if (event.target === root) {
            close();
        }
    });
    document.body.append(root);
    document.addEventListener('keydown', onKey, true);

    // the app's panel redraws after an upload, rename, delete or folder change; this follows
    observer = new MutationObserver(scheduleRedraw);
    for (const id of ['bg_menu_content', 'bg_custom_content', 'bg_folder_grid']) {
        const node = document.getElementById(id);
        if (node) {
            observer.observe(node, { childList: true });
        }
    }
    await loadFolderMap();
    render();
}

export function initBackgrounds() {
    const { eventTypes } = context();
    const eventSource = events();
    eventSource.on(eventTypes.CHAT_CHANGED, () => {
        if (document.getElementById(ROOT_ID)) {
            scheduleRedraw();
        }
    });
}

// turning the theme off closes the window, putting back what it borrowed
onStop(close);
