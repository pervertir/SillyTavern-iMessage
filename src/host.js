// Moves one of ST's own nodes (an extension's settings, a group of options) into a theme window
// and puts it back exactly where it was on close, so its handlers and values are untouched.

/** Each borrowed node, with the marker it goes back to */
const homes = new Map();

/** Moves a node of the app's into a theme window. */
export function host(node, into) {
    if (!node) {
        return;
    }
    if (!homes.has(node)) {
        const mark = document.createComment('imsg-host');
        node.before(mark);
        homes.set(node, mark);
    }
    node.classList.add('imsg-hosted');
    into.append(node);
}

/** Puts one node back. */
export function release(node) {
    const mark = homes.get(node);
    if (!mark) {
        return;
    }
    node.classList.remove('imsg-hosted');
    if (mark.isConnected) {
        mark.replaceWith(node);
    } else {
        node.remove();
    }
    homes.delete(node);
}

/** Puts every borrowed node back. */
export function releaseAll() {
    for (const node of [...homes.keys()]) {
        release(node);
    }
}
