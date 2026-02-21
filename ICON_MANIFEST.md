# 小程序 TabBar 图标修复清单

## 1. 修复概述
我们已将原先配置错误的 `default-avatar.png` 替换为规范的 `src/static/tabbar/` 目录结构。
**最新状态**: 已生成一套符合规范的几何图形图标（PNG格式），不再是头像占位符。

## 2. 图标文件清单
文件位于 `src/static/tabbar/`：

| 页面 | 状态 | 文件路径 | 图形描述 |
| :--- | :--- | :--- | :--- |
| **首页** | 未选中 | `src/static/tabbar/home.png` | 灰色房子图标 |
| **首页** | 选中 | `src/static/tabbar/home-active.png` | 蓝色房子图标 |
| **消息** | 未选中 | `src/static/tabbar/chat.png` | 灰色气泡图标 |
| **消息** | 选中 | `src/static/tabbar/chat-active.png` | 蓝色气泡图标 |
| **我的** | 未选中 | `src/static/tabbar/user.png` | 灰色用户头像图标 |
| **我的** | 选中 | `src/static/tabbar/user-active.png` | 蓝色用户头像图标 |

## 3. 设计规范 (Design Specs)
当前图标由脚本生成，参数如下：
- **格式**: PNG
- **尺寸**: 81px × 81px (3x)
- **色彩**: 
  - 未选中态: `#999999`
  - 选中态: `#007AFF`

## 4. 自动化测试建议
由于环境限制，我们建议您在本地开发环境中安装 `miniprogram-simulate` 进行单元测试。

### 安装依赖
```bash
npm install --save-dev miniprogram-simulate jest
```

### 测试脚本示例 (`test/tabbar.test.js`)
```javascript
const simulate = require('miniprogram-simulate');
const path = require('path');

test('TabBar configuration check', () => {
  const appConfig = require('../src/pages.json'); // 调整路径以匹配您的构建输出
  const tabBar = appConfig.tabBar;

  expect(tabBar).toBeDefined();
  expect(tabBar.list.length).toBe(3);

  tabBar.list.forEach(item => {
    // 检查图标路径是否以 static 开头
    expect(item.iconPath).toMatch(/^static\//);
    expect(item.selectedIconPath).toMatch(/^static\//);
    
    // 这里可以结合 fs 模块检查文件是否存在
    // const fs = require('fs');
    // expect(fs.existsSync(path.join(__dirname, '../src', item.iconPath))).toBe(true);
  });
});
```

## 5. 常见问题排查
如果在真机上图标不显示：
1. **检查路径**: 确认 `pages.json` 中路径不以 `/` 开头（如 `static/...` 是正确的，`/static/...` 可能在某些版本有问题，但在 Uni-app 中通常会自动处理）。
2. **检查分包**: 确认 `static/tabbar` 目录未被配置到 `subPackages` 中。TabBar 图标必须在主包。
3. **清理缓存**: 微信开发者工具 -> 清除缓存 -> 全部清除。
