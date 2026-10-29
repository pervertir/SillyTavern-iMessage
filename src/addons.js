// Extensions window, laid out like System Settings: one pane per extension with settings, plus
// Manage (enable, disable, remove, install from URL). Each extension's settings block is moved in
// with host.js rather than redrawn, so it keeps its own handlers.

import * as ext from '../../../../extensions.js';
import { toggleMenu } from './shell.js';
import { host, releaseAll } from './host.js';
import { onStop } from './power.js';
import { button, context, element, escapeHtml, glyph, isPhone, overlayOpen, t } from './dom.js';

const ROOT_ID = 'imsg-extensions';
const MANAGE = '__manage__';
const TILE_COLORS = ['#0a84ff', '#30b0c7', '#34c759', '#ff9f0a', '#ff375f', '#bf5af2', '#5e5ce6', '#ff6482', '#64d2ff', '#ac8e68'];

let view = { key: MANAGE, level: 0, needle: '' };
let needsReload = false;

function hash(text) {
    let value = 0;
    for (const char of text) {
        value = (value * 31 + char.charCodeAt(0)) >>> 0;
    }
    return value;
}

/** A rounded colored square with the name's first letter, as System Settings shows its panes. */
function tile(name, symbol) {
    const node = element('span', 'imsg-ext-tile');
    node.style.background = TILE_COLORS[hash(name) % TILE_COLORS.length];
    if (symbol) {
        node.append(glyph(symbol));
    } else {
        node.textContent = (name.match(/[A-Za-z0-9]/)?.[0] ?? '•').toUpperCase();
    }
    return node;
}

// ── What's installed ──

/** Every settings panel the extensions drew, with its title. */
function panels() {
    const found = [];
    for (const column of document.querySelectorAll('#extensions_settings, #extensions_settings2')) {
        for (const drawer of column.querySelectorAll('.inline-drawer')) {
            // only the outermost drawers: inner ones are sections of an extension's own page
            if (drawer.parentElement?.closest('.inline-drawer') && column.contains(drawer.parentElement.closest('.inline-drawer'))) {
                continue;
            }
            const head = drawer.querySelector(':scope > .inline-drawer-header, :scope > .inline-drawer-toggle');
            const content = drawer.querySelector(':scope > .inline-drawer-content');
            const title = head?.textContent.replace(/\s+/g, ' ').trim().replace(/\s*\?$/, '');
            if (title && content) {
                found.push({ key: `p:${title}`, title, content, drawer });
            }
        }
    }
    // panels already borrowed into the window are found where they are now
    for (const content of document.querySelectorAll(`#${ROOT_ID} .imsg-hosted`)) {
        const title = content.dataset.imsgTitle;
        if (title && !found.some((x) => x.title === title)) {
            found.push({ key: `p:${title}`, title, content });
        }
    }
    return found.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}

function installed() {
    const disabled = context().extensionSettings.disabledExtensions ?? [];
    return (ext.extensionNames ?? []).map((name) => {
        const manifest = ext.getExtensionManifest(name) ?? {};
        return {
            name,
            title: manifest.display_name || name.replace(/^third-party\//, ''),
            author: manifest.author ?? '',
            version: manifest.version ?? '',
            thirdParty: name.startsWith('third-party/'),
            on: !disabled.includes(name),
        };
    }).sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}

async function setEnabled(item, on) {
    if (on) {
        await ext.enableExtension(item.name, false);
    } else {
        await ext.disableExtension(item.name, false);
    }
    needsReload = true;
    render();
}

async function remove(item) {
    const ctx = context();
    const ok = await ctx.callGenericPopup(`<h3>${t('Delete')} “${escapeHtml(item.title)}”?</h3><p>${t('Its files are removed and the page reloads.')}</p>`, ctx.POPUP_TYPE.CONFIRM, '', { okButton: t('Delete'), cancelButton: t('Cancel') });
    if (ok === ctx.POPUP_RESULT.AFFIRMATIVE) {
        await ext.deleteExtension(item.name.replace(/^third-party/, ''));
    }
}

// ── Drawing ──

function renderSide(side) {
    const list = side.querySelector('.imsg-cn-scroll');
    const needle = view.needle.trim().toLowerCase();
    const row = (key, title, icon, note) => {
        const node = button(`imsg-cn-row imsg-ext-row${view.key === key ? ' imsg-cn-current' : ''}`);
        node.append(icon, element('span', 'imsg-cn-row-name', title));
        if (note) {
            node.append(element('span', 'imsg-cn-row-note', note));
        }
        node.addEventListener('click', () => {
            view = { ...view, key, level: 1 };
            render();
        });
        return node;
    };
    const top = element('div', 'imsg-cn-section');
    top.append(row(MANAGE, t('Manage Extensions'), tile('Manage', 'gear'), String(installed().length)));
    const box = element('div', 'imsg-cn-section');
    box.append(element('h3', 'imsg-cn-section-title', t('Settings')));
    for (const panel of panels().filter((x) => !needle || x.title.toLowerCase().includes(needle))) {
        box.append(row(panel.key, panel.title, tile(panel.title)));
    }
    const scroll = list.scrollTop;
    list.replaceChildren(top, box);
    list.scrollTop = scroll;
}

function paneBar(title, right) {
    const bar = element('header', 'imsg-cn-pane-bar');
    const back = button('imsg-cn-back', 'Extensions', () => {
        view = { ...view, level: 0 };
        render();
    });
    back.prepend(glyph('chevron-left'));
    bar.append(back, element('h2', 'imsg-cn-pane-title', title), right ?? element('span'));
    return bar;
}

function reloadBanner() {
    const banner = element('div', 'imsg-ext-banner');
    banner.append(element('span', '', t('The page reloads when you close Extensions, to finish turning them on or off.')), button('imsg-ext-reload', 'Reload Now', () => location.reload()));
    return banner;
}

function renderManage(pane) {
    const more = button('imsg-sym-button imsg-cn-add-menu');
    more.setAttribute('aria-label', t('More'));
    more.append(glyph('plus'));
    more.addEventListener('click', () => toggleMenu(more, [
        { label: 'Install Extension…', run: () => ext.openThirdPartyExtensionMenu() },
        { label: 'Check for Updates…', run: () => document.getElementById('extensions_details')?.click() },
    ]));
    const body = element('div', 'imsg-cn-form imsg-ext-body');
    if (needsReload) {
        body.append(reloadBanner());
    }
    const groups = [
        [t('Added by You'), installed().filter((x) => x.thirdParty)],
        [t('Built In'), installed().filter((x) => !x.thirdParty)],
    ];
    for (const [title, items] of groups) {
        if (!items.length) {
            continue;
        }
        const box = element('fieldset', 'imsg-cn-group imsg-ext-list');
        box.append(element('legend', '', title));
        for (const item of items) {
            const row = element('div', `imsg-ext-item${item.on ? '' : ' imsg-ext-off'}`);
            const text = element('span', 'imsg-ext-item-text');
            text.append(element('b', '', item.title));
            const sub = [item.author, item.version ? `v${item.version}` : ''].filter(Boolean).join(' · ');
            if (sub) {
                text.append(element('small', '', sub));
            }
            const sw = element('input', 'imsg-wi-switch');
            sw.type = 'checkbox';
            sw.checked = item.on;
            sw.setAttribute('role', 'switch');
            sw.setAttribute('aria-label', item.title);
            sw.addEventListener('change', () => setEnabled(item, sw.checked));
            row.append(tile(item.title), text);
            if (item.thirdParty) {
                const menu = button('imsg-sym-button imsg-ext-more');
                menu.setAttribute('aria-label', t('More'));
                menu.append(glyph('ellipsis'));
                menu.addEventListener('click', () => toggleMenu(menu, [
                    { label: 'Delete…', danger: true, run: () => remove(item) },
                ]));
                row.append(menu);
            }
            row.append(sw);
            box.append(row);
        }
        body.append(box);
    }
    const install = button('imsg-wi-new', 'Install Extension…', () => ext.openThirdPartyExtensionMenu());
    install.prepend(glyph('plus'));
    body.append(install);
    pane.replaceChildren(paneBar(t('Manage Extensions'), more), body);
}

function renderPanel(pane, panel) {
    const body = element('div', 'imsg-cn-form imsg-ext-body');
    const header = element('div', 'imsg-ext-head');
    const big = tile(panel.title);
    big.classList.add('imsg-ext-tile-big');
    header.append(big, element('h2', '', panel.title));
    const hostBox = element('div', 'imsg-host imsg-ext-host');
    body.append(header, hostBox);
    pane.replaceChildren(paneBar(panel.title), body);
    // only the open panel is borrowed; the rest stay where the extension put them
    releaseAll();
    panel.content.dataset.imsgTitle = panel.title;
    host(panel.content, hostBox);
}

function render() {
    const root = document.getElementById(ROOT_ID);
    if (!root) {
        return;
    }
    const pane = root.querySelector('.imsg-cn-detail');
    if (view.key === MANAGE) {
        releaseAll();
        renderManage(pane);
    } else {
        const panel = panels().find((x) => x.key === view.key);
        if (panel) {
            renderPanel(pane, panel);
        } else {
            view.key = MANAGE;
            releaseAll();
            renderManage(pane);
        }
    }
    renderSide(root.querySelector('.imsg-cn-side'));
    root.classList.toggle('imsg-cn-has-detail', view.level >= 1);
}

function close() {
    releaseAll();
    document.getElementById(ROOT_ID)?.remove();
    document.removeEventListener('keydown', onKey, true);
    // as ST's own Manage Extensions does: the changes are saved, a reload applies them
    if (needsReload) {
        location.reload();
    }
}

function onKey(event) {
    if (event.key !== 'Escape' || overlayOpen()) {
        return;
    }
    // Esc inside an extension's own field stays with the field
    if (event.target instanceof HTMLElement && event.target.closest('.imsg-ext-host') && event.target.matches('input, textarea, select')) {
        event.target.blur();
        event.stopPropagation();
        return;
    }
    event.stopPropagation();
    if (view.level > 0 && isPhone()) {
        view = { ...view, level: 0 };
        render();
    } else {
        close();
    }
}

/** Opens Extensions, on an extension's settings when its title is given. */
export function openExtensions(title = null) {
    close();
    const phone = isPhone();
    view = { key: title ? `p:${title}` : MANAGE, level: title || !phone ? 1 : 0, needle: '' };

    const root = element('div', 'imsg-cn imsg-ext');
    root.id = ROOT_ID;
    const win = element('div', 'imsg-cn-window');
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-modal', 'true');
    win.setAttribute('aria-label', t('Extensions'));
    const side = element('div', 'imsg-cn-side');
    const bar = element('header', 'imsg-cn-bar');
    bar.append(button('imsg-cn-done', 'Done', close), element('h1', 'imsg-cn-title', t('Extensions')), element('span'));
    const searchBox = element('label', 'imsg-search imsg-cn-search');
    searchBox.append(glyph('search'));
    const search = element('input');
    search.type = 'search';
    search.placeholder = t('Search');
    search.setAttribute('aria-label', search.placeholder);
    search.addEventListener('input', () => {
        view.needle = search.value;
        renderSide(side);
    });
    searchBox.append(search);
    const listWrap = element('div', 'imsg-cn-listwrap');
    listWrap.append(element('div', 'imsg-cn-scroll'));
    side.append(bar, searchBox, listWrap);
    const detail = element('section', 'imsg-cn-detail imsg-ext-detail');
    win.append(side, detail);
    root.append(win);
    root.addEventListener('mousedown', (event) => {
        if (event.target === root) {
            close();
        }
    });
    document.body.append(root);
    document.addEventListener('keydown', onKey, true);
    render();
}

// turning the theme off closes the window, putting back what it borrowed
onStop(close);
