// Messages' conversation rhythm on top of the app's own messages: runs of bubbles from the same
// sender sit close together with the tail on the last one, a centered time line starts each
// stretch of conversation, "Delivered" or "Read" sits under your last message, and a typing
// bubble shows while a reply is being written. Everything here is classes and data attributes on
// the existing .mes elements; CSS draws them. Long replies split into short bubbles in split.js.

import { splitAll } from './split.js';

/** A new time line once this much time has passed between two messages */
const STAMP_GAP_MS = 60 * 60 * 1000;
const TYPING_ID = 'imsg-typing';
/** Never leave the typing bubble up if a generation ends without an event */
const TYPING_TIMEOUT_MS = 5 * 60 * 1000;

let frame = 0;
let typingTimer = 0;

function t(text) {
    return SillyTavern.getContext().translate(text);
}

function toMoment(value) {
    const { timestampToMoment } = SillyTavern.getContext();
    const time = value ? timestampToMoment(value) : null;
    return time?.isValid?.() ? time : null;
}

/** The time line Messages puts above a stretch of conversation. */
export function formatStamp(time) {
    const now = toMoment(Date.now());
    if (time.isSame(now, 'day')) {
        return `${t('Today')} ${time.format('LT')}`;
    }
    if (time.isSame(now.clone().subtract(1, 'day'), 'day')) {
        return `${t('Yesterday')} ${time.format('LT')}`;
    }
    if (now.diff(time, 'days') < 7) {
        return time.format('dddd LT');
    }
    if (time.isSame(now, 'year')) {
        return time.format('ddd, MMM D [at] LT');
    }
    return time.format('ll [at] LT');
}

/** Who a message is from, for telling runs apart: you, a named character, or a system note. */
function senderOf(mes, message) {
    if (mes.classList.contains('smallSysMes') || message?.is_system) {
        return 'system';
    }
    return mes.getAttribute('is_user') === 'true' ? 'you' : `them:${mes.getAttribute('ch_name') ?? ''}`;
}

/** Re-marks every message in the open chat. */
function markAll() {
    frame = 0;
    const chatElement = document.getElementById('chat');
    if (!chatElement) {
        return;
    }
    const { chat } = SillyTavern.getContext();
    const rows = [...chatElement.querySelectorAll(':scope > .mes[mesid]')].map((mes) => {
        const message = chat[Number(mes.getAttribute('mesid'))];
        return { mes, message, sender: senderOf(mes, message), time: toMoment(message?.send_date) };
    });

    let previous = null;
    for (const row of rows) {
        const gap = !previous || !row.time || !previous.time || row.time.diff(previous.time) > STAMP_GAP_MS;
        if (gap && row.time) {
            row.mes.dataset.imsgStamp = formatStamp(row.time);
        } else {
            delete row.mes.dataset.imsgStamp;
        }
        row.first = !previous || previous.sender !== row.sender || !!row.mes.dataset.imsgStamp;
        if (previous) {
            previous.last = row.first;
        }
        previous = row;
    }
    if (previous) {
        previous.last = true;
    }

    for (const row of rows) {
        markPending(row.mes, row.message);
    }

    let lastYours = null;
    for (const row of rows) {
        row.mes.classList.toggle('imsg-first', !!row.first);
        row.mes.classList.toggle('imsg-last', !!row.last);
        row.mes.classList.toggle('imsg-sys', row.sender === 'system');
        if (row.sender === 'you') {
            lastYours = row;
        }
        delete row.mes.dataset.imsgReceipt;
    }
    if (lastYours) {
        const answered = rows.indexOf(lastYours) < rows.length - 1;
        lastYours.mes.dataset.imsgReceipt = answered ? t('Read') : t('Delivered');
    }
    splitAll(rows.map((row) => row.mes));
}

/** A reply that's started but has no words yet ("..." while streaming starts) shows as typing dots. */
function markPending(mes, message) {
    const text = typeof message?.mes === 'string' ? message.mes.trim() : '';
    const pending = !!message && !message.is_user && !message.is_system && mes.classList.contains('last_mes')
        && document.body.classList.contains('imsg-generating') && (text === '' || text === '...' || text === '…');
    mes.classList.toggle('imsg-pending', pending);
    let dots = mes.querySelector(':scope .mes_block > .imsg-dots');
    if (pending && !dots) {
        dots = document.createElement('div');
        dots.className = 'imsg-dots';
        dots.setAttribute('aria-label', t('Typing'));
        dots.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));
        mes.querySelector('.mes_block > .mes_text')?.after(dots);
    }
}

/** Re-marks the chat on the next frame, so a burst of events costs one pass. */
export function refreshMessages() {
    if (!frame) {
        frame = requestAnimationFrame(markAll);
    }
}

function getTyping() {
    let typing = document.getElementById(TYPING_ID);
    if (!typing) {
        typing = document.createElement('div');
        typing.id = TYPING_ID;
        typing.setAttribute('aria-label', t('Typing'));
        typing.setAttribute('role', 'status');
        for (let i = 0; i < 3; i++) {
            typing.append(document.createElement('span'));
        }
    }
    return typing;
}

function showTyping() {
    const chatElement = document.getElementById('chat');
    if (!chatElement) {
        return;
    }
    const typing = getTyping();
    chatElement.append(typing);
    typing.hidden = false;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(hideTyping, TYPING_TIMEOUT_MS);
    // keep it in view like a new message
    if (chatElement.scrollHeight - chatElement.scrollTop - chatElement.clientHeight < 160) {
        chatElement.scrollTop = chatElement.scrollHeight;
    }
}

function hideTyping() {
    clearTimeout(typingTimer);
    const typing = document.getElementById(TYPING_ID);
    if (typing) {
        typing.hidden = true;
    }
}

export function initMessages() {
    const { eventSource, eventTypes } = SillyTavern.getContext();
    for (const type of [
        eventTypes.CHARACTER_MESSAGE_RENDERED, eventTypes.USER_MESSAGE_RENDERED, eventTypes.MESSAGE_SWIPED,
        eventTypes.MESSAGE_UPDATED, eventTypes.MESSAGE_EDITED, eventTypes.MESSAGE_DELETED, eventTypes.CHAT_CHANGED,
        eventTypes.MORE_MESSAGES_LOADED, eventTypes.GROUP_UPDATED, eventTypes.GENERATION_ENDED,
        eventTypes.GENERATION_STOPPED,
    ]) {
        eventSource.on(type, refreshMessages);
    }

    eventSource.on(eventTypes.GENERATION_STARTED, (type, _options, dryRun) => {
        if (dryRun || type === 'quiet' || type === 'impersonate') {
            return;
        }
        document.body.classList.add('imsg-generating');
        showTyping();
    });
    for (const type of [eventTypes.CHARACTER_MESSAGE_RENDERED, eventTypes.STREAM_TOKEN_RECEIVED]) {
        eventSource.on(type, hideTyping);
    }
    // a streamed reply's first bubble arrives without an event of its own; its words, as tokens
    eventSource.on(eventTypes.STREAM_TOKEN_RECEIVED, refreshMessages);
    const chatElement = document.getElementById('chat');
    if (chatElement) {
        new MutationObserver(refreshMessages).observe(chatElement, { childList: true });
    }
    for (const type of [eventTypes.GENERATION_ENDED, eventTypes.GENERATION_STOPPED, eventTypes.CHAT_CHANGED]) {
        eventSource.on(type, () => {
            document.body.classList.remove('imsg-generating');
            hideTyping();
            refreshMessages();
        });
    }
    refreshMessages();
}
