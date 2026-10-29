// Messages shows a contact without a photo as their initials on a grey disc. The app copies its
// default pictures into new characters and personas, so a placeholder is found by how it looks:
// a tiny version of the picture is compared with a tiny version of the defaults.

import { events, onStart, whenOn } from './power.js';

const DEFAULT_PICTURES = ['img/ai4.png', 'img/user-default.png'];
const SIZE = 12;
/** Average difference per color channel (0-255) under which two pictures count as the same */
const THRESHOLD = 16;

/** @type {Promise<Uint8ClampedArray[]>|null} */
let defaultSignatures = null;
/** @type {Map<string, Promise<boolean>>} */
const verdicts = new Map();

/** The picture's centre square, shrunk to a few pixels. */
async function signature(src) {
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    await img.decode();
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, SIZE, SIZE);
    return context.getImageData(0, 0, SIZE, SIZE).data;
}

function difference(a, b) {
    let total = 0;
    for (let i = 0; i < a.length; i += 4) {
        total += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    }
    return total / (a.length / 4 * 3);
}

/** Whether a picture is one of the app's defaults (or a copy of one). */
export function isPlaceholder(src) {
    if (!src) {
        return Promise.resolve(true);
    }
    if (!verdicts.has(src)) {
        defaultSignatures ??= Promise.all(DEFAULT_PICTURES.map(signature)).catch(() => []);
        verdicts.set(src, (async () => {
            if (DEFAULT_PICTURES.some(path => src.endsWith(path))) {
                return true;
            }
            try {
                const [mine, defaults] = await Promise.all([signature(src), defaultSignatures]);
                return defaults.some(known => difference(mine, known) < THRESHOLD);
            } catch {
                return false;
            }
        })());
    }
    return verdicts.get(src);
}

/** Initials the way Contacts shows them: first and last word, or one letter for a single word. */
export function getInitials(name) {
    // letters and digits only, so "[Unnamed Persona]" gives UP, not [P
    const words = String(name ?? '').replace(/[^\p{L}\p{N}\s'-]/gu, ' ').trim().split(/\s+/)
        .map(word => word.replace(/^[^\p{L}\p{N}]+/u, '')).filter(Boolean);
    if (!words.length) {
        return '';
    }
    const first = [...words[0]][0] ?? '';
    const last = words.length > 1 ? [...words[words.length - 1]][0] ?? '' : '';
    return (first + last).toUpperCase();
}

/** A grey contact disc with initials (or the person silhouette when there are none). */
export function buildMonogram(name) {
    const monogram = document.createElement('span');
    monogram.className = 'imsg-monogram';
    monogram.setAttribute('aria-hidden', 'true');
    monogram.textContent = getInitials(name);
    return monogram;
}

/** Puts a monogram over a placeholder picture (the picture stays, hidden, for the app). */
export async function monogramize(img, name) {
    const holder = img?.parentElement;
    if (!holder) {
        return;
    }
    const src = img.getAttribute('src') ?? '';
    if (holder.dataset.imsgMonoFor === src && holder.dataset.imsgMonoName === name) {
        return;
    }
    holder.dataset.imsgMonoFor = src;
    holder.dataset.imsgMonoName = name;
    const placeholder = await isPlaceholder(src);
    // the picture may have changed while this was being worked out
    if ((img.getAttribute('src') ?? '') !== src) {
        return;
    }
    let monogram = holder.querySelector(':scope > .imsg-monogram.imsg-mono-mark');
    if (!placeholder) {
        holder.classList.remove('imsg-mono');
        monogram?.remove();
        return;
    }
    if (!monogram) {
        monogram = buildMonogram(name);
        monogram.classList.add('imsg-mono-mark');
        holder.append(monogram);
    }
    monogram.textContent = getInitials(name);
    holder.classList.add('imsg-mono');
}

/**
 * Monograms every placeholder picture under a root.
 * @param {ParentNode} root
 * @param {string} imgSelector
 * @param {(img: HTMLImageElement) => string} nameOf
 */
export function monogramizeAll(root, imgSelector, nameOf) {
    root?.querySelectorAll(imgSelector).forEach((img) => {
        monogramize(/** @type {HTMLImageElement} */ (img), nameOf(/** @type {HTMLImageElement} */ (img)) || '');
    });
}

function messageName(img) {
    return img.closest('.mes')?.getAttribute('ch_name') ?? '';
}

function rowName(img) {
    return img.closest('.character_select, .group_select, .avatar-container')?.querySelector('.ch_name')?.textContent?.trim() ?? '';
}

function monogramizeMessages() {
    monogramizeAll(document.getElementById('chat'), '.mes .avatar img', messageName);
}

export function initMonograms() {
    const { eventTypes } = SillyTavern.getContext();
    const eventSource = events();
    const one = (mesId) => {
        const mes = document.querySelector(`#chat .mes[mesid="${Number(mesId)}"]`);
        monogramizeAll(mes, '.avatar img', messageName);
    };
    const later = () => setTimeout(whenOn(monogramizeMessages), 0);
    eventSource.on(eventTypes.CHARACTER_MESSAGE_RENDERED, one);
    eventSource.on(eventTypes.USER_MESSAGE_RENDERED, one);
    eventSource.on(eventTypes.CHAT_CHANGED, later);
    eventSource.on(eventTypes.MORE_MESSAGES_LOADED, later);

    // Characters
    const people = () => monogramizeAll(document.getElementById('rm_print_characters_block'), '.avatar:not(.avatar_collage) > img', rowName);
    eventSource.on(eventTypes.CHARACTER_PAGE_LOADED, () => setTimeout(whenOn(people), 0));

    // Personas: the list is redrawn without an event, so watch the list itself
    const personas = document.getElementById('user_avatar_block');
    if (personas) {
        const run = () => monogramizeAll(personas, '.avatar img', rowName);
        new MutationObserver(whenOn(run)).observe(personas, { childList: true });
        onStart(run);
    }
    onStart(people);
    onStart(later);
}
