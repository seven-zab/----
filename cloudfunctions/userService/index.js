// cloudfunctions/userService/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { action, data } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) {
    return { code: 401, msg: 'Unauthorized' };
  }

  try {
    switch (action) {
      case 'switchRole':
        return await switchRole(openid, data);
      case 'initUserRoles':
        return await initUserRoles(openid);
      case 'updateAvatar':
        return await updateAvatar(openid, data);
      case 'updateProfile':
        return await updateProfile(openid, data);
      case 'auditUser':
        return await auditUser(openid, data);
      case 'listPendingUsers':
        return await listPendingUsers(openid, data);
      default:
        return { code: 400, msg: 'Invalid action' };
    }
  } catch (err) {
    console.error(err);
    return { code: 500, msg: err.message || 'Internal Server Error' };
  }
};

async function switchRole(openid, data) {
  const { targetRoleCode } = data;
  
  // 1. Get user
  const userRes = await db.collection('users').where({ _openid: openid }).get();
  if (userRes.data.length === 0) {
    return { code: 404, msg: 'User not found' };
  }
  const user = userRes.data[0];

  // 2. Validate role in available_roles
  const availableRoles = user.available_roles || [];
  const targetRole = availableRoles.find(r => r.role_code === targetRoleCode);

  if (!targetRole) {
    return { code: 403, msg: 'Permission denied: Role not available' };
  }

  // 3. Update role and current_context
  const updateData = {
    role: targetRoleCode,
    current_context: targetRole.context || {},
    updated_at: Date.now()
  };

  await db.collection('users').doc(user._id).update({
    data: updateData
  });

  // 4. Return updated user info
  return {
    code: 0,
    msg: 'Success',
    data: {
      ...user,
      ...updateData
    }
  };
}

async function initUserRoles(openid) {
  // Hardcoded initialization for specific user (张奥博)
  // In production, this would be an admin function or logic during approval
  
  const userRes = await db.collection('users').where({ _openid: openid }).get();
  if (userRes.data.length === 0) {
      return { code: 404, msg: 'User not found' };
  }
  const user = userRes.data[0];
  
  // Verify it is the correct user
  if (user.phone !== '13823162597') {
      return { code: 403, msg: 'Only specific user can init roles' };
  }

  const available_roles = [
    {
      "role_code": "local_admin",
      "role_name": "村委工作台",
      "context": {
        "region_code": "441623", 
        "region_name": "连平县团委" 
      }
    },
    {
      "role_code": "teacher_student",
      "role_name": "高校实践团",
      "context": {
        "school_id": "sz_tech_001",
        "school_name": "深圳技术大学"
      }
    },
    {
      "role_code": "farmer",
      "role_name": "农商户中心",
      "context": {
        "verified_status": true, 
        "farm_location": "上坪镇鹰嘴桃基地"
      }
    }
  ];

  const updateData = {
      role: 'local_admin',
      current_context: available_roles[0].context,
      available_roles: available_roles,
      updated_at: Date.now()
  };

  await db.collection('users').doc(user._id).update({
      data: updateData
  });

  return {
      code: 0,
      msg: 'Initialized',
      data: {
          ...user,
          ...updateData
      }
  };
}

async function updateAvatar(openid, data) {
    const { _id, avatarUrl } = data;
    await db.collection('users').doc(_id).update({
        data: { avatarUrl, updated_at: Date.now() }
    });
    return { code: 0, msg: 'Success' };
}

async function updateProfile(openid, data) {
    const { _id, ...profileData } = data;
    await db.collection('users').doc(_id).update({
        data: { ...profileData, updated_at: Date.now() }
    });
    return { code: 0, msg: 'Success' };
}

async function auditUser(openid, data) {
  const { targetUserId, action, reason } = data;
  
  // 1. Permission Check (权限校验)
  // Allow if openid is Zhang Aobo (ogy8910SfgDnCCWJcz7VR2K3GOiI)
  // OR if user role is local_admin
  const adminRes = await db.collection('users').where({ _openid: openid }).get();
  if (adminRes.data.length === 0) return { code: 403, msg: 'User not found' };
  
  const adminUser = adminRes.data[0];
  
  // 判断逻辑：
  // 1. 检查当前调用者的 OpenID 是否等于超级管理员（张奥博）的 ID 'ogy8910SfgDnCCWJcz7VR2K3GOiI'
  const isSuperAdmin = openid === 'ogy8910SfgDnCCWJcz7VR2K3GOiI'; // Zhang Aobo (超级管理员)
  
  // 2. 检查当前调用者的角色是否为 'local_admin' (村委/团委)
  const isLocalAdmin = adminUser.role === 'local_admin';
  
  // 只有满足其中一个条件才允许操作
  if (!isSuperAdmin && !isLocalAdmin) {
    return { code: 403, msg: 'Permission denied: Only Village Committee or Administrator can audit users' };
  }

  if (!['approve', 'reject'].includes(action)) {
    return { code: 400, msg: 'Invalid action' };
  }

  // 2. Get target user
  const targetUserRes = await db.collection('users').doc(targetUserId).get();
  if (!targetUserRes.data) return { code: 404, msg: 'Target user not found' };
  const targetUser = targetUserRes.data;

  // 3. Update logic
  let updateData = {
    status: action === 'approve' ? 'active' : 'rejected',
    audit_record: {
      auditor_id: adminUser._id,
      auditor_name: adminUser.name,
      action: action,
      reason: reason || '',
      time: Date.now()
    },
    updated_at: Date.now()
  };

  if (action === 'approve') {
    // Construct available_roles if not present or append
    let availableRoles = targetUser.available_roles || [];
    const roleCode = targetUser.role;
    
    // Check if role already exists in availableRoles
    const roleExists = availableRoles.some(r => r.role_code === roleCode);
    
    if (!roleExists) {
      // Define default role names and contexts
      const roleConfigs = {
        farmer: { name: '农商户', context: {} },
        teacher_student: { name: '高校师生', context: {} },
        local_admin: { name: '村委/团委', context: {} },
        general_user: { name: '普通用户', context: {} }
      };
      
      const config = roleConfigs[roleCode] || roleConfigs.general_user;
      
      availableRoles.push({
        role_code: roleCode,
        role_name: config.name,
        context: config.context
      });
      
      updateData.available_roles = availableRoles;
      
      // If no current context, set it
      if (!targetUser.current_context || Object.keys(targetUser.current_context).length === 0) {
        updateData.current_context = config.context;
      }
    }
  }

  await db.collection('users').doc(targetUserId).update({
    data: updateData
  });

  return { code: 0, msg: `User ${action}d successfully` };
}

async function listPendingUsers(openid, data) {
  // 1. Permission Check (权限校验)
  const adminRes = await db.collection('users').where({ _openid: openid }).get();
  if (adminRes.data.length === 0) return { code: 403, msg: 'User not found' };
  
  const adminUser = adminRes.data[0];
  
  // 同样使用双重校验机制：
  // 1. 硬编码的超级管理员 OpenID (张奥博)
  const isSuperAdmin = openid === 'ogy8910SfgDnCCWJcz7VR2K3GOiI'; // Zhang Aobo
  // 2. 角色权限校验
  const isLocalAdmin = adminUser.role === 'local_admin';
  
  if (!isSuperAdmin && !isLocalAdmin) {
    return { code: 403, msg: 'Permission denied' };
  }

  // 2. Query
  const { page = 1, pageSize = 20 } = data || {};
  const skip = (page - 1) * pageSize;

  const countResult = await db.collection('users').where({ status: 'pending' }).count();
  const listResult = await db.collection('users')
    .where({ status: 'pending' })
    .orderBy('created_at', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get();

  return {
    code: 0,
    data: {
      list: listResult.data,
      total: countResult.total,
      page,
      pageSize
    }
  };
}
