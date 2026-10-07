export function normalizeMarketplaceInbox(payload = {}) {
  const conversations = (Array.isArray(payload?.conversations) ? payload.conversations : [])
    .filter((conversation) => conversation?.peer?.id)
    .map((conversation) => ({
      ...conversation,
      unread_count: Math.max(0, Number(conversation.unread_count) || 0),
    }));
  const counted = conversations.reduce((sum, conversation) => sum + conversation.unread_count, 0);
  return {
    conversations,
    unread_count: Math.max(counted, Number(payload?.unread_count) || 0),
  };
}

export function combineChatUnread(projectUnread = {}, marketplaceInbox = {}) {
  const project = Math.max(0, Number(projectUnread?.unread_count) || 0);
  const direct = Math.max(0, Number(marketplaceInbox?.unread_count) || 0);
  const mentions = Math.max(0, Number(projectUnread?.mention_count) || 0);
  return { total: project + direct, project, direct, mentions };
}
