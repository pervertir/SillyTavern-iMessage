// What a messaging app does when a message comes and goes: a soft sound when you send and when a
// reply arrives, a blue dot and a count in the tab title for replies that came while you were
// away, and a system notification if you've allowed them. The sounds are made here with Web Audio,
// so no sound files ship with the theme.

import { imageLabel, withoutImages } from './images.js';

const RECEIVED_SKIP = new Set(['first_message', 'command', 'extension']);

let getSettings = () => ({ sounds: true, soundVolume: 50, notify: false });
let audio = null;
/** Replies that arrived while the tab was in the background */
let unseen = 0;

function context() {
    return SillyTavern.getContext();
}

function audioContext() {
    if (!audio) {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) {
            return null;
        }
        audio = new Context();
    }
    if (audio.state === 'suspended') {
        audio.resume().catch(() => {});
    }
    return audio;
}

function volume() {
    const settings = getSettings();
    return settings.sounds ? Math.max(0, Math.min(100, Number(settings.soundVolume) || 0)) / 100 : 0;
}

/** Send: a short airy whoosh that rises and fades. */
function playSend() {
    const level = volume();
    const ac = level && audioContext();
    if (!ac) {
        return;
    }
    const now = ac.currentTime;
    const length = 0.32;
    const buffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * length), ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    const noise = ac.createBufferSource();
    noise.buffer = buffer;
    const band = ac.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 1.4;
    band.frequency.setValueAtTime(700, now);
    band.frequency.exponentialRampToValueAtTime(4200, now + length);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.5 * level, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
    noise.connect(band).connect(gain).connect(ac.destination);
    noise.start(now);
    noise.stop(now + length);
}

/** Reply: two soft bell notes, the second a fourth higher. */
function playReceive() {
    const level = volume();
    const ac = level && audioContext();
    if (!ac) {
        return;
    }
    const now = ac.currentTime;
    const note = (frequency, start) => {
        const tone = ac.createOscillator();
        tone.type = 'sine';
        tone.frequency.value = frequency;
        const overtone = ac.createOscillator();
        overtone.type = 'sine';
        overtone.frequency.value = frequency * 2;
        const overtoneGain = ac.createGain();
        overtoneGain.gain.value = 0.15;
        const gain = ac.createGain();
        gain.gain.setValueAtTime(0.0001, now + start);
        gain.gain.exponentialRampToValueAtTime(0.35 * level, now + start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + start + 0.45);
        tone.connect(gain);
        overtone.connect(overtoneGain).connect(gain);
        gain.connect(ac.destination);
        for (const oscillator of [tone, overtone]) {
            oscillator.start(now + start);
            oscillator.stop(now + start + 0.5);
        }
    };
    note(1046.5, 0);
    note(1396.9, 0.11);
}

/** The tab title keeps a count of replies you haven't seen, "Messages (2)". */
function showCount() {
    const base = document.title.replace(/ \(\d+\)$/, '');
    document.title = unseen ? `${base} (${unseen})` : base;
    document.body.classList.toggle('imsg-unread', unseen > 0);
}

function notify(message, messageId) {
    if (!getSettings().notify || typeof Notification === 'undefined' || Notification.permission !== 'granted') {
        return;
    }
    const { characters, characterId, getThumbnailUrl } = context();
    const character = characters[characterId];
    const avatar = message.force_avatar || (character ? getThumbnailUrl('avatar', character.avatar) : undefined);
    const { text, count } = withoutImages(message.mes);
    const body = (text.replace(/<[^>]*>/g, '').replace(/[*_~`#>]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 160)) || (count ? imageLabel(count) : '');
    try {
        const notification = new Notification(message.name || 'Messages', { body, icon: avatar, tag: `imsg-${messageId}` });
        notification.addEventListener('click', () => {
            window.focus();
            notification.close();
        });
    } catch (error) {
        console.warn('[iMessage] Could not show a notification', error);
    }
}

/** Asks for permission to show notifications; called when the setting is turned on. */
export async function askToNotify() {
    if (typeof Notification === 'undefined') {
        return false;
    }
    if (Notification.permission === 'default') {
        await Notification.requestPermission();
    }
    return Notification.permission === 'granted';
}

function onReceived(messageId, type) {
    if (!document.body.classList.contains('imessage') || RECEIVED_SKIP.has(type)) {
        return;
    }
    const message = context().chat[Number(messageId)];
    if (!message || message.is_user || message.is_system || !String(message.mes ?? '').trim()) {
        return;
    }
    playReceive();
    if (document.hidden || !document.hasFocus()) {
        unseen++;
        showCount();
        notify(message, messageId);
    }
}

function onSeen() {
    if (unseen && !document.hidden) {
        unseen = 0;
        showCount();
    }
}

export function initAlerts({ settings }) {
    getSettings = settings;
    const { eventSource, eventTypes } = context();
    eventSource.on(eventTypes.MESSAGE_SENT, () => {
        if (document.body.classList.contains('imessage')) {
            playSend();
        }
    });
    eventSource.on(eventTypes.MESSAGE_RECEIVED, onReceived);
    document.addEventListener('visibilitychange', onSeen);
    window.addEventListener('focus', onSeen);
    // browsers start audio only after the page has been used, so wake it on the first press
    const unlock = () => {
        if (volume()) {
            audioContext();
        }
    };
    document.addEventListener('pointerdown', unlock, { once: true, capture: true });
    document.addEventListener('keydown', unlock, { once: true, capture: true });
}

/** Plays a sound for the settings preview. */
export function previewSound(kind) {
    (kind === 'send' ? playSend : playReceive)();
}
