// A System Settings-style window for one of the app's own panels: its sections in a sidebar,
// each with a colored tile, and the open section on the right. The section's controls are the
// app's own, borrowed (host.js) while the section is open, so they keep their handlers and values.
//
// Settings, Connections, Formatting and Response Settings are each a list of sections (settings.js).

import { toggleMenu } from './shell.js';
import { host, releaseAll } from './host.js';
import { onStop } from './power.js';

const TILE_COLORS = ['#0a84ff', '#30b0c7', '#34c759', '#ff9f0a', '#ff375f', '#bf5af2', '#5e5ce6', '#8e8e93', '#64d2ff', '#ac8e68'];

/** The window that's open: its definition and where it's at */
let open = null;

function context() {
    return SillyTavern.getContext();
}

function t(text) {
    return context().translate(text);
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text !== undefined) {
        node.textContent = text;
    }
    return node;
}

function button(className, label, run) {
    const node = element('button', className, label === undefined ? undefined : t(label));
    node.type = 'button';
    if (run) {
        node.addEventListener('click', run);
    }
    return node;
}

function glyph(symbol) {
    const node = element('i', 'imsg-sym');
    node.style.setProperty('--imsg-glyph', `var(--imsg-sym-${symbol})`);
    return node;
}

/** A rounded colored square with a symbol, as System Settings shows its panes. */
export function tile(section, big = false) {
    const node = element('span', `imsg-ext-tile${big ? ' imsg-ext-tile-big' : ''}`);
    node.style.background = section.color ?? TILE_COLORS[0];
    if (section.symbol) {
        node.append(glyph(section.symbol));
    } else {
        node.textContent = (section.title.match(/[A-Za-z0-9]/)?.[0] ?? '•').toUpperCase();
    }
    return node;
}

function sections() {
    return open.def.sections().filter((x) => x.available !== false);
}

function nodesOf(section) {
    return (section.nodes?.() ?? []).filter(Boolean);
}

function matches(section, needle) {
    if (!needle) {
        return true;
    }
    if (t(section.title).toLowerCase().includes(needle)) {
        return true;
    }
    return nodesOf(section).some((node) => node.textContent.toLowerCase().includes(needle));
}

// ── Drawing ──

function renderSide(side) {
    const list = side.querySelector('.imsg-cn-scroll');
    const needle = open.needle.trim().toLowerCase();
    const groups = new Map();
    for (const section of sections().filter((x) => matches(x, needle))) {
        const name = section.group ?? '';
        if (!groups.has(name)) {
            groups.set(name, []);
        }
        groups.get(name).push(section);
    }
    const boxes = [];
    for (const [name, items] of groups) {
        const box = element('div', 'imsg-cn-section');
        if (name) {
            box.append(element('h3', 'imsg-cn-section-title', t(name)));
        }
        for (const section of items) {
            const row = button(`imsg-cn-row imsg-ext-row${open.key === section.key ? ' imsg-cn-current' : ''}`);
            row.append(tile(section), element('span', 'imsg-cn-row-name', t(section.title)));
            const note = section.note?.();
            if (note) {
                row.append(element('span', 'imsg-cn-row-note', note));
            }
            row.addEventListener('click', () => {
                open.key = section.key;
                open.level = 1;
                render();
            });
            box.append(row);
        }
        boxes.push(box);
    }
    if (!boxes.length) {
        boxes.push(element('p', 'imsg-cn-empty', t('No Results')));
    }
    const scroll = list.scrollTop;
    list.replaceChildren(...boxes);
    list.scrollTop = scroll;
}

function paneBar(title) {
    const bar = element('header', 'imsg-cn-pane-bar');
    // as on iOS, a long title gives way to Back so it doesn't run into the pane's own title
    const back = button('imsg-cn-back', open.def.title.length > 12 ? 'Back' : open.def.title, () => {
        open.level = 0;
        render();
    });
    back.prepend(glyph('chevron-left'));
    bar.append(back, element('h2', 'imsg-cn-pane-title', title), element('span'));
    return bar;
}

function renderSection(pane, section) {
    releaseAll();
    const body = element('div', 'imsg-cn-form imsg-ext-body imsg-set-body');
    const hostBox = element('div', `imsg-host imsg-ext-host imsg-set-host${section.hideTitle ? ' imsg-set-notitle' : ''}`);
    hostBox.dataset.section = section.key;
    if (section.intro) {
        section.intro(body, () => render());
    }
    body.append(hostBox);
    pane.replaceChildren(paneBar(t(section.title)), body);
    for (const node of nodesOf(section)) {
        host(node, hostBox);
        if (section.show) {
            node.classList.add('imsg-set-show');
        }
    }
    section.opened?.(hostBox);
}

function render() {
    const root = document.getElementById(open?.def.id);
    if (!root) {
        return;
    }
    const all = sections();
    let section = all.find((x) => x.key === open.key);
    if (!section) {
        section = all[0];
        open.key = section?.key;
    }
    if (section) {
        renderSection(root.querySelector('.imsg-cn-detail'), section);
    }
    renderSide(root.querySelector('.imsg-cn-side'));
    root.classList.toggle('imsg-cn-has-detail', open.level >= 1);
}

/** Redraws the open window, if any, after something it shows has changed. */
export function redrawPanes() {
    if (open) {
        render();
    }
}

function close() {
    for (const node of document.querySelectorAll('.imsg-set-show')) {
        node.classList.remove('imsg-set-show');
    }
    releaseAll();
    if (open) {
        document.getElementById(open.def.id)?.remove();
        open.def.closed?.();
    }
    open = null;
    document.removeEventListener('keydown', onKey, true);
}

function onKey(event) {
    if (event.key !== 'Escape' || document.querySelector('dialog.popup[open]') || document.getElementById('imsg-menu')?.hidden === false) {
        return;
    }
    // Esc inside one of the borrowed fields stays with the field
    if (event.target instanceof HTMLElement && event.target.closest('.imsg-set-host') && event.target.matches('input, textarea, select')) {
        event.target.blur();
        event.stopPropagation();
        return;
    }
    event.stopPropagation();
    if (open?.level > 0 && matchMedia('(max-width: 1000px)').matches) {
        open.level = 0;
        render();
    } else {
        close();
    }
}

/**
 * Opens a sectioned window.
 * @param {object} def id, title, sections() → [{ key, title, symbol, color, group, note(), nodes(),
 *   intro(body, redraw), opened(hostBox), hideTitle, show, available }], menu() → menu items, closed()
 * @param {string} [start] the section to open on
 */
export function openPanes(def, start = null) {
    close();
    const phone = matchMedia('(max-width: 1000px)').matches;
    open = { def, key: start, level: start || !phone ? 1 : 0, needle: '' };

    const root = element('div', `imsg-cn imsg-ext imsg-set ${def.className ?? ''}`);
    root.id = def.id;
    const win = element('div', 'imsg-cn-window');
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-modal', 'true');
    win.setAttribute('aria-label', def.title);
    const side = element('div', 'imsg-cn-side');
    const bar = element('header', 'imsg-cn-bar');
    let more = element('span');
    if (def.menu) {
        more = button('imsg-sym-button imsg-cn-add-menu');
        more.setAttribute('aria-label', t('More'));
        more.append(glyph('ellipsis'));
        more.addEventListener('click', () => toggleMenu(more, def.menu()));
    }
    bar.append(button('imsg-cn-done', 'Done', close), element('h1', 'imsg-cn-title', def.title), more);
    const searchBox = element('label', 'imsg-search imsg-cn-search');
    searchBox.append(glyph('search'));
    const search = element('input');
    search.type = 'search';
    search.placeholder = t('Search');
    search.setAttribute('aria-label', search.placeholder);
    search.addEventListener('input', () => {
        open.needle = search.value;
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
