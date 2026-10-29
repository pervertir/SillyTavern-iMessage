// Small helpers shared by the theme's modules.

/** Below this width the theme uses its phone layout (keep in step with css/mobile.css). */
export const PHONE_QUERY = '(max-width: 1000px)';

export function context() {
    return SillyTavern.getContext();
}

export function t(text) {
    return context().translate(text);
}

export function isPhone() {
    return window.matchMedia(PHONE_QUERY).matches;
}

export function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text !== undefined) {
        node.textContent = text;
    }
    return node;
}

/** A button with a translated label. */
export function button(className, label, run) {
    const node = element('button', className, label === undefined ? undefined : t(label));
    node.type = 'button';
    if (run) {
        node.addEventListener('click', run);
    }
    return node;
}

/** One of the SF-style symbols defined in css/tokens.css (--imsg-sym-<name>). */
export function glyph(symbol) {
    const node = element('i', 'imsg-sym');
    node.style.setProperty('--imsg-glyph', `var(--imsg-sym-${symbol})`);
    return node;
}

export function escapeHtml(text) {
    const node = element('span');
    node.textContent = text;
    return node.innerHTML;
}

/** Whether a popup or the theme's menu is open, so Esc belongs to it rather than a window. */
export function overlayOpen() {
    return !!document.querySelector('dialog.popup[open]') || document.getElementById('imsg-menu')?.hidden === false;
}

/** Whether a scroller is within `distance` pixels of its bottom. */
export function nearBottom(scroller, distance) {
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < distance;
}

/** Whether an event started inside an element matching `selector`. */
export function within(event, selector) {
    return Boolean(/** @type {Element} */ (event.target).closest?.(selector));
}
