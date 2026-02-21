// cloudfunctions/register/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const env = wxContext.ENV;
  const { name, role, phone, verify_material } = event;

  console.log(
    `Register Function Triggered. Env: ${env}, OpenID: ${openid}, Data: ${JSON.stringify(event)}`,
  );

  // Basic validation
  if (!name || !role) {
    return { code: 400, msg: 'Missing required fields' };
  }

  // Check if user exists
  const checkRes = await db
    .collection('users')
    .where({
      _openid: openid,
    })
    .count();

  if (checkRes.total > 0) {
    return { code: 409, msg: 'User already exists' };
  }

  // Determine status based on role
  let status = 'active';
  if (role === 'farmer') {
    status = 'pending'; // Farmers need audit
  }
  // Local/School admins might need manual DB entry or specific code,
  // for simplicity here we assume they also go through pending or are pre-seeded.
  // Let's assume all non-general users need audit for safety in this demo.
  if (role !== 'general_user') {
    status = 'pending';
  }

  const userData = {
    _openid: openid,
    name,
    role,
    phone,
    verify_material, // URL to image/doc
    status,
    created_at: db.serverDate(),
    updated_at: db.serverDate(),
  };

  try {
    const res = await db.collection('users').add({
      data: userData,
    });
    return {
      code: 0,
      data: {
        _id: res._id,
        ...userData,
      },
      msg: 'Register success',
    };
  } catch (e) {
    return {
      code: 500,
      msg: e.message,
      stack: e.stack,
    };
  }
};
