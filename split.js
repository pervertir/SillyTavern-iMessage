// Short messages: a long reply shows as several bubbles, split at the ends of sentences
// (message-splitter.js). The chat keeps it as one message, so edit, swipes, regenerate and the
// prompt are unchanged; only the display is split. A new reply that wasn't streamed comes in
// bubble by bubble, with the typing dots between.

import { splitMessage } from './message-splitter.js';

const BOX_CLASS = 'imsg-parts';
const PART_CLASS = 'imsg-part';
const TYPING_CLASS = 'imsg-part-typing';
/** How long the dots show before the next bubble: a base plus a little per character */
const REVEAL_BASE_MS = 450;
const REVEAL_PER_CHAR_MS = 30;
const REVEAL_MAX_MS = 2200;

/** Splitting state of each message element: the text it was split from, and a running reveal */
const state = new WeakMap();
/** Replies that just arrived whole, to bring in bubble by bubble */
const pendingReveal = new Set();
let streaming = false;
let generating = false;
let streamedThisTurn = false;

function isOn() {
    const body = document.body.classList;
    return body.contains('imessage') && body.contains('imsg-split-on');
}

function partsOf(text) {
    try {
        const parts = splitMessage(text);
        return Array.isArray(parts) ? parts.filter((part) => typeof part === 'string' && part.trim()) : [text];
    } catch (error) {
        console.warn('[iMessage] Could not split a message', error);
        return [text];
    }
}

function stopReveal(mes) {
    const entry = state.get(mes);
    if (entry?.timer) {
        clearTimeout(entry.timer);
        entry.timer = 0;
    }
    mes.classList.remove('imsg-revealing');
    mes.querySelector(`.${BOX_CLASS} > .${TYPING_CLASS}`)?.remove();
}

/** Puts the tail on the last bubble that's showing. */
function markTail(box) {
    const shown = [...box.children].filter((child) => !child.hidden);
    box.querySelectorAll(`:scope > .imsg-tail`).forEach((child) => child.classList.remove('imsg-tail'));
    shown.at(-1)?.classList.add('imsg-tail');
}

function unsplit(mes) {
    stopReveal(mes);
    mes.classList.remove('imsg-split');
    mes.querySelector(`.mes_block > .${BOX_CLASS}`)?.remove();
    state.delete(mes);
}

/** Shows one message as several bubbles, or as one when it's short or splitting is off. */
function renderSplit(mes) {
    const { chat, messageFormatting } = SillyTavern.getContext();
    const id = Number(mes.getAttribute('mesid'));
    const message = chat[id];
    const text = message?.mes;
    const splittable = isOn() && typeof text === 'string' && !message.is_user && !message.is_system
        && !mes.classList.contains('smallSysMes') && !(streaming && mes.classList.contains('last_mes'));
    if (!splittable) {
        if (state.has(mes)) {
            unsplit(mes);
        }
        return;
    }

    const key = `${message.swipe_id ?? 0}\u0000${text}`;
    if (state.get(mes)?.key === key) {
        return;
    }
    stopReveal(mes);

    const parts = partsOf(text);
    const textElement = mes.querySelector('.mes_block > .mes_text');
    if (parts.length < 2 || !textElement) {
        mes.classList.remove('imsg-split');
        mes.querySelector(`.mes_block > .${BOX_CLASS}`)?.remove();
        state.set(mes, { key, timer: 0 });
        return;
    }

    let box = mes.querySelector(`.mes_block > .${BOX_CLASS}`);
    if (!box) {
        box = document.createElement('div');
        box.className = BOX_CLASS;
        textElement.after(box);
    }
    box.replaceChildren(...parts.map((part) => {
        const bubble = document.createElement('div');
        bubble.className = PART_CLASS;
        bubble.innerHTML = messageFormatting(part, message.name, message.is_system, message.is_user, id);
        return bubble;
    }));
    markTail(box);
    mes.classList.add('imsg-split');
    state.set(mes, { key, timer: 0 });
}

function nearBottom(chatElement) {
    return chatElement.scrollHeight - chatElement.scrollTop - chatElement.clientHeight < 200;
}

/** Brings a just-arrived reply in one bubble at a time. */
function reveal(mes) {
    const entry = state.get(mes);
    const box = mes.querySelector(`.mes_block > .${BOX_CLASS}`);
    const parts = box ? [...box.querySelectorAll(`:scope > .${PART_CLASS}`)] : [];
    if (!entry || parts.length < 2) {
        return;
    }
    const chatElement = document.getElementById('chat');
    const follow = !chatElement || nearBottom(chatElement);
    parts.slice(1).forEach((part) => { part.hidden = true; });
    const typing = document.createElement('div');
    typing.className = `${PART_CLASS} ${TYPING_CLASS}`;
    typing.setAttribute('aria-hidden', 'true');
    typing.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));
    mes.classList.add('imsg-revealing');

    let index = 1;
    const scroll = () => {
        if (follow && chatElement) {
            chatElement.scrollTop = chatElement.scrollHeight;
        }
    };
    const step = () => {
        const next = parts[index];
        if (!next || !mes.isConnected) {
            stopReveal(mes);
            markTail(box);
            return;
        }
        box.append(typing);
        markTail(box);
        scroll();
        const wait = Math.min(REVEAL_MAX_MS, REVEAL_BASE_MS + next.textContent.length * REVEAL_PER_CHAR_MS);
        entry.timer = setTimeout(() => {
            typing.remove();
            next.hidden = false;
            index++;
            markTail(box);
            scroll();
            entry.timer = setTimeout(step, 250);
        }, wait);
    };
    markTail(box);
    step();
}

/** Splits (or rejoins) every message in the open chat; called from the messages pass. */
export function splitAll(rows) {
    for (const mes of rows) {
        renderSplit(mes);
        const id = Number(mes.getAttribute('mesid'));
        if (pendingReveal.has(id)) {
            pendingReveal.delete(id);
            if (mes.classList.contains('imsg-split')) {
                reveal(mes);
            }
        }
    }
}

/** Forgets every split, so the next pass redraws them (after the setting changes). */
export function resetSplits() {
    document.querySelectorAll('#chat > .mes').forEach((mes) => {
        if (state.has(mes)) {
            unsplit(mes);
        }
    });
}

export function initSplit() {
    const { eventSource, eventTypes } = SillyTavern.getContext();
    eventSource.on(eventTypes.GENERATION_STARTED, (_type, _options, dryRun) => {
        if (!dryRun) {
            generating = true;
            streamedThisTurn = false;
        }
    });
    eventSource.on(eventTypes.STREAM_TOKEN_RECEIVED, () => {
        streaming = true;
        streamedThisTurn = true;
    });
    eventSource.on(eventTypes.CHARACTER_MESSAGE_RENDERED, (messageId) => {
        streaming = false;
        if (generating && !streamedThisTurn && isOn() && !document.body.classList.contains('imsg-c-noReveal')) {
            pendingReveal.add(Number(messageId));
        }
    });
    for (const type of [eventTypes.GENERATION_ENDED, eventTypes.GENERATION_STOPPED]) {
        eventSource.on(type, () => {
            streaming = false;
            generating = false;
        });
    }
    eventSource.on(eventTypes.CHAT_CHANGED, () => {
        streaming = false;
        generating = false;
        pendingReveal.clear();
    });
}
