// The Messages sidebar: search, pinned conversations as large pictures, then every recent
// conversation (the same list as the app's welcome screen) with its last message and time.
// Pins are the app's own pinned chats, so pinning here and on the welcome screen is one list.

import { monogramizeAll } from './monograms.js';
import { buildGroupAvatar, buildSidebarToolbar, toggleMenu } from './shell.js';

const SIDEBAR_ID = 'imsg-sidebar';
/** The app's own pinned chats, kept in account storage by welcome-screen.js */
const PINNED_KEY = 'pinnedChats';

let getSettings = () => ({ recentMax: 50 });
/** @type {Array<object>} */
let entries = [];
let filterText = '';
let requestId = 0;
let refreshTimer = 0;
let onOpen = () => {};

function t(text) {
    return SillyTavern.getContext().translate(text);
}

function getPinState() {
    try {
        return JSON.parse(SillyTavern.getContext().accountStorage.getItem(PINNED_KEY) || '{}') || {};
    } catch {
        return {};
    }
}

/** The app's key for a pinned chat (welcome-screen.js) */
function pinKey({ group, avatar, fileName }) {
    return `${group ? 'group_' + group : ''}${avatar ? 'char_' + avatar : ''}_${fileName}`;
}

function togglePin(entry) {
    const state = getPinState();
    const key = pinKey(entry);
    if (Object.hasOwn(state, key)) {
        delete state[key];
    } else {
        state[key] = { group: entry.group || undefined, avatar: entry.avatar || undefined, file_name: entry.fileName };
    }
    SillyTavern.getContext().accountStorage.setItem(PINNED_KEY, JSON.stringify(state));
    refreshList();
}

/** Plain one-line preview of the last message, without markup. */
function toPreview(text) {
    const div = document.createElement('div');
    div.innerHTML = SillyTavern.libs.DOMPurify.sanitize(String(text ?? ''), { ALLOWED_TAGS: [] });
    return (div.textContent || '')
        .replace(/[*_~`#>]+/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);
}

/** A sidebar time: the clock today, Yesterday, the weekday this week, else the short date. */
function formatListTime(timestamp) {
    const { timestampToMoment } = SillyTavern.getContext();
    const time = timestampToMoment(timestamp);
    if (!time?.isValid?.()) {
        return '';
    }
    const now = timestampToMoment(Date.now());
    if (time.isSame(now, 'day')) {
        return time.format('LT');
    }
    if (time.isSame(now.clone().subtract(1, 'day'), 'day')) {
        return t('Yesterday');
    }
    if (now.diff(time, 'days') < 7) {
        return time.format('dddd');
    }
    return time.format('l');
}

function isCurrent(entry) {
    const context = SillyTavern.getContext();
    if (context.getCurrentChatId() !== entry.fileId) {
        return false;
    }
    if (entry.group) {
        return String(context.groupId) === String(entry.group);
    }
    return context.characters[context.characterId]?.avatar === entry.avatar;
}

function buildAvatar(entry) {
    const avatar = document.createElement('span');
    avatar.className = 'imsg-avatar';
    if (entry.group) {
        const group = SillyTavern.getContext().groups.find(x => x.id === entry.group);
        avatar.append(buildGroupAvatar(group ?? { name: entry.name }));
    } else {
        const img = document.createElement('img');
        img.src = entry.thumb;
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        avatar.append(img);
    }
    return avatar;
}

function buildRow(entry) {
    const row = document.createElement('div');
    row.className = 'imsg-row';
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    row.dataset.key = entry.key;
    row.title = entry.title;

    const text = document.createElement('span');
    text.className = 'imsg-row-text';
    const top = document.createElement('span');
    top.className = 'imsg-row-top';
    const name = document.createElement('span');
    name.className = 'imsg-row-name';
    name.textContent = entry.name;
    const time = document.createElement('span');
    time.className = 'imsg-row-time';
    time.textContent = entry.time;
    top.append(name, time);
    const preview = document.createElement('span');
    preview.className = 'imsg-row-preview';
    preview.textContent = entry.preview;
    text.append(top, preview);

    row.append(buildAvatar(entry), text);
    return row;
}

/** A pinned conversation: a large picture with the name under it */
function buildPin(entry) {
    const pin = document.createElement('div');
    pin.className = 'imsg-pin';
    pin.setAttribute('role', 'button');
    pin.tabIndex = 0;
    pin.dataset.key = entry.key;
    pin.title = entry.title;
    const name = document.createElement('span');
    name.className = 'imsg-pin-name';
    name.textContent = entry.name;
    pin.append(buildAvatar(entry), name);
    return pin;
}

function render() {
    const body = document.querySelector(`#${SIDEBAR_ID} .imsg-list-body`);
    if (!body) {
        return;
    }
    const needle = filterText.trim().toLowerCase();
    const visible = needle
        ? entries.filter(entry => entry.name.toLowerCase().includes(needle) || entry.preview.toLowerCase().includes(needle))
        : entries;

    const parts = [];
    // Messages drops pins into the list while searching
    const pinned = needle ? [] : visible.filter(entry => entry.pinned);
    if (pinned.length) {
        const pins = document.createElement('div');
        pins.className = 'imsg-pins';
        pins.dataset.count = String(Math.min(pinned.length, 3));
        pins.append(...pinned.map(buildPin));
        parts.push(pins);
    }
    const rows = document.createElement('div');
    rows.className = 'imsg-rows';
    rows.append(...visible.filter(entry => needle || !entry.pinned).map(buildRow));
    parts.push(rows);

    if (!visible.length) {
        const empty = document.createElement('div');
        empty.className = 'imsg-list-empty';
        empty.textContent = needle ? t('No Results') : t('No Conversations');
        parts.push(empty);
    }
    body.replaceChildren(...parts);
    markCurrent();
    monogramizeAll(body, '.imsg-avatar > img', img => entries.find(x => x.key === img.closest('[data-key]')?.dataset.key)?.name ?? '');
}

/** Moves the highlight to the open conversation without fetching the list again. */
export function markCurrent() {
    const sidebar = document.getElementById(SIDEBAR_ID);
    if (!sidebar) {
        return;
    }
    for (const item of sidebar.querySelectorAll('.imsg-row, .imsg-pin')) {
        const entry = entries.find(x => x.key === item.dataset.key);
        const current = !!entry && isCurrent(entry);
        item.classList.toggle('imsg-selected', current);
        item.toggleAttribute('aria-current', current);
    }
}

export async function refreshList() {
    const context = SillyTavern.getContext();
    const id = ++requestId;
    const pinState = getPinState();
    let data = [];
    try {
        const response = await fetch('/api/chats/recent', {
            method: 'POST',
            headers: context.getRequestHeaders(),
            body: JSON.stringify({ max: getSettings().recentMax, pinned: Object.values(pinState) }),
            cache: 'no-cache',
        });
        if (response.ok) {
            data = await response.json();
        }
    } catch (error) {
        console.warn('[iMessage] Could not load recent conversations', error);
    }
    // a newer refresh started while this one was waiting
    if (id !== requestId || !Array.isArray(data)) {
        return;
    }

    entries = data.map((chat) => {
        const character = chat.avatar ? context.characters.find(x => x.avatar === chat.avatar) : null;
        const group = chat.group ? context.groups.find(x => x.id === chat.group) : null;
        if (!character && !group) {
            return null;
        }
        const fileId = String(chat.file_name || '').replace(/\.jsonl$/, '');
        const entry = {
            key: `${chat.group ? 'g_' + chat.group : 'c_' + chat.avatar}_${fileId}`,
            name: character?.name || group?.name || '',
            title: `${character?.name || group?.name || ''}: ${fileId}`,
            avatar: chat.avatar || '',
            group: chat.group || '',
            thumb: character ? context.getThumbnailUrl('avatar', character.avatar) : '',
            fileId,
            fileName: chat.file_name,
            preview: toPreview(chat.mes),
            lastMes: Number(chat.last_mes) || 0,
            time: formatListTime(chat.last_mes),
        };
        entry.pinned = Object.hasOwn(pinState, pinKey(entry));
        return entry;
    }).filter(Boolean);
    entries.sort((a, b) => b.lastMes - a.lastMes);
    entries = onePerContact(entries);
    render();
}

/**
 * Messages lists each person or group once. Older conversations with them are in Conversation
 * History, so the list keeps the open one for a contact, otherwise the latest.
 */
function onePerContact(list) {
    const byContact = new Map();
    for (const entry of list) {
        const contact = entry.group ? `g_${entry.group}` : `c_${entry.avatar}`;
        const kept = byContact.get(contact);
        if (!kept) {
            byContact.set(contact, entry);
        } else {
            kept.pinned ||= entry.pinned;
            if (isCurrent(entry)) {
                byContact.set(contact, { ...entry, pinned: kept.pinned, lastMes: kept.lastMes });
            }
        }
    }
    return [...byContact.values()].sort((a, b) => b.lastMes - a.lastMes);
}

/** Deletes a conversation after asking, like Messages' Delete Conversation. */
async function deleteEntry(entry) {
    const context = SillyTavern.getContext();
    const confirmed = await context.callGenericPopup(
        `<h3>${t('Delete this conversation?')}</h3><p>${t('This conversation will be deleted. This can\'t be undone.')}</p>`,
        context.POPUP_TYPE.CONFIRM, '', { okButton: t('Delete'), cancelButton: t('Cancel') });
    if (!confirmed) {
        return;
    }
    try {
        if (isCurrent(entry)) {
            await context.executeSlashCommandsWithOptions('/closechat');
        }
        if (entry.group) {
            const { deleteGroupChatByName } = await import('/scripts/group-chats.js');
            await deleteGroupChatByName(entry.group, entry.fileId);
        } else {
            const { deleteCharacterChatByName } = await import('/script.js');
            const characterId = context.characters.findIndex(x => x.avatar === entry.avatar);
            await deleteCharacterChatByName(String(characterId), entry.fileId);
        }
    } catch (error) {
        console.error('[iMessage] Could not delete the conversation', error);
        toastr.error(t('Could not delete that conversation. See the console for details.'));
    }
    scheduleRefresh(200);
}

/** Refreshes after a pause, so a burst of events costs one request. */
export function scheduleRefresh(delay = 600) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshList, delay);
}

async function openEntry(entry) {
    const context = SillyTavern.getContext();
    if (isCurrent(entry)) {
        onOpen();
        return;
    }
    try {
        if (entry.group) {
            if (!context.groups.some(x => x.id === entry.group)) {
                return;
            }
            if (String(context.groupId) !== String(entry.group)) {
                // the app opens a group from a click on a .group_select card; a stand-in card
                // reaches the same handlers when the real one is on another page of the list
                const card = document.createElement('div');
                card.className = 'group_select imsg-hidden-card';
                card.setAttribute('data-grid', entry.group);
                document.body.append(card);
                card.click();
                card.remove();
                await new Promise((resolve) => {
                    context.eventSource.once(context.eventTypes.CHAT_CHANGED, resolve);
                    setTimeout(resolve, 5000);
                });
            }
            if (SillyTavern.getContext().getCurrentChatId() !== entry.fileId) {
                await context.openGroupChat(entry.group, entry.fileId);
            }
        } else {
            const characterId = context.characters.findIndex(x => x.avatar === entry.avatar);
            if (characterId === -1) {
                return;
            }
            if (String(context.characterId) !== String(characterId) || context.groupId) {
                await context.selectCharacterById(characterId);
            }
            if (SillyTavern.getContext().getCurrentChatId() !== entry.fileId) {
                await context.openCharacterChat(entry.fileId);
            }
        }
        onOpen();
    } catch (error) {
        console.error('[iMessage] Could not open the conversation', error);
        toastr.error(t('Could not open that conversation. See the console for details.'));
    }
}

function entryOf(element) {
    const item = element?.closest?.('.imsg-row, .imsg-pin');
    return item ? entries.find(x => x.key === item.dataset.key) : null;
}

function openRowMenu(anchor, entry, point) {
    toggleMenu(anchor, [
        { label: 'Open', run: () => openEntry(entry) },
        { label: entry.pinned ? 'Unpin' : 'Pin', run: () => togglePin(entry) },
        {},
        { label: 'Delete Conversation…', run: () => deleteEntry(entry), danger: true },
    ], point);
}

function createSidebar() {
    let sidebar = document.getElementById(SIDEBAR_ID);
    if (sidebar) {
        return sidebar;
    }
    sidebar = document.createElement('aside');
    sidebar.id = SIDEBAR_ID;
    sidebar.setAttribute('aria-label', t('Conversations'));

    // the iPhone's large title
    const title = document.createElement('h1');
    title.className = 'imsg-large-title';
    title.textContent = t('Messages');

    const search = document.createElement('label');
    search.className = 'imsg-search';
    const glass = document.createElement('i');
    glass.className = 'imsg-sym';
    glass.style.setProperty('--imsg-glyph', 'var(--imsg-sym-search)');
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = t('Search');
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.addEventListener('input', () => {
        filterText = input.value;
        render();
    });
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            input.value = '';
            filterText = '';
            render();
            input.blur();
        }
    });
    search.append(glass, input);

    const body = document.createElement('div');
    body.className = 'imsg-list-body';
    // set when a long press opened the menu, so lifting the finger doesn't open the chat too
    let pressed = false;
    body.addEventListener('click', (event) => {
        if (pressed) {
            pressed = false;
            event.preventDefault();
            return;
        }
        const entry = entryOf(event.target);
        if (entry) {
            openEntry(entry);
        }
    });
    body.addEventListener('contextmenu', (event) => {
        const entry = entryOf(event.target);
        if (entry) {
            event.preventDefault();
            openRowMenu(/** @type {HTMLElement} */ (event.target).closest('.imsg-row, .imsg-pin'), entry, { x: event.clientX, y: event.clientY });
        }
    });
    body.addEventListener('keydown', (event) => {
        const entry = entryOf(event.target);
        if (entry && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            openEntry(entry);
        }
    });
    // a long press on a phone opens the same menu
    let pressTimer = 0;
    body.addEventListener('touchstart', (event) => {
        const entry = entryOf(event.target);
        if (!entry) {
            return;
        }
        const touch = event.touches[0];
        pressed = false;
        pressTimer = setTimeout(() => {
            pressed = true;
            openRowMenu(/** @type {HTMLElement} */ (event.target).closest('.imsg-row, .imsg-pin'), entry, { x: touch.clientX, y: touch.clientY });
        }, 500);
    }, { passive: true });
    for (const type of ['touchend', 'touchmove', 'touchcancel']) {
        body.addEventListener(type, () => clearTimeout(pressTimer), { passive: true });
    }

    sidebar.append(buildSidebarToolbar(), title, search, body);
    document.body.append(sidebar);
    return sidebar;
}

/**
 * @param {object} options
 * @param {() => object} options.settings Returns the theme settings
 * @param {() => void} options.opened Called once a conversation from the list is open
 * @returns {Promise<void>} Resolves once the list has its first conversations.
 */
export function initList({ settings, opened }) {
    getSettings = settings;
    onOpen = opened;
    createSidebar();

    const { eventSource, eventTypes } = SillyTavern.getContext();
    eventSource.on(eventTypes.CHAT_CHANGED, () => {
        markCurrent();
        scheduleRefresh(300);
    });
    for (const type of [eventTypes.MESSAGE_SENT, eventTypes.MESSAGE_RECEIVED, eventTypes.MESSAGE_DELETED, eventTypes.MESSAGE_EDITED,
        eventTypes.CHAT_DELETED, eventTypes.GROUP_CHAT_DELETED, eventTypes.CHAT_CREATED, eventTypes.GROUP_CHAT_CREATED,
        eventTypes.CHAT_RENAMED, eventTypes.CHARACTER_DELETED, eventTypes.CHARACTER_RENAMED, eventTypes.GROUP_UPDATED]) {
        if (type) {
            eventSource.on(type, () => scheduleRefresh());
        }
    }
    return refreshList();
}
