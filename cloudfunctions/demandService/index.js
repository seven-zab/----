// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!openid) {
    return { code: 401, msg: 'Unauthorized' }
  }

  const { action, data } = event

  try {
    switch (action) {
      case 'create':
        return await createDemand(openid, data)
      default:
        return { code: 400, msg: 'Invalid action' }
    }
  } catch (err) {
    console.error(err)
    return { code: 500, msg: err.message || 'Internal Server Error' }
  }
}

async function createDemand(openid, data) {
  // 简单的必填校验
  if (!data.title || !data.content || !data.type) {
    return { code: 400, msg: 'Missing required fields' }
  }

  const demand = {
    ...data,
    _openid: openid,
    status: 'published', // 默认发布即生效，或者根据业务逻辑设置为 'pending'
    created_at: Date.now(),
    updated_at: Date.now(),
    view_count: 0,
    applicant_count: 0
  }

  const res = await db.collection('demands').add({
    data: demand
  })

  return {
    code: 0,
    msg: 'Success',
    data: {
      id: res._id,
      ...demand
    }
  }
}
