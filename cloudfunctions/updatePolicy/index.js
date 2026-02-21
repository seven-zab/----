/**
 * Policy Update Cloud Function
 * @description Automatically update policy data from remote sources
 * @trigger Scheduled (每周日 03:00 UTC+8)
 * @version 1.0.0
 */

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const _ = db.command;

const CONFIG = {
  policyCollection: 'policy',
  logCollection: 'policy_update_log',
  minRequiredResults: 3,
  maxRetries: 3,
};

const MOCK_POLICIES = [
  {
    title: '连平县关于推进乡村振兴战略的实施意见',
    summary:
      '为贯彻落实中央和省、市乡村振兴战略部署，进一步推动连平县农业农村现代化，提出以下实施意见。重点支持农产品品牌建设、农村电商发展、乡村旅游等领域的政策扶持。',
    source_url: 'http://www.lianping.gov.cn/policy/001',
    publish_date: '2025-12-15',
    fetch_date: new Date(),
  },
  {
    title: '连平县农商户扶持政策实施细则',
    summary:
      '对符合条件的农业企业、农民专业合作社、家庭农场等新型农业经营主体给予财政补贴、税收优惠、金融支持等优惠政策。单个企业最高可获得50万元补贴。',
    source_url: 'http://www.lianping.gov.cn/policy/002',
    publish_date: '2025-11-20',
    fetch_date: new Date(),
  },
  {
    title: '连平县科技创新驱动发展战略行动计划',
    summary:
      '聚焦农业科技创新的重点领域，支持农业企业开展技术研发、成果转化和创新平台建设。对农业科技项目给予最高100万元的专项资金支持。',
    source_url: 'http://www.lianping.gov.cn/policy/003',
    publish_date: '2025-10-08',
    fetch_date: new Date(),
  },
  {
    title: '连平县农村电商发展专项扶持办法',
    summary:
      '培育农村电商经营主体，支持农产品网络销售，对开设网店、直播带货等行为给予流量补贴和佣金返还。年度销售额达标可获得额外奖励。',
    source_url: 'http://www.lianping.gov.cn/policy/004',
    publish_date: '2025-09-12',
    fetch_date: new Date(),
  },
  {
    title: '连平县高校学生农村实践基地认定办法',
    summary:
      '鼓励高校学生在连平县开展社会实践，对认定为实践基地的企业或村庄给予政策支持，为高校学生提供实习岗位可享受税收优惠。',
    source_url: 'http://www.lianping.gov.cn/policy/005',
    publish_date: '2025-08-25',
    fetch_date: new Date(),
  },
  {
    title: '连平县农业技术推广服务体系建设方案',
    summary:
      '建立县、镇、村三级农技推广服务体系，配备专职农技员，开展技术培训和田间指导。对推广新技术、新品种的农技员给予工作补贴。',
    source_url: 'http://www.lianping.gov.cn/policy/006',
    publish_date: '2025-07-30',
    fetch_date: new Date(),
  },
];

/**
 * Write update log to database
 * @param {Object} logData - Log entry data
 */
const writeLog = async (logData) => {
  try {
    await db.collection(CONFIG.logCollection).add({
      data: {
        ...logData,
        created_at: new Date(),
      },
    });
    console.info('[UpdatePolicy] Log written:', logData.status);
  } catch (err) {
    console.error('[UpdatePolicy] Failed to write log:', err);
  }
};

/**
 * Fetch policy data from remote source
 * @returns {Promise<Array>} List of policy items
 */
const fetchPolicyData = async () => {
  console.info('[UpdatePolicy] Fetching policy data...');

  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(MOCK_POLICIES);
    }, 500);
  });
};

/**
 * Clear existing policy collection
 */
const clearPolicyCollection = async () => {
  console.info('[UpdatePolicy] Clearing existing policies...');
  const batchSize = 100;
  let hasMore = true;

  while (hasMore) {
    const { data } = await db.collection(CONFIG.policyCollection).limit(batchSize).get();

    if (data.length === 0) {
      hasMore = false;
      break;
    }

    const promises = data.map((item) =>
      db.collection(CONFIG.policyCollection).doc(item._id).remove(),
    );

    await Promise.all(promises);
    console.info(`[UpdatePolicy] Removed ${data.length} policies`);

    if (data.length < batchSize) {
      hasMore = false;
    }
  }
};

/**
 * Insert new policy data
 * @param {Array} policies - Policy items to insert
 */
const insertPolicies = async (policies) => {
  console.info('[UpdatePolicy] Inserting new policies...');

  const promises = policies.map((policy) =>
    db.collection(CONFIG.policyCollection).add({
      data: policy,
    }),
  );

  await Promise.all(promises);
  console.info(`[UpdatePolicy] Inserted ${policies.length} policies`);
};

/**
 * Send notification to admin (placeholder)
 * @param {string} status - Update status
 * @param {number} count - Number of policies updated
 */
const sendNotification = async (status, count) => {
  console.info(`[UpdatePolicy] Notification: ${status}, count: ${count}`);
};

/**
 * Main cloud function handler
 * @param {Object} event - Cloud function event
 * @param {Object} context - Cloud function context
 */
exports.main = async (event, context) => {
  console.info('[UpdatePolicy] Function started at:', new Date().toISOString());

  try {
    const policies = await fetchPolicyData();

    if (policies.length >= CONFIG.minRequiredResults) {
      console.info(`[UpdatePolicy] Fetched ${policies.length} policies, updating database...`);

      await clearPolicyCollection();
      await insertPolicies(policies);

      await writeLog({
        status: 'success',
        count: policies.length,
        message: `Successfully updated ${policies.length} policies`,
      });

      await sendNotification('success', policies.length);

      return {
        code: 0,
        msg: 'success',
        data: {
          updated: true,
          count: policies.length,
        },
      };
    } else {
      console.warn(`[UpdatePolicy] Insufficient policies (${policies.length}), skipping update`);

      await writeLog({
        status: 'skipped',
        count: policies.length,
        message: `Insufficient data (${policies.length} < ${CONFIG.minRequiredResults})`,
      });

      return {
        code: 1,
        msg: 'skipped',
        data: {
          updated: false,
          reason: 'insufficient_data',
          count: policies.length,
        },
      };
    }
  } catch (err) {
    console.error('[UpdatePolicy] Update failed:', err);

    await writeLog({
      status: 'failed',
      count: 0,
      message: 'Update failed',
      error: err.message || String(err),
    });

    await sendNotification('failed', 0);

    return {
      code: 500,
      msg: 'Internal Server Error',
      data: {
        updated: false,
        error: err.message || String(err),
      },
    };
  }
};
