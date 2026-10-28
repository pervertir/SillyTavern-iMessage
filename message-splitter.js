// Stand-in until the shared splitter lands: splits after . ! ? … outside quotes.
export function splitMessage(text) {
    const parts = [];
    let start = 0;
    let quote = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"' || ch === '“' || ch === '”') {
            quote = ch === '“' ? true : ch === '”' ? false : !quote;
            continue;
        }
        if (ch === '\n' && text[i + 1] === '\n') {
            parts.push(text.slice(start, i));
            start = i + 2;
            continue;
        }
        if (!quote && /[.!?…]/.test(ch) && /\s/.test(text[i + 1] ?? ' ') && !/[.!?…]/.test(text[i + 1] ?? '')) {
            parts.push(text.slice(start, i + 1));
            start = i + 1;
        }
    }
    parts.push(text.slice(start));
    return parts.map((part) => part.trim()).filter(Boolean);
}
