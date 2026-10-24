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

  console.log('[contactService] Action:', action, 'Payload:', payload, 'OpenID:', openid);

  try {
    switch (action) {
      case 'getContacts':
        return await getContacts(openid, payload);
      default:
        return {
          code: 400,
          msg: 'Unknown action',
        };
    }
  } catch (error) {
    console.error('[contactService] Error:', error);
    return {
      code: 500,
      msg: error.message || 'Internal Server Error',
      error,
    };
  }
};

async function getContacts(userOpenId, { role, keyword }) {
  // Fetch users including current user
  // Optionally filter by role or keyword

  const query = {
    // _id: _.neq(userOpenId), // Removed to allow self-chat
    // status: 'active' // Only active users
  };

  if (keyword) {
    query.name = db.RegExp({
      regexp: keyword,
      options: 'i',
    });
  }

  if (role) {
    query.role = role;
  } else {
    // By default, return all valid roles for chatting
    query.role = _.in(['farmer', 'local_admin', 'school_admin']);
  }

  const { data } = await db.collection('users')
    .where(query)
    .field({
      name: true,
      avatarUrl: true,
      role: true,
      _id: true, // This is the user ID we need for starting conversation
      openid: true // If available
    })
    .limit(100) // Limit for now
    .get();

  return {
    code: 0,
    data,
  };
}
