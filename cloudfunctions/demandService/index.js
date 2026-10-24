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
  // 1. 权限校验：获取用户信息
  const userRes = await db.collection('users').where({ _openid: openid }).get()
  if (userRes.data.length === 0) {
    return { code: 403, msg: 'User not found' }
  }
  const user = userRes.data[0]

  // 2. 权限校验：检查角色
  // 只有当前角色为 'farmer' (农户) 才能发布需求
  if (user.role !== 'farmer') {
    return { code: 403, msg: 'Permission denied: Only verified farmers can publish demands' }
  }

  // 3. 简单的必填校验
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
