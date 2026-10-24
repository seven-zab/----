// 云函数入口文件
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const _ = db.command;

// 云函数入口函数
exports.main = async (event, context) => {
  const { action, payload } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  console.log('[chatService] Action:', action, 'Payload:', payload, 'OpenID:', openid);

  try {
    switch (action) {
      case 'sendMessage':
        return await sendMessage(openid, payload);
      case 'createConversation':
        return await createConversation(openid, payload);
      case 'getConversations':
        return await getConversations(openid, payload);
      case 'getMessages':
        return await getMessages(openid, payload);
      case 'markAsRead':
        return await markAsRead(openid, payload);
      default:
        return {
          code: 400,
          msg: 'Unknown action',
        };
    }
  } catch (error) {
    console.error('[chatService] Error:', error);
    return {
      code: 500,
      msg: error.message || 'Internal Server Error',
      error,
    };
  }
};

async function sendMessage(senderOpenId, { conversationId, content, type = 'text', receiverId }) {
  // 1. Add message to messages collection
  const messageResult = await db.collection('messages').add({
    data: {
      conversationId,
      senderId: senderOpenId, // Use openid as senderId for simplicity in cloud function, but frontend might pass user _id.
      // Ideally we should map openid to user _id or just use openid consistently.
      // Let's assume user system uses _id which might be openid or a UUID.
      // If the frontend passes senderId, verify it matches openid?
      // For now, let's trust the openid from context as the true sender.
      // But wait, the existing system uses _id in users collection.
      // We should probably look up the user _id from openid if they are different.
      // Or just store openid as senderId.
      content,
      type,
      createTime: db.serverDate(),
      isRead: false,
    },
  });

  // 2. Update conversation's last message
  await db.collection('conversations').doc(conversationId).update({
    data: {
      lastMessage: content,
      lastMessageTime: db.serverDate(),
      lastMessageType: type,
      unreadCount: _.inc(1), // Logic for unread count might need to be more complex (per user)
      updatedAt: db.serverDate(),
    },
  });

  return {
    code: 0,
    msg: 'Message sent',
    data: messageResult,
  };
}

async function createConversation(senderOpenId, { receiverId }) {
  // Check if conversation already exists between these two
  // We need to know the sender's user _id if it's different from openid.
  // Assuming openid is used for auth, but we need to query conversations by participants.

  // Let's fetch the sender's user profile to get their _id just in case, or use openid if _id is openid.
  // For simplicity, let's assume we store participants as an array of IDs.

  // Query for existing conversation
  const { data: existingConversations } = await db.collection('conversations').where({
    participants: _.all([senderOpenId, receiverId]), // This assumes senderOpenId IS the user ID.
    type: 'private'
  }).get();

  if (existingConversations.length > 0) {
    return {
      code: 0,
      msg: 'Conversation exists',
      data: existingConversations[0],
    };
  }

  // Create new conversation
  const result = await db.collection('conversations').add({
    data: {
      participants: [senderOpenId, receiverId],
      type: 'private',
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
      lastMessage: '',
      unreadCount: 0,
    },
  });

  return {
    code: 0,
    msg: 'Conversation created',
    data: {
      _id: result._id,
      participants: [senderOpenId, receiverId],
    },
  };
}

async function getConversations(userOpenId, { limit = 20, offset = 0 }) {
  const { data } = await db.collection('conversations')
    .where({
      participants: userOpenId,
    })
    .orderBy('updatedAt', 'desc')
    .skip(offset)
    .limit(limit)
    .get();

  // Enhance data with receiver info if needed
  // For now return raw data
  return {
    code: 0,
    data,
  };
}

async function getMessages(userOpenId, { conversationId, limit = 50, offset = 0 }) {
  // Verify user is participant
  const { data: conversation } = await db.collection('conversations').doc(conversationId).get();
  if (!conversation.participants.includes(userOpenId)) {
    return {
      code: 403,
      msg: 'Forbidden',
    };
  }

  const { data } = await db.collection('messages')
    .where({
      conversationId,
    })
    .orderBy('createTime', 'asc') // or desc depending on UI
    .skip(offset)
    .limit(limit)
    .get();

  return {
    code: 0,
    data,
  };
}

async function markAsRead(userOpenId, { conversationId }) {
    // Update all messages in this conversation sent by OTHER user to read
    // But typically we just reset unread count in conversation or track read receipt
    // Let's just update messages for now

    // Find the other participant to ensure we only mark their messages as read?
    // Actually simpler: mark all unread messages in this conversation where sender != userOpenId

    await db.collection('messages').where({
        conversationId,
        senderId: _.neq(userOpenId),
        isRead: false
    }).update({
        data: {
            isRead: true
        }
    });

    return {
        code: 0,
        msg: 'Marked as read'
    };
}
