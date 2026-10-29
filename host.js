// Borrowing the app's own controls: a panel of the app's (an extension's settings, a group of its
// options) is moved into one of the theme's windows while it's open and put back exactly where it
// was when the window closes, so every control keeps its handlers and saved values.

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
