// Keeps the app's own name out of sight while the theme is on: the tab reads "Messages" with
// a green speech-bubble icon, and the message box says "iMessage".
// Turning the theme off puts the originals back.

const TITLE = 'Messages';
/** A green rounded square with a white speech bubble, drawn here rather than copied from Apple */
const ICON = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
    + '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5BF675"/><stop offset="1" stop-color="#0CBD2A"/></linearGradient></defs>'
    + '<rect width="64" height="64" rx="14" fill="url(#g)"/>'
    + '<path d="M32 13c-11.6 0-21 7.6-21 17 0 5.4 3.1 10.2 7.9 13.3-.4 2.8-1.8 5.4-4 7.4 4.1.3 8-1 10.9-3.3 2 .5 4 .7 6.2.7 11.6 0 21-7.6 21-17S43.6 13 32 13z" fill="#fff"/>'
    + '</svg>');
const PLACEHOLDER = 'iMessage';
const PLACEHOLDER_ATTRS = ['placeholder', 'connected_text', 'no_connection_text'];

let original = null;
let active = false;

function getIconLinks() {
    return [...document.querySelectorAll('link[rel~="icon"]')];
}

function remember() {
    if (original) {
        return;
    }
    const textarea = document.getElementById('send_textarea');
    original = {
        title: document.title,
        icons: getIconLinks().map(link => [link, link.getAttribute('href'), link.getAttribute('type')]),
        placeholder: Object.fromEntries(PLACEHOLDER_ATTRS.map(name => [name, textarea?.getAttribute(name)])),
    };
}

/** Messages' window title: the app's name, as Safari shows it for a web app. */
export function refreshTitle() {
    if (active) {
        document.title = TITLE;
    }
}

export function setDisguise(enabled) {
    const textarea = document.getElementById('send_textarea');
    // the app icon, for notification banners
    document.documentElement.style.setProperty('--imsg-app-icon', `url("${ICON}")`);
    if (enabled) {
        remember();
        active = true;
        refreshTitle();
        for (const link of getIconLinks()) {
            link.setAttribute('href', ICON);
            link.setAttribute('type', 'image/svg+xml');
        }
        if (textarea) {
            for (const name of PLACEHOLDER_ATTRS) {
                textarea.setAttribute(name, PLACEHOLDER);
            }
        }
        return;
    }
    if (!active || !original) {
        return;
    }
    active = false;
    document.title = original.title;
    for (const [link, href, type] of original.icons) {
        link.setAttribute('href', href);
        if (type) {
            link.setAttribute('type', type);
        } else {
            link.removeAttribute('type');
        }
    }
    if (textarea) {
        for (const name of PLACEHOLDER_ATTRS) {
            const value = original.placeholder[name];
            if (value === null || value === undefined) {
                textarea.removeAttribute(name);
            } else {
                textarea.setAttribute(name, value);
            }
        }
        // the app's own text for the current connection state
        const connected = !document.getElementById('send_form')?.classList.contains('no-connection');
        textarea.setAttribute('placeholder', textarea.getAttribute(connected ? 'connected_text' : 'no_connection_text') ?? '');
    }
    original = null;
}
