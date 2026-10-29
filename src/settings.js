// Settings, Connections, Formatting and Response Settings windows (built on panes.js). Each
// section lists which of ST's own controls it shows.

import { openPanes, redrawPanes } from './panes.js';
import { context, t } from './dom.js';

const BLUE = '#0a84ff';
const GREEN = '#34c759';
const ORANGE = '#ff9f0a';
const RED = '#ff375f';
const PURPLE = '#bf5af2';
const INDIGO = '#5e5ce6';
const TEAL = '#30b0c7';
const PINK = '#ff6482';
const GRAY = '#8e8e93';
const BROWN = '#ac8e68';

// The app's nodes never go away, so each is looked up once and remembered: while a section is open
// its nodes sit in the window rather than where a selector would look for them.
const found = new Map();

function find(key, lookup) {
    const hit = found.get(key);
    if (hit?.isConnected) {
        return hit;
    }
    const node = lookup();
    if (node) {
        found.set(key, node);
    }
    return node ?? null;
}

function byId(id) {
    return find(`#${id}`, () => document.getElementById(id));
}

function select(selector) {
    return find(selector, () => document.querySelector(selector));
}

/** The label around a checkbox, so the whole row comes along. */
function labelOf(id) {
    return find(`label:${id}`, () => document.getElementById(id)?.closest('label'));
}

/** The block of a column whose heading carries the given text key. */
function headed(columnId, key) {
    return find(`${columnId}:${key}`, () => {
        const column = document.getElementById(columnId);
        return [...(column?.children ?? [])].find((child) => {
            const heading = child.querySelector(':scope > h4');
            return heading && (heading.dataset.i18n === key || heading.querySelector(`[data-i18n="${key}"]`));
        });
    });
}

function mainApi() {
    return context().mainApi ?? document.getElementById('main_api')?.value;
}

function banner(text, action, run) {
    const node = document.createElement('div');
    node.className = 'imsg-ext-banner';
    const label = document.createElement('span');
    label.textContent = t(text);
    node.append(label);
    if (action) {
        const go = document.createElement('button');
        go.type = 'button';
        go.className = 'imsg-ext-reload';
        go.textContent = t(action);
        go.addEventListener('click', run);
        node.append(go);
    }
    return node;
}

// ── Settings ──

const SETTINGS = {
    id: 'imsg-settings',
    title: 'Settings',
    sections: () => [
        {
            key: 'general', title: 'General', symbol: 'gear', color: GRAY,
            nodes: () => [byId('UI-language-block'), byId('account_controls'), select('[name="MiscellaneousToggles"] > .flexGap2')],
        },
        {
            key: 'appearance', title: 'Appearance', symbol: 'paintbrush', color: BLUE,
            intro: (body) => body.append(banner('The Messages look sits over most of these. They show in full with the theme off.')),
            nodes: () => [byId('UI-presets-block'), select('[name="AvatarAndChatDisplay"]'), select('[name="FontBlurChatWidthBlock"]'), select('[name="themeToggles"]')],
        },
        {
            key: 'css', title: 'Custom CSS', symbol: 'code', color: INDIGO,
            nodes: () => [byId('CustomCSS-block')],
        },
        {
            key: 'moving', title: 'Moving Panels', symbol: 'move', color: TEAL,
            nodes: () => [find('moving', () => document.getElementById('movingUIModeCheckBlock')?.parentElement), byId('MovingUI-presets-block')],
        },
        {
            key: 'characters', title: 'Characters', symbol: 'person', color: ORANGE, group: 'Chat', hideTitle: true,
            nodes: () => [select('[name="CharacterHandlingToggles"]')],
        },
        {
            key: 'messages', title: 'Messages', symbol: 'bubble', color: GREEN, group: 'Chat', hideTitle: true,
            nodes: () => [select('[name="ChatMessageHandlingToggles"]')],
        },
        {
            key: 'streaming', title: 'Streaming & Sound', symbol: 'speaker', color: PINK, group: 'Chat',
            nodes: () => [byId('smooth_streaming_control'), byId('smooth_streaming_no_think_control'), byId('smooth_streaming_speed_control'), labelOf('stream_fade_in'), labelOf('play_message_sound'), labelOf('play_sound_unfocused')],
        },
        {
            key: 'typing', title: 'Typing', symbol: 'keyboard', color: BROWN, group: 'Chat',
            nodes: () => [labelOf('enable_auto_select_input'), labelOf('enable_md_hotkeys'), labelOf('restore_user_input'), labelOf('relaxed_api_urls'), labelOf('world_import_dialog')],
        },
        {
            key: 'autocomplete', title: 'Auto-Complete', symbol: 'sparkle', color: PURPLE, group: 'Commands',
            nodes: () => [select('[name="AutoCompleteToggle"] > .inline-drawer-content')],
        },
        {
            key: 'stscript', title: 'STscript', symbol: 'terminal', color: GRAY, group: 'Commands', hideTitle: true,
            nodes: () => [select('[name="STscriptToggles"]')],
        },
    ],
};

export function openSettings(section = null) {
    openPanes(SETTINGS, section);
}

// ── Connections ──

const APIS = [
    { api: 'openai', block: 'openai_api', title: 'Chat Completion', symbol: 'bubble', color: GREEN },
    { api: 'textgenerationwebui', block: 'textgenerationwebui_api', title: 'Text Completion', symbol: 'textformat', color: BLUE },
    { api: 'novel', block: 'novel_api', title: 'NovelAI', symbol: 'pencil', color: PURPLE },
    { api: 'koboldhorde', block: 'kobold_horde', title: 'AI Horde', symbol: 'cloud', color: TEAL },
    { api: 'kobold', block: 'kobold_api', title: 'KoboldAI Classic', symbol: 'server', color: ORANGE },
];

function useApi(api) {
    $('#main_api').val(api).trigger('change');
    redrawPanes();
}

const CONNECTIONS = {
    id: 'imsg-connections',
    title: 'Connections',
    sections: () => [
        {
            key: 'profiles', title: 'Profiles', symbol: 'key', color: GRAY,
            available: !!byId('connection_profiles'),
            nodes: () => [find('profiles', () => document.getElementById('connection_profiles')?.closest('#rm_api_block > *'))],
        },
        ...APIS.map((item) => ({
            key: item.api, title: item.title, symbol: item.symbol, color: item.color, group: 'API', show: true,
            note: () => (mainApi() === item.api ? t('In Use') : ''),
            intro: (body) => {
                if (mainApi() !== item.api) {
                    body.append(banner(`Replies don't use ${item.title} now.`, 'Use for Replies', () => useApi(item.api)));
                }
            },
            nodes: () => [byId(item.block)],
        })),
        {
            key: 'options', title: 'Options', symbol: 'sliders', color: GRAY, group: 'API',
            nodes: () => [find('connect-options', () => document.getElementById('auto-connect-checkbox')?.closest('#rm_api_block > *'))],
        },
    ],
};

export function openConnections(section = null) {
    openPanes(CONNECTIONS, section ?? mainApi());
}

// ── Formatting ──

const FORMATTING = {
    id: 'imsg-formatting',
    title: 'Formatting',
    menu: () => [
        { label: 'Import…', run: () => byId('af_master_import')?.click() },
        { label: 'Export', run: () => byId('af_master_export')?.click() },
    ],
    sections: () => [
        {
            key: 'context', title: 'Context Template', symbol: 'doc', color: BLUE,
            nodes: () => [byId('advanced-formatting-cc-notice'), byId('ContextSettings')],
        },
        {
            key: 'instruct', title: 'Instruct Template', symbol: 'textformat', color: PURPLE,
            nodes: () => [byId('advanced-formatting-cc-notice'), byId('InstructSettingsColumn')],
        },
        {
            key: 'system', title: 'System Prompt', symbol: 'bubble', color: GREEN,
            nodes: () => [byId('advanced-formatting-cc-notice'), select('#SystemPromptColumn > h4'), byId('SystemPromptBlock')],
        },
        {
            key: 'reasoning', title: 'Reasoning', symbol: 'sparkle', color: INDIGO, group: 'Replies',
            nodes: () => [headed('SystemPromptColumn', 'Reasoning')],
        },
        {
            key: 'stopping', title: 'Stopping Strings', symbol: 'octagon', color: RED, group: 'Replies',
            nodes: () => [headed('SystemPromptColumn', 'Custom Stopping Strings')],
        },
        {
            key: 'tokenizer', title: 'Tokenizer', symbol: 'ruler', color: TEAL, group: 'Replies',
            nodes: () => [select('[name="tokenizerSettingsBlock"]')],
        },
        {
            key: 'misc', title: 'Miscellaneous', symbol: 'sliders', color: GRAY, group: 'Replies',
            nodes: () => [headed('SystemPromptColumn', 'Miscellaneous')],
        },
    ],
};

export function openFormatting(section = null) {
    openPanes(FORMATTING, section);
}

// ── Response Settings ──

const RESPONSE = {
    id: 'imsg-response',
    title: 'Response Settings',
    sections: () => [
        {
            key: 'preset', title: 'Preset', symbol: 'doc', color: BLUE,
            nodes: () => [byId('respective-presets-block')],
        },
        {
            key: 'length', title: 'Length', symbol: 'ruler', color: ORANGE,
            // Chat Completion keeps its own length and context under Sampling
            available: mainApi() !== 'openai',
            nodes: () => [byId('common-gen-settings-block')],
        },
        {
            key: 'sampling', title: 'Sampling', symbol: 'sliders', color: PURPLE,
            nodes: () => [byId('respective-ranges-and-temps')],
        },
        {
            key: 'prompts', title: 'Prompts', symbol: 'bubble', color: GREEN,
            available: mainApi() === 'openai',
            nodes: () => [find('prompt-manager', () => document.getElementById('completion_prompt_manager')?.closest('.range-block'))],
        },
        {
            key: 'advanced', title: 'Advanced', symbol: 'gear', color: GRAY,
            nodes: () => [byId('advanced-ai-config-block')],
        },
    ],
};

export function openResponseSettings(section = null) {
    openPanes(RESPONSE, section);
}
