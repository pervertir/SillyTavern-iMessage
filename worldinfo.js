// World Info, laid out like Notes: lorebooks in the sidebar, the open book's entries beside them,
// and the selected entry's editor on the right. Each book shows whether it's on for every chat,
// for this chat or for the open character, and the global scan settings have their own page.
//
// Books and entries are read and saved through the app's own World Info functions, so its cache,
// events and the prompt stay in step. Renaming and duplicating a book go through the app's hidden
// editor, which also updates the characters and chats that use it.

import { events, onStop } from './power.js';
import { toggleMenu } from './shell.js';
import * as wi from '../../../world-info.js';

const ROOT_ID = 'imsg-worldinfo';
const SETTINGS = '__settings__';

const POSITIONS = [
    [0, 'Before the character'],
    [1, 'After the character'],
    [5, 'Before the examples'],
    [6, 'After the examples'],
    [2, 'Before the Author’s Note'],
    [3, 'After the Author’s Note'],
    [4, 'In the conversation, at a depth'],
    [7, 'Outlet (only where a macro asks for it)'],
];
const ROLES = [[0, 'System'], [1, 'User'], [2, 'Assistant']];
const LOGIC = [
    [0, 'and any of these'],
    [3, 'and all of these'],
    [2, 'and none of these'],
    [1, 'and not all of these'],
];
const STRATEGIES = [[0, 'Sorted evenly'], [1, 'Character’s books first'], [2, 'Global books first']];
const TRIGGERS = [['normal', 'Normal'], ['continue', 'Continue'], ['impersonate', 'Impersonate'], ['swipe', 'Swipe'], ['regenerate', 'Regenerate'], ['quiet', 'Quiet']];

/** The app's global settings, by its own control ids */
const SCAN_SETTINGS = [
    { id: 'world_info_depth', label: 'Scan depth', hint: 'How many recent messages are searched for keywords.', min: 0, max: 100 },
    { id: 'world_info_budget', label: 'Context share', hint: 'The most of the context World Info may use, in percent.', min: 1, max: 100, unit: '%' },
    { id: 'world_info_budget_cap', label: 'Token limit', hint: '0 for no limit.', min: 0, max: 65536, step: 64 },
    { id: 'world_info_min_activations', label: 'Minimum entries', hint: 'Keeps scanning older messages until this many entries are found. 0 to turn off.', min: 0, max: 100 },
    { id: 'world_info_min_activations_depth_max', label: 'Furthest it scans for the minimum', hint: '0 for no limit.', min: 0, max: 100 },
    { id: 'world_info_max_recursion_steps', label: 'Recursion steps', hint: '0 for no limit.', min: 0, max: 10 },
];
const SCAN_FLAGS = [
    { id: 'world_info_include_names', label: 'Include names when scanning' },
    { id: 'world_info_recursive', label: 'Entries can trigger other entries' },
    { id: 'world_info_case_sensitive', label: 'Case-sensitive keywords' },
    { id: 'world_info_match_whole_words', label: 'Match whole words only' },
    { id: 'world_info_use_group_scoring', label: 'Score groups by keyword matches' },
    { id: 'world_info_overflow_alert', label: 'Warn when the budget runs out' },
];

/** What's on screen */
let view = { book: null, uid: null, level: 0, needle: '' };
/** The open book's entries, as last loaded */
let bookData = null;
let saveTimer = 0;

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

function select(options, value) {
    const node = element('select');
    for (const [key, label] of options) {
        const option = element('option', '', t(label));
        option.value = String(key);
        node.append(option);
    }
    node.value = String(value);
    return node;
}

function field(label, control, hint) {
    const box = element('label', 'imsg-cn-field');
    box.append(element('span', 'imsg-cn-field-label', t(label)), control);
    if (hint) {
        box.append(element('small', 'imsg-cn-hint', t(hint)));
    }
    return box;
}

function input(type, value) {
    const node = element('input');
    node.type = type;
    node.value = value ?? '';
    return node;
}

function check(label, checked) {
    const box = element('label', 'imsg-cn-check');
    const box1 = element('input');
    box1.type = 'checkbox';
    box1.checked = !!checked;
    box.append(box1, element('span', '', t(label)));
    return { box, input: box1 };
}

/** The iOS-style switch used across the theme's settings */
function toggle(checked, label) {
    const node = element('input', 'imsg-wi-switch');
    node.type = 'checkbox';
    node.checked = !!checked;
    node.setAttribute('role', 'switch');
    node.setAttribute('aria-label', label);
    return node;
}

// ── Books ──

function names() {
    return [...(wi.world_names ?? [])].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function isGlobal(name) {
    return (wi.selected_world_info ?? []).includes(name);
}

function chatBook() {
    return context().chatMetadata?.[wi.METADATA_KEY] ?? null;
}

function characterBook() {
    const ctx = context();
    return ctx.characters[ctx.characterId]?.data?.extensions?.world ?? null;
}

/** Turns a book on or off for every chat, through the app's own list. */
function setGlobal(name, on) {
    const $ = /** @type {any} */ (window).$;
    const index = wi.world_names.indexOf(name);
    const option = $(`#world_info option[value="${index}"]`);
    if (!option.length) {
        return;
    }
    option.prop('selected', on);
    $('#world_info').trigger('change');
}

async function setChatBook(name) {
    const ctx = context();
    if (!ctx.getCurrentChatId?.()) {
        toastr.info(t('Open a conversation first.'));
        return;
    }
    if (name) {
        ctx.chatMetadata[wi.METADATA_KEY] = name;
    } else {
        delete ctx.chatMetadata[wi.METADATA_KEY];
    }
    await ctx.saveMetadata();
    render();
}

async function setCharacterBook(name) {
    const ctx = context();
    if (ctx.characterId === undefined || ctx.groupId) {
        toastr.info(t('Open a conversation with one character first.'));
        return;
    }
    await wi.charUpdatePrimaryWorld(name ?? '');
    render();
}

/** Opens a book in the app's hidden editor, for its own rename and duplicate. */
function appEditor(name, buttonId) {
    const $ = /** @type {any} */ (window).$;
    const index = wi.world_names.indexOf(name);
    $('#world_editor_select').val(index).trigger('change');
    setTimeout(() => document.getElementById(buttonId)?.click(), 150);
}

async function newBook() {
    const ctx = context();
    const name = await ctx.callGenericPopup(t('Name the new lorebook:'), ctx.POPUP_TYPE.INPUT, wi.getFreeWorldName?.() ?? '', { okButton: t('Create'), cancelButton: t('Cancel') });
    if (!name || typeof name !== 'string') {
        return;
    }
    if (await wi.createNewWorldInfo(name.trim(), { interactive: true }) !== false) {
        await openBook(name.trim());
    }
}

async function deleteBook(name) {
    const ctx = context();
    const ok = await ctx.callGenericPopup(`<h3>${t('Delete')} “${escapeHtml(name)}”?</h3><p>${t('Every entry in it goes too. This can’t be undone.')}</p>`, ctx.POPUP_TYPE.CONFIRM, '', { okButton: t('Delete'), cancelButton: t('Cancel') });
    if (ok !== ctx.POPUP_RESULT.AFFIRMATIVE) {
        return;
    }
    await wi.deleteWorldInfo(name);
    if (view.book === name) {
        view = { ...view, book: null, uid: null, level: 0 };
        bookData = null;
    }
    render();
}

async function exportBook(name) {
    const data = await wi.loadWorldInfo(name);
    if (!data) {
        return;
    }
    const link = element('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 4)], { type: 'application/json' }));
    link.download = `${name}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}

function escapeHtml(text) {
    const node = element('span');
    node.textContent = text;
    return node.innerHTML;
}

function bookMenu(name, anchor, point) {
    const chat = chatBook() === name;
    const character = characterBook() === name;
    toggleMenu(anchor, [
        { label: 'On for Every Chat', checked: isGlobal(name), run: () => { setGlobal(name, !isGlobal(name)); render(); } },
        { label: 'On for This Chat', checked: chat, run: () => setChatBook(chat ? null : name) },
        { label: 'Character’s Lorebook', checked: character, run: () => setCharacterBook(character ? null : name) },
        {},
        { label: 'Rename…', run: () => appEditor(name, 'world_popup_name_button') },
        { label: 'Duplicate…', run: () => appEditor(name, 'world_duplicate') },
        { label: 'Export', run: () => exportBook(name) },
        {},
        { label: 'Delete Lorebook…', danger: true, run: () => deleteBook(name) },
    ], point);
}

async function openBook(name) {
    view = { ...view, book: name, uid: null, level: 1, needle: '' };
    bookData = await wi.loadWorldInfo(name);
    render();
}

// ── Entries ──

function entries() {
    return Object.values(bookData?.entries ?? {}).sort((a, b) => (a.displayIndex ?? a.uid) - (b.displayIndex ?? b.uid));
}

function entryTitle(entry) {
    return entry.comment?.trim() || entry.key?.join(', ') || t('Untitled');
}

/** Saves the open book a moment after the last change. */
function saveSoon() {
    clearTimeout(saveTimer);
    const name = view.book;
    const data = bookData;
    saveTimer = setTimeout(async () => {
        await wi.saveWorldInfo(name, structuredClone(data), true);
        wi.reloadEditor?.(name);
    }, 400);
}

function addEntry() {
    const entry = wi.createWorldInfoEntry(view.book, bookData);
    if (!entry) {
        return;
    }
    entry.comment = '';
    saveSoon();
    view = { ...view, uid: entry.uid, level: 2 };
    render();
    document.querySelector(`#${ROOT_ID} .imsg-wi-title-input`)?.focus();
}

async function removeEntry(uid) {
    const ctx = context();
    const ok = await ctx.callGenericPopup(`<h3>${t('Delete this entry?')}</h3>`, ctx.POPUP_TYPE.CONFIRM, '', { okButton: t('Delete'), cancelButton: t('Cancel') });
    if (ok !== ctx.POPUP_RESULT.AFFIRMATIVE) {
        return;
    }
    delete bookData.entries[uid];
    wi.deleteWIOriginalDataValue?.(bookData, uid);
    saveSoon();
    view = { ...view, uid: null, level: 1 };
    render();
}

function duplicateEntry(uid) {
    const copy = wi.duplicateWorldInfoEntry?.(bookData, uid);
    if (copy) {
        saveSoon();
        view = { ...view, uid: copy.uid, level: 2 };
        render();
    }
}

// ── Drawing ──

function renderBooks(side) {
    const list = side.querySelector('.imsg-cn-scroll');
    const parts = [];
    const settingsRow = button(`imsg-cn-row imsg-bg-source${view.book === SETTINGS ? ' imsg-cn-current' : ''}`);
    const icon = element('span', 'imsg-bg-source-icon');
    icon.append(glyph('gear'));
    settingsRow.append(icon, element('span', 'imsg-cn-row-name', t('Scan Settings')));
    settingsRow.addEventListener('click', () => {
        view = { ...view, book: SETTINGS, uid: null, level: 2 };
        render();
    });
    const top = element('div', 'imsg-cn-section');
    top.append(settingsRow);
    parts.push(top);

    const box = element('div', 'imsg-cn-section');
    box.append(element('h3', 'imsg-cn-section-title', t('Lorebooks')));
    const chat = chatBook();
    const character = characterBook();
    for (const name of names()) {
        const row = button(`imsg-cn-row imsg-bg-source imsg-wi-book${view.book === name ? ' imsg-cn-current' : ''}`);
        const bookIcon = element('span', 'imsg-bg-source-icon');
        bookIcon.append(glyph('book'));
        const text = element('span', 'imsg-cn-row-name');
        text.append(element('span', '', name));
        const where = [isGlobal(name) ? t('Every chat') : '', chat === name ? t('This chat') : '', character === name ? t('Character') : ''].filter(Boolean);
        if (where.length) {
            text.append(element('small', 'imsg-wi-where', where.join(' · ')));
        }
        row.append(bookIcon, text);
        if (isGlobal(name) || chat === name || character === name) {
            row.append(element('span', 'imsg-wi-on'));
        }
        row.addEventListener('click', () => openBook(name));
        row.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            bookMenu(name, row, { x: event.clientX, y: event.clientY });
        });
        box.append(row);
    }
    if (!names().length) {
        box.append(element('p', 'imsg-cn-none', t('No Lorebooks')));
    }
    parts.push(box);
    const scroll = list.scrollTop;
    list.replaceChildren(...parts);
    list.scrollTop = scroll;
}

function renderEntries(column) {
    if (!view.book || view.book === SETTINGS || !bookData) {
        column.replaceChildren(element('div', 'imsg-cn-empty', t('No Lorebook Selected')));
        return;
    }
    const bar = element('header', 'imsg-cn-pane-bar');
    const back = button('imsg-cn-back', 'Lorebooks', () => {
        view = { ...view, level: 0 };
        render();
    });
    back.prepend(glyph('chevron-left'));
    const more = button('imsg-sym-button imsg-cn-add-menu');
    more.setAttribute('aria-label', t('More'));
    more.append(glyph('ellipsis-circle'));
    more.addEventListener('click', () => bookMenu(view.book, more));
    bar.append(back, element('h2', 'imsg-cn-pane-title', view.book), more);

    // the book's switch: on for every chat
    const globalRow = element('label', 'imsg-wi-global');
    const globalSwitch = toggle(isGlobal(view.book), t('On for every chat'));
    globalSwitch.addEventListener('change', () => {
        setGlobal(view.book, globalSwitch.checked);
        render();
    });
    globalRow.append(element('span', '', t('On for every chat')), globalSwitch);

    const searchBox = element('label', 'imsg-search imsg-cn-search');
    searchBox.append(glyph('search'));
    const search = element('input');
    search.type = 'search';
    search.placeholder = t('Search Entries');
    search.value = view.needle;
    search.addEventListener('input', () => {
        view.needle = search.value;
        drawList();
    });
    searchBox.append(search);

    const list = element('div', 'imsg-wi-entries');
    const drawList = () => {
        const needle = view.needle.trim().toLowerCase();
        const shown = entries().filter((entry) => !needle || [entry.comment, entry.content, ...(entry.key ?? [])].join('\n').toLowerCase().includes(needle));
        list.replaceChildren(...shown.map(buildEntryRow));
        if (!shown.length) {
            list.append(element('p', 'imsg-cn-none', needle ? t('No Results') : t('No Entries')));
        }
    };
    drawList();

    const add = button('imsg-wi-new', 'New Entry', addEntry);
    add.prepend(glyph('compose'));
    const scroll = column.querySelector('.imsg-wi-entries')?.scrollTop ?? 0;
    column.replaceChildren(bar, globalRow, searchBox, list, add);
    list.scrollTop = scroll;
}

function buildEntryRow(entry) {
    const row = button(`imsg-wi-entry${entry.uid === view.uid ? ' imsg-cn-current' : ''}${entry.disable ? ' imsg-wi-off' : ''}`);
    const head = element('span', 'imsg-wi-entry-head');
    head.append(element('b', '', entryTitle(entry)));
    if (entry.constant) {
        head.append(element('span', 'imsg-wi-pill', t('Always')));
    }
    row.append(head);
    const keys = (entry.key ?? []).join(', ');
    const preview = String(entry.content ?? '').replace(/\s+/g, ' ').trim();
    row.append(element('span', 'imsg-wi-entry-sub', [keys, preview].filter(Boolean).join(' — ') || t('No content')));
    row.addEventListener('click', () => {
        view = { ...view, uid: entry.uid, level: 2 };
        render();
    });
    row.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        toggleMenu(row, [
            { label: entry.disable ? 'Turn On' : 'Turn Off', run: () => { entry.disable = !entry.disable; saveSoon(); render(); } },
            { label: 'Duplicate', run: () => duplicateEntry(entry.uid) },
            {},
            { label: 'Delete…', danger: true, run: () => removeEntry(entry.uid) },
        ], { x: event.clientX, y: event.clientY });
    });
    return row;
}

function numberOrNull(value) {
    return value === '' || value === null ? null : Number(value);
}

function renderEditor(pane) {
    if (view.book === SETTINGS) {
        renderSettings(pane);
        return;
    }
    const entry = bookData?.entries?.[view.uid];
    if (!entry) {
        pane.replaceChildren(element('div', 'imsg-cn-empty', view.book ? t('No Entry Selected') : ''));
        return;
    }
    const changed = (key, value) => {
        entry[key] = value;
        wi.setWIOriginalDataValue?.(bookData, entry.uid, wi.originalWIDataKeyMap?.[key] ?? key, value);
        saveSoon();
        refreshRow(entry);
    };

    const bar = element('header', 'imsg-cn-pane-bar');
    const back = button('imsg-cn-back', view.book, () => {
        view = { ...view, level: 1 };
        render();
    });
    back.prepend(glyph('chevron-left'));
    const more = button('imsg-sym-button imsg-cn-add-menu');
    more.setAttribute('aria-label', t('More'));
    more.append(glyph('ellipsis-circle'));
    more.addEventListener('click', () => toggleMenu(more, [
        { label: 'Duplicate Entry', run: () => duplicateEntry(entry.uid) },
        {},
        { label: 'Delete Entry…', danger: true, run: () => removeEntry(entry.uid) },
    ]));
    bar.append(back, element('h2', 'imsg-cn-pane-title', ''), more);

    const form = element('div', 'imsg-cn-form imsg-wi-form');

    const title = input('text', entry.comment);
    title.className = 'imsg-wi-title-input';
    title.placeholder = t('Title');
    title.addEventListener('input', () => changed('comment', title.value));

    const onRow = element('label', 'imsg-wi-global imsg-wi-inline');
    const onSwitch = toggle(!entry.disable, t('Entry on'));
    onSwitch.addEventListener('change', () => {
        changed('disable', !onSwitch.checked);
        render();
    });
    onRow.append(element('span', '', t('On')), onSwitch);

    // when it's used: always, or when a keyword comes up
    const main = element('fieldset', 'imsg-cn-group');
    const mode = select([['keys', 'When a keyword comes up'], ['always', 'Always'], ['vector', 'When it’s relevant (vector search)']], entry.constant ? 'always' : entry.vectorized ? 'vector' : 'keys');
    const keys = input('text', (entry.key ?? []).join(', '));
    keys.placeholder = t('dragon, castle, /regex/i');
    const keysBox = field('Keywords', keys, 'Separated by commas. /slashes/ for a regular expression.');
    const secondary = input('text', (entry.keysecondary ?? []).join(', '));
    const logic = select(LOGIC, entry.selectiveLogic ?? 0);
    const secondaryBox = element('div', 'imsg-wi-pair');
    secondaryBox.append(field('Also needs', logic), field('Second keywords', secondary, 'Optional.'));
    const showMode = () => {
        const always = mode.value === 'always';
        keysBox.hidden = always;
        secondaryBox.hidden = always;
    };
    mode.addEventListener('change', () => {
        changed('constant', mode.value === 'always');
        changed('vectorized', mode.value === 'vector');
        showMode();
        render();
    });
    const splitKeys = (text) => text.split(',').map((x) => x.trim()).filter(Boolean);
    keys.addEventListener('input', () => changed('key', splitKeys(keys.value)));
    secondary.addEventListener('input', () => {
        changed('keysecondary', splitKeys(secondary.value));
        changed('selective', true);
    });
    logic.addEventListener('change', () => changed('selectiveLogic', Number(logic.value)));
    main.append(field('Used', mode), keysBox, secondaryBox);
    showMode();

    const content = element('textarea', 'imsg-wi-content');
    content.rows = 12;
    content.value = entry.content ?? '';
    content.placeholder = t('What the AI should know when this comes up…');
    content.addEventListener('input', () => changed('content', content.value));
    const contentBox = field('Content', content);
    const tokens = element('small', 'imsg-cn-hint imsg-wi-count');
    const countTokens = async () => {
        try {
            const count = await context().getTokenCountAsync?.(content.value);
            tokens.textContent = count === undefined ? '' : `${count} ${t('tokens')}`;
        } catch {
            tokens.textContent = '';
        }
    };
    content.addEventListener('input', () => {
        clearTimeout(countTokens.timer);
        countTokens.timer = setTimeout(countTokens, 500);
    });
    countTokens();
    contentBox.append(tokens);

    // where it goes in the prompt
    const placement = element('fieldset', 'imsg-cn-group');
    placement.append(element('legend', '', t('Placement')));
    const position = select(POSITIONS, entry.position ?? 0);
    const depth = input('number', entry.depth ?? wi.DEFAULT_DEPTH);
    depth.min = '0';
    const role = select(ROLES, entry.role ?? 0);
    const outlet = input('text', entry.outletName ?? '');
    const order = input('number', entry.order ?? 100);
    const probability = input('number', entry.probability ?? 100);
    probability.min = '0';
    probability.max = '100';
    const depthBox = element('div', 'imsg-wi-pair');
    depthBox.append(field('Depth', depth), field('Sent as', role));
    const outletBox = field('Outlet name', outlet);
    const showPosition = () => {
        depthBox.hidden = position.value !== '4';
        outletBox.hidden = position.value !== '7';
    };
    position.addEventListener('change', () => {
        changed('position', Number(position.value));
        showPosition();
    });
    depth.addEventListener('input', () => changed('depth', Number(depth.value) || 0));
    role.addEventListener('change', () => changed('role', Number(role.value)));
    outlet.addEventListener('input', () => changed('outletName', outlet.value));
    order.addEventListener('input', () => changed('order', Number(order.value) || 0));
    probability.addEventListener('input', () => {
        changed('probability', Math.min(100, Math.max(0, Number(probability.value) || 0)));
        changed('useProbability', true);
    });
    const orderBox = element('div', 'imsg-wi-pair');
    orderBox.append(field('Order', order, 'Higher goes later, closer to the end.'), field('Chance', probability, 'Percent of the times it’s triggered.'));
    placement.append(field('Where it goes', position), depthBox, outletBox, orderBox);
    showPosition();

    // the rest, folded away
    const advanced = element('details', 'imsg-cn-advanced');
    advanced.append(element('summary', '', t('Advanced')));
    const extra = element('fieldset', 'imsg-cn-group');
    const flag = (label, key, invert = false) => {
        const made = check(label, invert ? !entry[key] : entry[key]);
        made.input.addEventListener('change', () => changed(key, invert ? !made.input.checked : made.input.checked));
        return made.box;
    };
    const tri = (label, key) => {
        const node = select([['', 'Use the global setting'], ['true', 'Yes'], ['false', 'No']], entry[key] === null || entry[key] === undefined ? '' : String(entry[key]));
        node.addEventListener('change', () => changed(key, node.value === '' ? null : node.value === 'true'));
        return field(label, node);
    };
    const num = (label, key, hint) => {
        const node = input('number', entry[key] ?? '');
        node.placeholder = '—';
        node.addEventListener('input', () => changed(key, numberOrNull(node.value)));
        return field(label, node, hint);
    };
    const timing = element('div', 'imsg-wi-trio');
    timing.append(num('Sticky', 'sticky', 'Messages it stays on.'), num('Cooldown', 'cooldown', 'Messages before again.'), num('Delay', 'delay', 'Messages before first use.'));
    const scan = element('div', 'imsg-wi-trio');
    scan.append(num('Scan depth', 'scanDepth'), tri('Case-sensitive', 'caseSensitive'), tri('Whole words', 'matchWholeWords'));
    const group = input('text', entry.group ?? '');
    group.addEventListener('input', () => changed('group', group.value));
    const groupWeight = input('number', entry.groupWeight ?? wi.DEFAULT_WEIGHT);
    groupWeight.addEventListener('input', () => changed('groupWeight', Number(groupWeight.value) || 0));
    const groupBox = element('div', 'imsg-wi-pair');
    groupBox.append(field('Inclusion group', group, 'Only one entry of a group is used.'), field('Group weight', groupWeight));
    const automation = input('text', entry.automationId ?? '');
    automation.addEventListener('input', () => changed('automationId', automation.value));
    const triggers = element('div', 'imsg-wi-chips');
    for (const [key, label] of TRIGGERS) {
        const made = check(label, (entry.triggers ?? []).includes(key));
        made.input.addEventListener('change', () => {
            const next = new Set(entry.triggers ?? []);
            made.input.checked ? next.add(key) : next.delete(key);
            changed('triggers', [...next]);
        });
        triggers.append(made.box);
    }
    extra.append(
        timing,
        scan,
        groupBox,
        flag('Takes priority in its group', 'groupOverride'),
        flag('Not triggered by other entries', 'excludeRecursion'),
        flag('Doesn’t trigger other entries', 'preventRecursion'),
        flag('Ignores the token budget', 'ignoreBudget'),
        field('Only for these kinds of replies', triggers, 'None ticked: every kind.'),
        field('Automation ID', automation, 'Runs the Quick Reply with this ID when the entry is used.'),
    );
    advanced.append(extra);

    form.append(title, onRow, main, contentBox, placement, advanced);
    const scroll = pane.querySelector('.imsg-wi-form')?.scrollTop ?? 0;
    pane.replaceChildren(bar, form);
    form.scrollTop = scroll;
}

/** Updates an entry's row in the list as it's edited, without redrawing the list. */
function refreshRow(entry) {
    const root = document.getElementById(ROOT_ID);
    const row = [...(root?.querySelectorAll('.imsg-wi-entry.imsg-cn-current') ?? [])][0];
    if (!row) {
        return;
    }
    row.querySelector('.imsg-wi-entry-head b').textContent = entryTitle(entry);
    const preview = String(entry.content ?? '').replace(/\s+/g, ' ').trim();
    row.querySelector('.imsg-wi-entry-sub').textContent = [(entry.key ?? []).join(', '), preview].filter(Boolean).join(' — ') || t('No content');
    row.classList.toggle('imsg-wi-off', !!entry.disable);
}

/** The global scan settings, as controls that drive the app's own. */
function renderSettings(pane) {
    const $ = /** @type {any} */ (window).$;
    const bar = element('header', 'imsg-cn-pane-bar');
    const back = button('imsg-cn-back', 'Lorebooks', () => {
        view = { ...view, book: null, level: 0 };
        render();
    });
    back.prepend(glyph('chevron-left'));
    bar.append(back, element('h2', 'imsg-cn-pane-title', t('Scan Settings')), element('span'));
    const form = element('div', 'imsg-cn-form imsg-wi-form');
    const sliders = element('fieldset', 'imsg-cn-group');
    for (const spec of SCAN_SETTINGS) {
        const app = /** @type {HTMLInputElement} */ (document.getElementById(spec.id));
        if (!app) {
            continue;
        }
        const row = element('div', 'imsg-wi-slider');
        const range = input('range', app.value);
        range.min = String(spec.min);
        range.max = String(spec.max);
        range.step = String(spec.step ?? 1);
        const number = input('number', app.value);
        number.min = String(spec.min);
        number.max = String(Math.max(spec.max, Number(app.max) || 0));
        const set = (value) => {
            app.value = String(value);
            $(app).trigger('input').trigger('change');
        };
        range.addEventListener('input', () => {
            number.value = range.value;
            set(range.value);
        });
        number.addEventListener('change', () => {
            range.value = number.value;
            set(number.value);
        });
        row.append(range, number);
        sliders.append(field(spec.label, row, spec.hint));
    }
    const strategyApp = /** @type {HTMLSelectElement} */ (document.getElementById('world_info_character_strategy'));
    if (strategyApp) {
        const strategy = select(STRATEGIES, strategyApp.value);
        strategy.addEventListener('change', () => {
            strategyApp.value = strategy.value;
            $(strategyApp).trigger('change');
        });
        sliders.append(field('Order of books', strategy));
    }
    const flags = element('fieldset', 'imsg-cn-group');
    for (const spec of SCAN_FLAGS) {
        const app = /** @type {HTMLInputElement} */ (document.getElementById(spec.id));
        if (!app) {
            continue;
        }
        const row = element('label', 'imsg-wi-global imsg-wi-inline');
        const sw = toggle(app.checked, t(spec.label));
        sw.addEventListener('change', () => {
            app.checked = sw.checked;
            $(app).trigger('input').trigger('change');
        });
        row.append(element('span', '', t(spec.label)), sw);
        flags.append(row);
    }
    form.append(sliders, flags);
    pane.replaceChildren(bar, form);
}

function render() {
    const root = document.getElementById(ROOT_ID);
    if (!root) {
        return;
    }
    if (view.book && view.book !== SETTINGS && !wi.world_names.includes(view.book)) {
        view = { ...view, book: null, uid: null, level: 0 };
        bookData = null;
    }
    renderBooks(root.querySelector('.imsg-cn-side'));
    renderEntries(root.querySelector('.imsg-wi-list'));
    renderEditor(root.querySelector('.imsg-cn-detail'));
    root.classList.toggle('imsg-wi-settings', view.book === SETTINGS);
    root.classList.toggle('imsg-wi-level-1', view.level >= 1);
    root.classList.toggle('imsg-wi-level-2', view.level >= 2);
}

function close() {
    document.getElementById(ROOT_ID)?.remove();
    document.removeEventListener('keydown', onKey, true);
}

function onKey(event) {
    if (event.key !== 'Escape' || document.querySelector('dialog.popup[open]') || document.getElementById('imsg-menu')?.hidden === false) {
        return;
    }
    event.stopPropagation();
    if (view.level > 0 && matchMedia('(max-width: 1000px)').matches) {
        view = { ...view, level: view.level - 1 };
        render();
    } else {
        close();
    }
}

/** Opens World Info, on the given book or the first one that's on. */
export async function openWorldInfo(book = null) {
    close();
    view = { book: null, uid: null, level: 0, needle: '' };
    bookData = null;

    const root = element('div', 'imsg-cn imsg-wi');
    root.id = ROOT_ID;
    const win = element('div', 'imsg-cn-window');
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-modal', 'true');
    win.setAttribute('aria-label', t('World Info'));

    const side = element('div', 'imsg-cn-side');
    const bar = element('header', 'imsg-cn-bar');
    const add = button('imsg-sym-button imsg-cn-add-menu');
    add.setAttribute('aria-label', t('Add'));
    add.title = t('Add');
    add.append(glyph('plus'));
    add.addEventListener('click', () => toggleMenu(add, [
        { label: 'New Lorebook…', run: newBook },
        { label: 'Import…', run: () => document.getElementById('world_import_file')?.click() },
    ]));
    bar.append(button('imsg-cn-done', 'Done', close), element('h1', 'imsg-cn-title', t('World Info')), add);
    const listWrap = element('div', 'imsg-cn-listwrap');
    listWrap.append(element('div', 'imsg-cn-scroll'));
    side.append(bar, listWrap);
    const column = element('section', 'imsg-wi-list');
    const detail = element('section', 'imsg-cn-detail imsg-wi-detail');
    win.append(side, column, detail);
    root.append(win);
    root.addEventListener('mousedown', (event) => {
        if (event.target === root) {
            close();
        }
    });
    document.body.append(root);
    document.addEventListener('keydown', onKey, true);

    const start = book ?? chatBook() ?? characterBook() ?? names().find(isGlobal) ?? (matchMedia('(max-width: 1000px)').matches ? null : names()[0]);
    if (start && wi.world_names.includes(start)) {
        await openBook(start);
        if (matchMedia('(max-width: 1000px)').matches) {
            return;
        }
        const first = entries()[0];
        if (first) {
            view = { ...view, uid: first.uid };
        }
    }
    render();
}

export function initWorldInfo() {
    const { eventTypes } = context();
    const eventSource = events();
    // imports, renames and deletes made through the app redraw the list
    for (const type of [eventTypes.WORLDINFO_UPDATED, eventTypes.WORLDINFO_SETTINGS_UPDATED, eventTypes.CHAT_CHANGED]) {
        if (!type) {
            continue;
        }
        eventSource.on(type, (name) => {
            const root = document.getElementById(ROOT_ID);
            if (!root) {
                return;
            }
            // a save from this window doesn't redraw the form being typed in
            if (type === eventTypes.WORLDINFO_UPDATED && name === view.book) {
                return;
            }
            setTimeout(render, 50);
        });
    }
}

// turning the theme off closes the window, putting back what it borrowed
onStop(close);
