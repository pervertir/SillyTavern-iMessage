// The contact card (Details): a big picture, the name and a line about them, round buttons for
// what you'd do next, and the full editor one click away, instead of opening straight into the
// app's character editor.

import { monogramize } from './monograms.js';
import { buildGroupAvatar, clickOption, openDrawer } from './shell.js';

const DESCRIPTION_LIMIT = 220;

function t(text) {
    return SillyTavern.getContext().translate(text);
}

/** One line about the contact, as plain text: their notes, or the start of their description. */
function aboutLine(character) {
    const { name1 } = SillyTavern.getContext();
    const raw = character.data?.creator_notes || character.creatorcomment || character.description || '';
    const text = String(raw)
        .replace(/<[^>]*>/g, ' ')
        .replace(/\{\{char\}\}/gi, character.name)
        .replace(/\{\{user\}\}/gi, name1 ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    return text.length > DESCRIPTION_LIMIT ? `${text.slice(0, DESCRIPTION_LIMIT).replace(/\s+\S*$/, '')}…` : text;
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text !== undefined) {
        node.textContent = text;
    }
    return node;
}

/** A round action button with its label under it. */
function action(label, symbol, run) {
    const button = element('button', 'imsg-card-action');
    button.type = 'button';
    const glyph = element('i', 'imsg-sym');
    glyph.style.setProperty('--imsg-glyph', `var(--imsg-sym-${symbol})`);
    button.append(element('span', 'imsg-card-action-icon'), element('span', 'imsg-card-action-label', t(label)));
    button.firstChild.append(glyph);
    button.addEventListener('click', run);
    return button;
}

/** A row of the list under the buttons. */
function row(label, run, danger = false) {
    const button = element('button', `imsg-card-row${danger ? ' imsg-danger' : ''}`, t(label));
    button.type = 'button';
    button.addEventListener('click', run);
    return button;
}

/** Opens the card for the open conversation's contact or group. */
export async function openContactCard() {
    const context = SillyTavern.getContext();
    const group = context.groupId ? context.groups.find(x => String(x.id) === String(context.groupId)) : null;
    const character = !group && context.characterId !== undefined ? context.characters[context.characterId] : null;
    if (!group && !character) {
        openDrawer('rightNavHolder');
        return;
    }

    const card = element('div', 'imsg-card');
    const picture = element('div', 'imsg-card-picture imsg-avatar');
    if (group) {
        picture.append(buildGroupAvatar(group));
    } else {
        const img = element('img');
        img.alt = '';
        img.src = `/characters/${encodeURIComponent(character.avatar)}`;
        img.addEventListener('error', () => { img.src = context.getThumbnailUrl('avatar', character.avatar); }, { once: true });
        picture.append(img);
        monogramize(img, character.name);
    }
    card.append(picture, element('h2', 'imsg-card-name', group ? group.name : character.name));

    const about = group
        ? (group.members ?? []).map(id => context.characters.find(x => x.avatar === id)?.name).filter(Boolean).join(', ')
        : aboutLine(character);
    if (about) {
        card.append(element('p', 'imsg-card-about', about));
    }

    const popup = new context.Popup(card, context.POPUP_TYPE.DISPLAY, '', { allowVerticalScrolling: true, animation: 'fast' });
    popup.dlg.classList.add('imsg-card-popup');
    // the alert styling must leave the card alone
    popup.dlg.dataset.imsgChecked = '';
    const then = (run) => () => {
        popup.completeCancelled();
        setTimeout(run, 0);
    };

    const actions = element('div', 'imsg-card-actions');
    actions.append(
        action('Message', 'send', then(() => document.getElementById('send_textarea')?.focus())),
        action('New', 'compose', then(() => clickOption('option_start_new_chat'))),
        action('History', 'arrow-clockwise', then(() => clickOption('option_select_chat'))),
        action('Edit', 'pencil', then(() => openDrawer('rightNavHolder'))),
    );
    card.append(actions);

    const list = element('div', 'imsg-card-list');
    if (group) {
        list.append(
            row('Delete Group…', then(() => {
                openDrawer('rightNavHolder');
                setTimeout(() => document.getElementById('rm_group_delete')?.click(), 50);
            }), true),
        );
    } else {
        list.append(
            row('Delete Contact…', then(() => {
                openDrawer('rightNavHolder');
                setTimeout(() => document.querySelector('#rm_ch_create_block #delete_button, div#delete_button')?.click(), 50);
            }), true),
        );
    }
    card.append(list);

    await popup.show();
}
