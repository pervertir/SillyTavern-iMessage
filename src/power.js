// Theme on/off lifecycle. While off, nothing of the theme is in the page: handlers are gated with
// whenOn/events(), page parts are built in onStart callbacks, and stopTheme() removes every
// element, class and data attribute the theme added.

const starters = [];
const stoppers = [];

/** Whether the theme is on. */
export function isOn() {
    return document.body.classList.contains('imessage');
}

/** A handler that does nothing while the theme is off. */
export function whenOn(handler) {
    return function (...args) {
        if (isOn()) {
            return handler.apply(this, args);
        }
    };
}

/** The app's events, with every handler gated on the theme being on. */
export function events() {
    const { eventSource } = SillyTavern.getContext();
    return {
        on: (type, handler) => eventSource.on(type, whenOn(handler)),
        // a one-off wait belongs to something the theme is doing now, so it isn't gated
        once: (type, handler) => eventSource.once(type, handler),
    };
}

/** Runs when the theme turns on (and now, if it's on): builds a part of it into the page. */
export function onStart(start) {
    starters.push(start);
    if (isOn()) {
        start();
    }
}

/** Runs when the theme turns off: closes a window of it, putting back what it borrowed. */
export function onStop(stop) {
    stoppers.push(stop);
}

export function startTheme() {
    for (const start of starters) {
        try {
            start();
        } catch (error) {
            console.error('[iMessage] Could not start', error);
        }
    }
}

/** Everything of ours outside the settings panel, which stays so the theme can be turned on again */
function ours(node) {
    return !node.closest('.imsg-settings');
}

export function stopTheme() {
    for (const stop of stoppers) {
        try {
            stop();
        } catch (error) {
            console.error('[iMessage] Could not stop', error);
        }
    }
    // the parts built into the page
    for (const node of document.querySelectorAll('[id^="imsg-"], .imsg-panel-head, .imsg-stamp, .imsg-mono-mark, .imsg-cluster, .imsg-cn')) {
        if (ours(node) && node.isConnected) {
            node.remove();
        }
    }
    // its marks on the app's own elements
    for (const node of document.querySelectorAll('[class*="imsg-"], [data-imsg-title]')) {
        if (!ours(node)) {
            continue;
        }
        if (node.dataset.imsgTitle !== undefined) {
            node.setAttribute('title', node.dataset.imsgTitle);
        }
        for (const name of [...node.classList].filter((x) => x.startsWith('imsg-'))) {
            node.classList.remove(name);
        }
        if (!node.classList.length) {
            node.removeAttribute('class');
        }
    }
    for (const node of document.querySelectorAll('*')) {
        if (!ours(node)) {
            continue;
        }
        for (const attribute of [...node.attributes].filter((x) => x.name.startsWith('data-imsg'))) {
            node.removeAttribute(attribute.name);
        }
    }
    document.documentElement.classList.remove(...[...document.documentElement.classList].filter((x) => x.startsWith('imsg-')));
    document.body.style.removeProperty('--imsg-wall-blur');
    document.body.style.removeProperty('--imsg-wall-dim');
    // the open conversation is drawn again by the app, without the theme's bubbles
    const context = SillyTavern.getContext();
    if (context.getCurrentChatId?.()) {
        context.reloadCurrentChat?.();
    }
}
