// Pictures from links: an image link in a message (a bare URL ending in .png, .jpg and so on, or a
// Markdown image) shows as the picture itself, in its own rounded bubble at its own shape, the way
// Messages shows a photo. Clicking it opens a full-size viewer. The link text is taken out of the
// bubble so the picture isn't shown twice.
//
// The app's "Forbid External Media" setting removes Markdown images before they reach the page,
// so the links are read from the message's own text, not from what the app drew.

import { events } from './power.js';

const PHOTOS_CLASS = 'imsg-photos';
const VIEWER_ID = 'imsg-viewer';
const IMAGE_EXTENSIONS = 'png|jpe?g|gif|webp|avif|bmp|apng';
/** A bare link to an image file, with an optional query or fragment */
const BARE_IMAGE = new RegExp(`https?://[^\\s<>"'()\\[\\]]+?\\.(?:${IMAGE_EXTENSIONS})(?:[?#][^\\s<>"'()\\[\\]]*)?(?=$|[\\s<>"'()\\[\\],!?;:*_~]|\\.(?:\\s|$))`, 'gi');
/** ![alt](url "title") */
const MARKDOWN_IMAGE = /!\[[^\]]*\]\(\s*<?(https?:\/\/[^\s)>]+)>?(?:\s+["'][^"']*["'])?\s*\)/gi;
/** <img src="url"> written into the message */
const HTML_IMAGE = /<img\b[^>]*?\ssrc\s*=\s*["']?(https?:\/\/[^\s"'>]+)/gi;

let getSettings = () => ({ imageLinks: true });

function t(text) {
    return SillyTavern.getContext().translate(text);
}

/** The image links in a message's text, in order, each once. */
export function imageLinks(text) {
    if (typeof text !== 'string' || !text.includes('http')) {
        return [];
    }
    const found = [];
    for (const pattern of [MARKDOWN_IMAGE, HTML_IMAGE]) {
        for (const match of text.matchAll(pattern)) {
            found.push({ index: match.index, url: match[1] });
        }
    }
    // a bare link inside a Markdown or HTML image was already counted
    const spans = found.map(({ index, url }) => [index, text.indexOf(url, index) + url.length]);
    for (const match of text.matchAll(BARE_IMAGE)) {
        if (!spans.some(([start, end]) => match.index >= start && match.index < end)) {
            found.push({ index: match.index, url: match[0] });
        }
    }
    return [...new Set(found.sort((a, b) => a.index - b.index).map((item) => item.url))];
}

/** A message's text with its image links taken out, and how many there were, for previews. */
export function withoutImages(text) {
    const urls = getSettings().imageLinks ? imageLinks(text) : [];
    if (!urls.length) {
        return { text: String(text ?? ''), count: 0 };
    }
    let rest = String(text).replace(MARKDOWN_IMAGE, ' ').replace(/<img\b[^>]*>/gi, ' ');
    for (const url of urls) {
        rest = rest.split(url).join(' ');
    }
    return { text: rest, count: urls.length };
}

/** "Image" or "3 Images", as the list says for a picture with no words. */
export function imageLabel(count) {
    return count === 1 ? t('Image') : `${count} ${t('Images')}`;
}

/** Takes the links out of a bubble's text: link elements, images the app drew, and bare URLs. */
function stripLinks(element, urls) {
    for (const node of element.querySelectorAll('img[src]')) {
        if (urls.includes(node.getAttribute('src'))) {
            node.remove();
        }
    }
    for (const link of element.querySelectorAll('a[href]')) {
        if (urls.includes(link.getAttribute('href')) && (!link.textContent.trim() || urls.includes(link.textContent.trim()))) {
            link.remove();
        }
    }
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
        nodes.push(/** @type {Text} */ (walker.currentNode));
    }
    for (const node of nodes) {
        let text = node.data;
        for (const url of urls) {
            text = text.split(url).join('');
        }
        if (text !== node.data) {
            node.data = text.replace(/[ \t]{2,}/g, ' ');
        }
    }
    // paragraphs and line breaks left with nothing in them
    for (const block of element.querySelectorAll('p')) {
        if (!block.textContent.trim() && !block.querySelector('img, video, audio, iframe')) {
            block.remove();
        }
    }
    while (element.lastChild?.nodeName === 'BR' || (element.lastChild?.nodeType === Node.TEXT_NODE && !element.lastChild.textContent.trim())) {
        element.lastChild.remove();
    }
}

function isEmpty(element) {
    return !element.textContent.trim() && !element.querySelector('img, video, audio, iframe, svg, canvas');
}

function closeViewer() {
    document.getElementById(VIEWER_ID)?.remove();
}

function openViewer(url) {
    closeViewer();
    const viewer = document.createElement('div');
    viewer.id = VIEWER_ID;
    viewer.setAttribute('role', 'dialog');
    viewer.setAttribute('aria-label', t('Photo'));
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    const bar = document.createElement('div');
    bar.className = 'imsg-viewer-bar';
    const open = document.createElement('a');
    open.href = url;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    open.textContent = t('Open Original');
    const done = document.createElement('button');
    done.type = 'button';
    done.textContent = t('Done');
    done.addEventListener('click', closeViewer);
    bar.append(open, done);
    viewer.append(img, bar);
    viewer.addEventListener('click', (event) => {
        if (event.target === viewer) {
            closeViewer();
        }
    });
    document.body.append(viewer);
    done.focus({ preventScroll: true });
}

/** A picture, or the link itself if it doesn't load. */
function buildPhoto(url) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'imsg-photo';
    button.dataset.imsgUrl = url;
    button.setAttribute('aria-label', t('Photo'));
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.src = url;
    img.addEventListener('load', () => button.classList.add('imsg-photo-loaded'), { once: true });
    img.addEventListener('error', () => {
        const link = document.createElement('a');
        link.className = 'imsg-photo-failed';
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = url;
        button.replaceWith(link);
    }, { once: true });
    button.append(img);
    button.addEventListener('click', () => openViewer(url));
    return button;
}

/** Draws a message's pictures; called from the messages pass after the split. */
export function showImages(mes, message) {
    const block = mes.querySelector(':scope > .mes_block');
    if (!block) {
        return;
    }
    const streaming = mes.classList.contains('last_mes') && document.body.classList.contains('imsg-generating');
    const urls = getSettings().imageLinks && !streaming && !message?.is_system ? imageLinks(message?.mes) : [];
    let photos = block.querySelector(`:scope > .${PHOTOS_CLASS}`);
    const key = urls.join('\n');
    if (!urls.length) {
        photos?.remove();
        mes.classList.remove('imsg-has-photos', 'imsg-photo-only');
        block.querySelectorAll('.imsg-part-empty').forEach((part) => part.classList.remove('imsg-part-empty'));
        return;
    }

    const text = block.querySelector(':scope > .mes_text');
    const parts = [...block.querySelectorAll(':scope > .imsg-parts > .imsg-part:not(.imsg-part-typing)')];
    for (const element of [text, ...parts]) {
        if (element) {
            stripLinks(element, urls);
        }
    }
    for (const part of parts) {
        part.classList.toggle('imsg-part-empty', isEmpty(part));
    }
    const split = mes.classList.contains('imsg-split');
    const textless = split ? parts.every((part) => part.classList.contains('imsg-part-empty')) : !text || isEmpty(text);

    if (photos?.dataset.imsgKey !== key) {
        photos?.remove();
        photos = document.createElement('div');
        photos.className = PHOTOS_CLASS;
        photos.dataset.imsgKey = key;
        photos.append(...urls.map(buildPhoto));
    }
    // the pictures come after the words, as their own bubbles
    const after = block.querySelector(':scope > .imsg-parts') ?? text;
    if (after && photos.previousElementSibling !== after) {
        after.after(photos);
    } else if (!after && !photos.isConnected) {
        block.append(photos);
    }
    // laid out like an attached picture: no bubble around it, the words in a bubble of their own
    mes.classList.add('imsg-has-photos', 'imsg-media');
    mes.classList.toggle('imsg-photo-only', textless);
}

export function initImages({ settings }) {
    getSettings = settings;
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && document.getElementById(VIEWER_ID)) {
            event.stopPropagation();
            closeViewer();
        }
    }, { capture: true });
    events().on(SillyTavern.getContext().eventTypes.CHAT_CHANGED, closeViewer);
}
