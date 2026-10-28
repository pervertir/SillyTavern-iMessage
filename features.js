// The small things a modern messaging app does around the bubbles: tapbacks (double-click or
// long-press a bubble to react), an "Edited" label, the time in the hover bar, a button to jump
// back to the latest message, and quiet tooltips in place of the browser's.

const TAPBACKS = ['❤️', '👍', '👎', '😂', '‼️', '❓'];
const PICKER_ID = 'imsg-tapback-picker';
const JUMP_ID = 'imsg-jump';
const TOOLTIP_ID = 'imsg-tooltip';
const TOOLTIP_DELAY_MS = 600;
/** How far from the bottom, in pixels, before the jump button shows */
const JUMP_DISTANCE = 400;

function context() {
    return SillyTavern.getContext();
}

function t(text) {
    return context().translate(text);
}

function isOn() {
    return document.body.classList.contains('imessage');
}

/** Adds a tapback, swaps it for another, or takes it off when it's picked again. */
async function setTapback(messageId, emoji) {
    const { chat, saveChat } = context();
    const message = chat[messageId];
    if (!message) {
        return;
    }
    message.extra ??= {};
    if (message.extra.imsg_tapback === emoji) {
        delete message.extra.imsg_tapback;
    } else {
        message.extra.imsg_tapback = emoji;
    }
    const mes = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
    if (mes) {
        decorate(mes, message);
    }
    await saveChat();
}

function closePicker() {
    document.getElementById(PICKER_ID)?.remove();
}

function openPicker(mes) {
    closePicker();
    const messageId = Number(mes.getAttribute('mesid'));
    const message = context().chat[messageId];
    const block = mes.querySelector('.mes_block');
    if (!message || !block) {
        return;
    }
    const picker = document.createElement('div');
    picker.id = PICKER_ID;
    picker.setAttribute('role', 'menu');
    for (const emoji of TAPBACKS) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = emoji;
        button.setAttribute('role', 'menuitemradio');
        button.setAttribute('aria-checked', String(message.extra?.imsg_tapback === emoji));
        button.addEventListener('click', () => {
            closePicker();
            setTapback(messageId, emoji);
        });
        picker.append(button);
    }
    document.body.append(picker);
    const box = block.getBoundingClientRect();
    const width = picker.offsetWidth;
    const mine = mes.getAttribute('is_user') === 'true';
    const left = mine ? box.right - width : box.left;
    picker.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, left))}px`;
    picker.style.top = `${Math.max(8, box.top - picker.offsetHeight - 8)}px`;
    picker.querySelector('button')?.focus({ preventScroll: true });
}

/** Draws a message's tapback, "Edited" label and hover-bar time. Called from the messages pass. */
export function decorate(mes, message) {
    const block = mes.querySelector(':scope > .mes_block');
    if (!block) {
        return;
    }
    const emoji = message?.extra?.imsg_tapback;
    // the badge sits on the first bubble: the first short message of a split reply, else the bubble
    const host = block.querySelector(':scope > .imsg-parts > .imsg-part') ?? block;
    let badge = block.querySelector('.imsg-tapback');
    if (badge && badge.parentElement !== host) {
        badge.remove();
        badge = null;
    }
    if (emoji && !badge) {
        badge = document.createElement('button');
        badge.type = 'button';
        badge.className = 'imsg-tapback';
        badge.title = t('Change Tapback');
        badge.addEventListener('click', (event) => {
            event.stopPropagation();
            openPicker(mes);
        });
        host.append(badge);
    }
    if (badge) {
        if (emoji) {
            badge.textContent = emoji;
        } else {
            badge.remove();
        }
    }
    mes.classList.toggle('imsg-reacted', !!emoji);

    if (message?.extra?.imsg_edited) {
        mes.dataset.imsgEdited = t('Edited');
    } else {
        delete mes.dataset.imsgEdited;
    }

    const bar = mes.querySelector('.mes_buttons');
    if (bar) {
        let time = bar.querySelector(':scope > .imsg-bar-time');
        const date = message?.send_date ? context().timestampToMoment(message.send_date) : null;
        const label = date?.isValid() ? date.format('LT') : '';
        if (label && !time) {
            time = document.createElement('span');
            time.className = 'imsg-bar-time';
            bar.prepend(time);
        }
        if (time) {
            time.textContent = label;
        }
    }
}

function nearBottom(chatElement) {
    return chatElement.scrollHeight - chatElement.scrollTop - chatElement.clientHeight < JUMP_DISTANCE;
}

function initJump() {
    const chatElement = document.getElementById('chat');
    const sheld = document.getElementById('sheld');
    if (!chatElement || !sheld) {
        return;
    }
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.id = JUMP_ID;
    jump.hidden = true;
    jump.title = t('Jump to Latest');
    jump.setAttribute('aria-label', t('Jump to Latest'));
    const glyph = document.createElement('i');
    glyph.className = 'imsg-sym';
    glyph.style.setProperty('--imsg-glyph', 'var(--imsg-sym-chevron-left)');
    jump.append(glyph);
    jump.addEventListener('click', () => {
        chatElement.scrollTo({ top: chatElement.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
    sheld.append(jump);

    const update = () => {
        const away = !nearBottom(chatElement);
        jump.hidden = !away;
        if (!away) {
            jump.classList.remove('imsg-jump-new');
        }
    };
    chatElement.addEventListener('scroll', update, { passive: true });
    const { eventSource, eventTypes } = context();
    eventSource.on(eventTypes.MESSAGE_RECEIVED, () => {
        if (!nearBottom(chatElement)) {
            jump.classList.add('imsg-jump-new');
        }
    });
    eventSource.on(eventTypes.CHAT_CHANGED, () => {
        jump.classList.remove('imsg-jump-new');
        setTimeout(update, 300);
    });
}

/** Tooltips: the theme's own small label after a short pause, instead of the browser's yellow box. */
function initTooltips() {
    let timer = 0;
    let target = null;
    const tip = document.createElement('div');
    tip.id = TOOLTIP_ID;
    tip.hidden = true;
    tip.setAttribute('role', 'tooltip');
    document.body.append(tip);

    const hide = () => {
        clearTimeout(timer);
        tip.hidden = true;
        if (target?.dataset.imsgTitle !== undefined) {
            target.setAttribute('title', target.dataset.imsgTitle);
            delete target.dataset.imsgTitle;
        }
        target = null;
    };
    document.addEventListener('pointerover', (event) => {
        if (!isOn() || event.pointerType === 'touch') {
            return;
        }
        const element = /** @type {HTMLElement} */ (event.target).closest?.('[title]');
        if (!element || element === target || !element.getAttribute('title')?.trim() || element.matches('input, textarea, select, option, iframe')) {
            return;
        }
        hide();
        target = element;
        // the browser's own tooltip stays away while the title is parked
        element.dataset.imsgTitle = element.getAttribute('title');
        element.removeAttribute('title');
        timer = setTimeout(() => {
            if (!target?.isConnected) {
                return;
            }
            tip.textContent = target.dataset.imsgTitle;
            tip.hidden = false;
            const box = target.getBoundingClientRect();
            const width = tip.offsetWidth;
            const height = tip.offsetHeight;
            const below = box.bottom + 6 + height < window.innerHeight;
            tip.style.left = `${Math.max(6, Math.min(window.innerWidth - width - 6, box.left + box.width / 2 - width / 2))}px`;
            tip.style.top = `${below ? box.bottom + 6 : box.top - height - 6}px`;
        }, TOOLTIP_DELAY_MS);
    });
    document.addEventListener('pointerout', (event) => {
        if (target && !target.contains(/** @type {Node} */ (event.relatedTarget))) {
            hide();
        }
    });
    for (const type of ['pointerdown', 'keydown', 'scroll']) {
        document.addEventListener(type, hide, { capture: true, passive: true });
    }
}

export function initFeatures() {
    const chatElement = document.getElementById('chat');
    const { eventSource, eventTypes } = context();

    if (chatElement) {
        chatElement.addEventListener('dblclick', (event) => {
            const target = /** @type {HTMLElement} */ (event.target);
            const mes = target.closest('.mes');
            if (!isOn() || !mes || mes.classList.contains('imsg-sys') || mes.querySelector('.edit_textarea')
                || !target.closest('.mes_block') || target.closest('a, button, .mes_buttons, .mes_reasoning_details, .imsg-tapback')) {
                return;
            }
            event.preventDefault();
            window.getSelection()?.removeAllRanges();
            openPicker(mes);
        });
        // a long press on a phone opens the same picker
        let pressTimer = 0;
        chatElement.addEventListener('touchstart', (event) => {
            const target = /** @type {HTMLElement} */ (event.target);
            const mes = target.closest('.mes');
            if (!isOn() || !mes || !target.closest('.mes_block') || mes.querySelector('.edit_textarea') || target.closest('a, button')) {
                return;
            }
            pressTimer = setTimeout(() => openPicker(mes), 550);
        }, { passive: true });
        for (const type of ['touchend', 'touchmove', 'touchcancel']) {
            chatElement.addEventListener(type, () => clearTimeout(pressTimer), { passive: true });
        }
    }
    document.addEventListener('pointerdown', (event) => {
        if (!/** @type {HTMLElement} */ (event.target).closest?.(`#${PICKER_ID}`)) {
            closePicker();
        }
    }, { capture: true });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closePicker();
        }
    });
    eventSource.on(eventTypes.CHAT_CHANGED, closePicker);

    // a changed message keeps a note that it was edited
    eventSource.on(eventTypes.MESSAGE_EDITED, async (messageId) => {
        const message = context().chat[Number(messageId)];
        if (!message || message.is_system) {
            return;
        }
        message.extra ??= {};
        message.extra.imsg_edited = true;
        await context().saveChat();
    });

    initJump();
    initTooltips();
}
