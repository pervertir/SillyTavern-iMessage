// Messages' conversation rhythm on top of the app's own messages: runs of bubbles from the same
// sender sit close together with the tail on the last one, a centered time line starts each
// stretch of conversation, "Delivered" or "Read" sits under your last message, and a typing
// bubble shows while a reply is being written. Everything here is classes and data attributes on
// the existing .mes elements; CSS draws them. Long replies split into short bubbles in split.js.

import { splitAll } from './split.js';
import { decorate } from './features.js';

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

/** The time line Messages puts above a stretch of conversation: a bold day, then the time. */
export function formatStamp(time) {
    const now = toMoment(Date.now());
    if (time.isSame(now, 'day')) {
        return { day: t('Today'), time: time.format('LT') };
    }
    if (time.isSame(now.clone().subtract(1, 'day'), 'day')) {
        return { day: t('Yesterday'), time: time.format('LT') };
    }
    if (now.diff(time, 'days') < 7) {
        return { day: time.format('dddd'), time: time.format('LT') };
    }
    if (time.isSame(now, 'year')) {
        return { day: time.format('ddd, MMM D'), time: time.format('[at] LT') };
    }
    return { day: time.format('ll'), time: time.format('[at] LT') };
}

/** Puts the time line at the top of a message, or takes it away. */
function setStamp(mes, stamp) {
    let line = mes.querySelector(':scope > .imsg-stamp');
    if (!stamp) {
        line?.remove();
        delete mes.dataset.imsgStamp;
        return;
    }
    const text = `${stamp.day} ${stamp.time}`;
    mes.dataset.imsgStamp = text;
    if (line?.dataset.text === text) {
        return;
    }
    if (!line) {
        line = document.createElement('div');
        line.className = 'imsg-stamp';
        mes.prepend(line);
    }
    line.dataset.text = text;
    const day = document.createElement('b');
    day.textContent = stamp.day;
    line.replaceChildren(day, ` ${stamp.time}`);
}

/** Only emoji, three at most: Messages shows them big, without a bubble. */
function isJumboEmoji(text) {
    if (typeof text !== 'string' || text.length > 40) {
        return false;
    }
    const compact = text.replace(/\s+/g, '');
    const count = (compact.match(/\p{Extended_Pictographic}|\p{Regional_Indicator}{2}/gu) || []).length;
    const rest = compact.replace(/\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u200d\ufe0f\u{1F3FB}-\u{1F3FF}]/gu, '');
    return count > 0 && count <= 3 && rest === '';
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
        setStamp(row.mes, gap && row.time ? formatStamp(row.time) : null);
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
        row.mes.classList.toggle('imsg-versions', (row.message?.swipes?.length ?? 0) > 1);
        row.mes.classList.toggle('imsg-jumbo', isJumboEmoji(row.message?.mes));
        row.mes.classList.toggle('imsg-media', !!row.mes.querySelector('.mes_media_wrapper > *'));
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
    // after the split, so a tapback lands on the first short bubble
    for (const row of rows) {
        decorate(row.mes, row.message);
    }
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

    // a new bubble slides up into place; not the ones drawn when a conversation opens
    let openedAt = 0;
    eventSource.on(eventTypes.CHAT_CHANGED, () => { openedAt = Date.now(); });
    for (const type of [eventTypes.CHARACTER_MESSAGE_RENDERED, eventTypes.USER_MESSAGE_RENDERED]) {
        eventSource.on(type, (messageId) => {
            const mes = document.querySelector(`#chat .mes[mesid="${Number(messageId)}"]`);
            if (!mes?.classList.contains('last_mes') || Date.now() - openedAt < 1500) {
                return;
            }
            mes.classList.add('imsg-new');
            setTimeout(() => mes.classList.remove('imsg-new'), 600);
        });
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
        // a click on a picture opens it large, like its zoom button
        chatElement.addEventListener('click', (event) => {
            const target = /** @type {HTMLElement} */ (event.target);
            if (document.body.classList.contains('imessage') && target.matches?.('.mes_media_container :is(img, video)')) {
                target.closest('.mes_media_container')?.querySelector('.mes_media_enlarge')?.click();
            }
        });
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
