/**
 * Fetch policies from mocked source or external API
 * This script can be run locally or required by cloud function
 */
async function fetchPolicies() {
  console.log('Starting policy fetch...');
  const policies = [];

  // Mock data representing what would be scraped
  const mockData = [
    {
      title: '关于印发《连平县2025年农业产业发展扶持政策》的通知',
      url: 'http://www.lianping.gov.cn/policy/2025/001.html',
      date: '2025-01-15',
      summary: '为进一步推动我县农业高质量发展，提高农民收入，特制定本扶持政策。主要内容包括：加大对特色农产品种植的补贴力度，每亩补贴提高至500元；支持农业龙头企业建设冷链物流设施，最高补贴100万元；鼓励返乡创业，提供最高20万元免息贷款。'
    },
    {
      title: '连平县科技局关于申报2024年度农业科技项目的通知',
      url: 'http://www.lianping.gov.cn/science/2024/005.html',
      date: '2024-11-20',
      summary: '重点支持智慧农业、绿色防控、新品种培育等领域的科技攻关项目。单个项目最高资助20万元。申报主体需为县内注册的农业企业或合作社。申报截止日期：2024年12月31日。'
    },
    {
       title: '连平县人民政府办公室关于印发连平县2024年惠农政策汇编的通知',
       url: 'http://www.lianping.gov.cn/gov/2024/008.html',
       date: '2024-10-01',
       summary: '汇编了2024年中央、省、市、县四级惠农政策，涵盖种粮补贴、农机购置补贴、农业保险保费补贴等30余项政策。'
    },
    {
       title: '关于开展2025年新型职业农民培育工程的通知',
       url: 'http://www.lianping.gov.cn/gov/2025/002.html',
       date: '2025-02-10',
       summary: '计划培育新型职业农民500人，培训内容包括现代农业生产技术、农业经营管理、电子商务等。培训免费，并提供食宿补助。'
    }
  ];

  for (const item of mockData) {
      policies.push({
          title: item.title,
          summary: item.summary,
          sourceUrl: item.url,
          publishDate: item.date,
          fetchDate: new Date()
      });
  }

  return policies;
}

module.exports = { fetchPolicies };

if (require.main === module) {
    fetchPolicies().then(p => console.log(JSON.stringify(p, null, 2))).catch(console.error);
}
