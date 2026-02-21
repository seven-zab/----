<template>
  <view class="container">
    <!-- 需求类型选择 -->
    <view class="type-selector">
      <view
        class="type-item"
        :class="{ active: demandType === 'enterprise' }"
        @click="changeType('enterprise')"
      >
        <text class="type-icon">企</text>
        <text class="type-name">企需通</text>
      </view>
      <view
        class="type-item"
        :class="{ active: demandType === 'agriculture' }"
        @click="changeType('agriculture')"
      >
        <text class="type-icon">农</text>
        <text class="type-name">农践帮</text>
      </view>
      <view
        class="type-item"
        :class="{ active: demandType === 'research' }"
        @click="changeType('research')"
      >
        <text class="type-icon">研</text>
        <text class="type-name">科研实践厅</text>
      </view>
    </view>

    <!-- 基础信息 -->
    <view class="form-section">
      <view class="section-title">基础信息</view>

      <view class="form-item">
        <view class="label">需求标题</view>
        <wd-input v-model="formData.title" placeholder="请输入需求标题" />
      </view>

      <view class="form-item">
        <view class="label">需求类型</view>
        <wd-radio-group v-model="formData.subType" v-if="demandType === 'enterprise'">
          <wd-radio value="production_tech">生产技术</wd-radio>
          <wd-radio value="talent_recruit">人才引进</wd-radio>
        </wd-radio-group>
        <wd-radio-group v-model="formData.subType" v-if="demandType === 'agriculture'">
          <wd-radio value="harvest">采摘打包</wd-radio>
          <wd-radio value="sales">销售(电商)</wd-radio>
        </wd-radio-group>
        <wd-radio-group v-model="formData.subType" v-if="demandType === 'research'">
          <wd-radio value="planting">种植技术(农业)</wd-radio>
          <wd-radio value="mechanical">机械技术(硬)</wd-radio>
          <wd-radio value="intelligent">智能技术(软)</wd-radio>
        </wd-radio-group>
      </view>

      <view class="form-item">
        <view class="label">需求描述</view>
        <wd-textarea
          v-model="formData.content"
          placeholder="请详细描述您的需求..."
          :maxlength="200"
        />
        <text class="char-count">{{ formData.content.length }}/200</text>
      </view>
    </view>

    <!-- 企需通扩展字段 -->
    <view class="form-section" v-if="demandType === 'enterprise'">
      <view class="section-title">扩展信息</view>

      <view class="form-item">
        <view class="label">期望合作周期</view>
        <wd-radio-group v-model="formData.coopPeriod">
          <wd-radio value="1个月以内">1个月以内</wd-radio>
          <wd-radio value="1-3个月">1-3个月</wd-radio>
          <wd-radio value="长期">长期</wd-radio>
        </wd-radio-group>
      </view>

      <view class="form-item">
        <view class="label">预算区间</view>
        <wd-radio-group v-model="formData.budget">
          <wd-radio value="1万以下">1万以下</wd-radio>
          <wd-radio value="1-5万">1-5万</wd-radio>
          <wd-radio value="5万以上">5万以上</wd-radio>
        </wd-radio-group>
      </view>

      <view class="form-item">
        <view class="label">企业规模</view>
        <wd-radio-group v-model="formData.companyScale">
          <wd-radio value="初创">初创</wd-radio>
          <wd-radio value="中小型">中小型</wd-radio>
          <wd-radio value="大型">大型</wd-radio>
        </wd-radio-group>
      </view>

      <view class="form-item">
        <view class="label">紧急程度</view>
        <wd-radio-group v-model="formData.urgency">
          <wd-radio value="普通">普通</wd-radio>
          <wd-radio value="紧急">紧急</wd-radio>
          <wd-radio value="特急">特急</wd-radio>
        </wd-radio-group>
      </view>

      <view class="form-item">
        <view class="label">附件上传</view>
        <view class="upload-btn" @click="uploadFile('enterprise')">+ 上传文件</view>
        <text class="upload-tip">支持 PDF/Docx, 最大 10MB</text>
        <view v-if="formData.attachment" class="file-list">
          <view class="file-item">{{ formData.attachment.name }}</view>
        </view>
      </view>
    </view>

    <!-- 农践帮扩展字段 -->
    <view class="form-section" v-if="demandType === 'agriculture'">
      <view class="section-title">扩展信息</view>

      <view class="form-item" v-if="formData.subType === 'sales'">
        <view class="label">直播地点</view>
        <wd-radio-group v-model="formData.liveLocation">
          <wd-radio value="校内直播基地">校内直播基地</wd-radio>
          <wd-radio value="果园(当地)直播">果园(当地)直播</wd-radio>
        </wd-radio-group>
      </view>

      <view class="form-item">
        <view class="label">农产品种类</view>
        <wd-radio-group v-model="formData.productType">
          <wd-radio value="水果">水果</wd-radio>
          <wd-radio value="蔬菜">蔬菜</wd-radio>
          <wd-radio value="粮油">粮油</wd-radio>
          <wd-radio value="其他">其他</wd-radio>
        </wd-radio-group>
      </view>

      <view class="form-item">
        <view class="label">预计产量(kg)</view>
        <wd-input v-model="formData.estimatedYield" type="number" placeholder="请输入预计产量" />
      </view>

      <view class="form-item">
        <view class="label">物流支持需求</view>
        <wd-radio-group v-model="formData.logistics">
          <wd-radio value="自理">自理</wd-radio>
          <wd-radio value="需协助">需协助</wd-radio>
          <wd-radio value="全包">全包</wd-radio>
        </wd-radio-group>
      </view>

      <view class="form-item">
        <view class="label">帮扶时间段</view>
        <wd-radio-group v-model="formData.helpPeriod">
          <wd-radio value="周末">周末</wd-radio>
          <wd-radio value="寒暑假">寒暑假</wd-radio>
          <wd-radio value="工作日">工作日</wd-radio>
        </wd-radio-group>
      </view>

      <view class="form-item">
        <view class="label">现场照片</view>
        <view class="image-grid">
          <view v-for="(img, index) in formData.images" :key="index" class="image-item">
            <image :src="img" mode="aspectFill" />
            <view class="delete-btn" @click="deleteImage(index)">×</view>
          </view>
          <view v-if="formData.images.length < 9" class="add-image" @click="uploadImage"> + </view>
        </view>
        <text class="upload-tip">最多上传9张</text>
      </view>
    </view>

    <!-- 科研实践厅扩展字段 -->
    <view class="form-section" v-if="demandType === 'research'">
      <view class="section-title">扩展信息</view>

      <view class="form-item">
        <view class="label">项目阶段</view>
        <wd-radio-group v-model="formData.projectStage">
          <wd-radio value="需求调研">需求调研</wd-radio>
          <wd-radio value="研发攻关">研发攻关</wd-radio>
          <wd-radio value="成果转化">成果转化</wd-radio>
        </wd-radio-group>
      </view>

      <view class="form-item">
        <view class="label">拟合作高校</view>
        <wd-input v-model="formData.targetUniversity" placeholder="请输入高校名称" />
      </view>

      <view class="form-item">
        <view class="label">经费支持</view>
        <wd-radio-group v-model="formData.funding">
          <wd-radio value="无">无</wd-radio>
          <wd-radio value="自筹">自筹</wd-radio>
          <wd-radio value="申请补贴">申请补贴</wd-radio>
        </wd-radio-group>
      </view>

      <view class="form-item">
        <view class="label">实验场地条件</view>
        <wd-checkbox-group v-model="formData.labConditions">
          <wd-checkbox value="实验室">实验室</wd-checkbox>
          <wd-checkbox value="试验田">试验田</wd-checkbox>
          <wd-checkbox value="工厂车间">工厂车间</wd-checkbox>
        </wd-checkbox-group>
      </view>

      <view class="form-item">
        <view class="label">技术文档</view>
        <view class="upload-btn" @click="uploadFile('research')">+ 上传文件</view>
        <text class="upload-tip">上传需求书/图纸等</text>
      </view>
    </view>

    <!-- 通用附件上传（可选） -->
    <view class="form-section">
      <view class="section-title">附件上传 <text class="optional">(可选)</text></view>

      <view class="form-item">
        <view class="label">手机照片</view>
        <view class="image-grid">
          <view
            v-for="(img, index) in formData.attachments.filter((a) => a.type === 'image')"
            :key="'img-' + index"
            class="image-item"
          >
            <image :src="img.url" mode="aspectFill" />
            <view class="delete-btn" @click="deleteAttachment(index, 'image')">×</view>
          </view>
          <view
            v-if="formData.attachments.filter((a) => a.type === 'image').length < 5"
            class="add-image"
            @click="uploadAttachment('image')"
          >
            +
          </view>
        </view>
        <text class="upload-tip">最多上传5张</text>
      </view>

      <view class="form-item">
        <view class="label">微信文件</view>
        <view class="file-list">
          <view
            v-for="(file, index) in formData.attachments.filter((a) => a.type === 'file')"
            :key="'file-' + index"
            class="file-item"
          >
            <text class="file-name">{{ file.name }}</text>
            <view class="delete-btn" @click="deleteAttachment(index, 'file')">×</view>
          </view>
          <view
            v-if="formData.attachments.filter((a) => a.type === 'file').length < 3"
            class="upload-btn"
            @click="uploadAttachment('file')"
            >+ 上传文件</view
          >
        </view>
        <text class="upload-tip">支持 PDF/Word/Excel，最大 10MB/个</text>
      </view>
    </view>

    <!-- 提交按钮 -->
    <view class="submit-area">
      <wd-button type="primary" block @click="submit" :loading="loading">提交审核</wd-button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useUserStore } from '@/stores/user';

// 声明 wx 对象，避免 TS 报错
declare const wx: any;

const userStore = useUserStore();
const demandType = ref('enterprise');
const loading = ref(false);

const formData = reactive({
  title: '',
  subType: '',
  content: '',
  coopPeriod: '',
  budget: '',
  companyScale: '',
  urgency: '',
  attachment: null as any,
  liveLocation: '',
  productType: '',
  estimatedYield: '',
  logistics: '',
  helpPeriod: '',
  images: [] as string[],
  projectStage: '',
  targetUniversity: '',
  funding: '',
  labConditions: [] as string[],
  attachments: [] as any[],
});

onMounted(() => {
  const pages = getCurrentPages();
  const page = pages[pages.length - 1] as any;
  const options = page.options || {};
  if (options.type) {
    demandType.value = options.type;
  }
});

const changeType = (type: string) => {
  demandType.value = type;
};

const uploadImage = () => {
  console.log('uploadImage triggered');
  // #ifdef MP-WEIXIN
  uni.chooseImage({
    count: 9 - formData.images.length,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: (res) => {
      console.log('chooseImage success', res);
      if (Array.isArray(res.tempFilePaths)) {
        res.tempFilePaths.forEach((path) => {
          uni.showLoading({ title: '上传中...' });
          const cloudPath = `demands/${Date.now()}-${Math.random()}.jpg`;

          wx.cloud.uploadFile({
            cloudPath,
            filePath: path,
            success: (uploadRes: any) => {
              console.log('uploadFile success', uploadRes);
              formData.images.push(uploadRes.fileID);
              uni.hideLoading();
            },
            fail: (err: any) => {
              console.error('Upload failed', err);
              uni.hideLoading();
              uni.showToast({ title: '上传失败', icon: 'none' });
            },
          });
        });
      }
    },
    fail: (err) => {
      console.log('chooseImage cancelled or failed', err);
    }
  });
  // #endif
  // #ifndef MP-WEIXIN
  uni.showToast({ title: '请在微信小程序中操作', icon: 'none' });
  // #endif
};

const deleteImage = (index: number) => {
  formData.images.splice(index, 1);
};

const uploadAttachment = (type: 'image' | 'file') => {
  console.log('uploadAttachment triggered', type);
  // #ifdef MP-WEIXIN
  if (type === 'image') {
    uni.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const path = res.tempFilePaths[0];
        uni.showLoading({ title: '上传中...' });
        const cloudPath = `attachments/${Date.now()}-${Math.random()}.jpg`;

        wx.cloud.uploadFile({
          cloudPath,
          filePath: path,
          success: (uploadRes: any) => {
            formData.attachments.push({
              type: 'image',
              url: uploadRes.fileID,
            });
            uni.hideLoading();
            uni.showToast({ title: '上传成功', icon: 'success' });
          },
          fail: (err: any) => {
            console.error('Upload failed', err);
            uni.hideLoading();
            uni.showToast({ title: '上传失败', icon: 'none' });
          },
        });
      },
      fail: (err) => {
        console.log('chooseImage cancelled', err);
      },
    });
  } else {
    uni.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['pdf', 'doc', 'docx', 'xls', 'xlsx'],
      success: (res) => {
        console.log('chooseMessageFile success', res);
        const file = res.tempFiles[0];
        uni.showLoading({ title: '上传中...' });
        const cloudPath = `attachments/${Date.now()}-${file.name}`;

        wx.cloud.uploadFile({
          cloudPath,
          filePath: file.path,
          success: (uploadRes: any) => {
            formData.attachments.push({
              type: 'file',
              name: file.name,
              url: uploadRes.fileID,
            });
            uni.hideLoading();
            uni.showToast({ title: '上传成功', icon: 'success' });
          },
          fail: (err: any) => {
            console.error('Upload failed', err);
            uni.hideLoading();
            uni.showToast({ title: '上传失败', icon: 'none' });
          },
        });
      },
      fail: (err) => {
        console.error('chooseMessageFile failed', err);
        // uni.showToast({ title: '取消选择或选择失败', icon: 'none' }); // 暂时注释，避免误报
      },
    });
  }
  // #endif
  // #ifndef MP-WEIXIN
  uni.showToast({ title: '请在微信小程序中操作', icon: 'none' });
  // #endif
};

const deleteAttachment = (index: number, type: 'image' | 'file') => {
  const filtered = formData.attachments.filter((a) => a.type === type);
  const originalIndex = formData.attachments.indexOf(filtered[index]);
  if (originalIndex > -1) {
    formData.attachments.splice(originalIndex, 1);
  }
};

const uploadFile = (type: string) => {
  console.log('uploadFile triggered', type);
  const ext = type === 'enterprise' ? 'pdf,doc,docx' : 'pdf,doc,docx,xls,xlsx';

  // #ifdef MP-WEIXIN
  uni.chooseMessageFile({
    count: 1,
    type: 'file',
    extension: ext.split(','),
    success: (res) => {
      const file = res.tempFiles[0];
      uni.showLoading({ title: '上传中...' });

      const cloudPath = `documents/${Date.now()}-${file.name}`;

      wx.cloud.uploadFile({
        cloudPath,
        filePath: file.path,
        success: (uploadRes: any) => {
          formData.attachment = {
            name: file.name,
            url: uploadRes.fileID,
          };
          uni.hideLoading();
          uni.showToast({ title: '上传成功', icon: 'success' });
        },
        fail: (err: any) => {
          console.error('Upload failed', err);
          uni.hideLoading();
          uni.showToast({ title: '上传失败', icon: 'none' });
        },
      });
    },
    fail: (err) => {
      console.error('chooseMessageFile failed', err);
      uni.showToast({ title: '取消选择或选择失败', icon: 'none' });
    },
  });
  // #endif
  // #ifndef MP-WEIXIN
  uni.showToast({ title: '请在微信小程序中操作', icon: 'none' });
  // #endif
};

const submit = async () => {
  if (!formData.title || !formData.content) {
    uni.showToast({ title: '请填写完整信息', icon: 'none' });
    return;
  }

  if (userStore.role !== 'farmer' && userStore.role !== 'local_admin') {
    uni.showToast({ title: '只有认证农户或村委才能发布需求', icon: 'none' });
    return;
  }

  loading.value = true;
  try {
    const submitData = {
      title: formData.title,
      content: formData.content,
      type: demandType.value,
      subType: formData.subType,
      images: formData.images,
      extra: {},
    };

    if (demandType.value === 'enterprise') {
      submitData.extra = {
        coopPeriod: formData.coopPeriod,
        budget: formData.budget,
        companyScale: formData.companyScale,
        urgency: formData.urgency,
        attachment: formData.attachment,
      };
    } else if (demandType.value === 'agriculture') {
      submitData.extra = {
        liveLocation: formData.liveLocation,
        productType: formData.productType,
        estimatedYield: formData.estimatedYield,
        logistics: formData.logistics,
        helpPeriod: formData.helpPeriod,
      };
    } else if (demandType.value === 'research') {
      submitData.extra = {
        projectStage: formData.projectStage,
        targetUniversity: formData.targetUniversity,
        funding: formData.funding,
        labConditions: formData.labConditions,
        attachment: formData.attachment,
      };
    }

    if (formData.attachments && formData.attachments.length > 0) {
      submitData.attachments = formData.attachments;
    }

    const { result } = await wx.cloud.callFunction({
      name: 'demandService',
      data: {
        action: 'create',
        data: submitData,
      },
    });

    loading.value = false;
    if (result.code === 0) {
      uni.showToast({ title: '提交成功', icon: 'success' });
      setTimeout(() => {
        uni.navigateBack();
      }, 1500);
    } else {
      uni.showToast({ title: result.msg || '提交失败', icon: 'none' });
    }
  } catch (e) {
    loading.value = false;
    uni.showToast({ title: '提交失败', icon: 'none' });
  }
};
</script>

<style lang="scss" scoped>
.container {
  min-height: 100vh;
  background-color: #f5f5f5;
  padding: 20rpx;
  padding-bottom: 120rpx;
}

.type-selector {
  display: flex;
  background-color: #fff;
  border-radius: 16rpx;
  padding: 20rpx;
  margin-bottom: 20rpx;

  .type-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 20rpx;
    border-radius: 12rpx;
    transition: all 0.2s;

    &.active {
      background-color: #e6f7ff;

      .type-icon {
        background: linear-gradient(135deg, #1890ff, #36cfc9);
      }
    }

    .type-icon {
      width: 80rpx;
      height: 80rpx;
      border-radius: 16rpx;
      background-color: #eee;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 36rpx;
      font-weight: bold;
      margin-bottom: 10rpx;
    }

    .type-name {
      font-size: 24rpx;
      color: #666;
    }
  }
}

.form-section {
  background-color: #fff;
  border-radius: 16rpx;
  padding: 30rpx;
  margin-bottom: 20rpx;

  .section-title {
    font-size: 32rpx;
    font-weight: bold;
    margin-bottom: 30rpx;
    color: #333;
    border-left: 8rpx solid #1890ff;
    padding-left: 16rpx;

    .optional {
      font-size: 24rpx;
      font-weight: normal;
      color: #999;
      margin-left: 10rpx;
    }
  }

  .form-item {
    margin-bottom: 30rpx;

    .label {
      font-size: 28rpx;
      font-weight: bold;
      margin-bottom: 16rpx;
      color: #333;
    }

    .char-count {
      font-size: 24rpx;
      color: #999;
      display: block;
      text-align: right;
    }

    .upload-tip {
      font-size: 24rpx;
      color: #999;
      margin-top: 10rpx;
      display: block;
    }

    .upload-btn {
      width: 200rpx;
      height: 80rpx;
      line-height: 80rpx;
      text-align: center;
      border: 2rpx dashed #ddd;
      border-radius: 12rpx;
      font-size: 28rpx;
      color: #999;
    }

    .file-list {
      margin-top: 20rpx;

      .file-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16rpx;
        background-color: #f5f5f5;
        border-radius: 8rpx;
        margin-bottom: 10rpx;

        .file-name {
          font-size: 26rpx;
          color: #666;
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .delete-btn {
          width: 36rpx;
          height: 36rpx;
          background-color: #ff4d4f;
          color: #fff;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24rpx;
          margin-left: 10rpx;
        }
      }
    }

    .image-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 20rpx;

      .image-item {
        width: 160rpx;
        height: 160rpx;
        position: relative;
        border-radius: 12rpx;
        overflow: hidden;

        image {
          width: 100%;
          height: 100%;
        }

        .delete-btn {
          position: absolute;
          top: 5rpx;
          right: 5rpx;
          width: 36rpx;
          height: 36rpx;
          background-color: rgba(0, 0, 0, 0.5);
          color: #fff;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24rpx;
        }
      }

      .add-image {
        width: 160rpx;
        height: 160rpx;
        border: 2rpx dashed #ddd;
        border-radius: 12rpx;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 60rpx;
        color: #ddd;
      }
    }
  }
}

.submit-area {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 20rpx;
  background-color: #fff;
  box-shadow: 0 -2rpx 10rpx rgba(0, 0, 0, 0.05);
}
</style>
