// Picks recorded conversations beyond the role picks of helpers/har-replay.js (`requireConversation`), from the recording's own listing (`deepseekReplay.conversations`).
// Every role of `requireConversation` resolves to the same conversation on a small recording, so a spec that needs a second, different conversation or the shortest one chooses it here.

/** The first recorded conversation whose id differs from `excludedId`; throws, naming the need, when the recording holds only that one. */
export function conversationOtherThan(replay, excludedId) {
    const other = replay.conversations.find((conversation) => conversation.id !== excludedId);
    if (!other) throw new Error('The recording holds no second conversation, which this spec needs to compare with the first. Re-record a session that opens at least two conversations.');
    return other;
}

/** The recorded conversation with the fewest messages (the first listed wins a tie); throws when the recording holds none. */
export function shortestConversation(replay) {
    let shortest = null;
    for (const conversation of replay.conversations) {
        if (shortest === null || conversation.messageCount < shortest.messageCount) shortest = conversation;
    }
    if (shortest === null) throw new Error('The recording holds no conversation. Re-record a session that opens one.');
    return shortest;
}
