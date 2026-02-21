// cloudfunctions/login/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const env = wxContext.ENV;

  console.log(`Login Function Triggered. Env: ${env}, OpenID: ${openid}`);

  try {
    const res = await db
      .collection('users')
      .where({
        _openid: openid,
      })
      .get();

    if (res.data.length > 0) {
      return {
        code: 0,
        data: res.data[0],
        msg: 'Login success',
      };
    } else {
      return {
        code: 404, // User not found, need register
        data: {
          openid: openid,
        },
        msg: 'User not registered',
      };
    }
  } catch (e) {
    // Return more detailed error for debugging
    return {
      code: 500,
      msg: e.message,
      stack: e.stack,
    };
  }
};
