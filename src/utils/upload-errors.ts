export function imageUploadFailure(error: { errMsg?: string } | undefined): Error {
  const detail = error?.errMsg ?? '';
  if (/not in domain list|domain.*(?:not|invalid|list)|合法域名/iu.test(detail))
    return new Error('图片上传地址尚未开通，请联系管理员配置上传域名后重试');
  if (/timeout|timed out/iu.test(detail))
    return new Error('图片上传超时，请切换网络后重新选择图片');
  if (/ssl|tls|certificate|证书/iu.test(detail))
    return new Error('图片上传连接验证失败，请联系管理员检查安全连接');
  return new Error('图片未能上传，请检查网络后重新选择图片');
}

export function imageUploadStatusFailure(status: number): Error {
  if (status === 403) return new Error('图片上传凭据已失效或被拒绝，请重新选择图片后重试');
  if (status === 413) return new Error('图片超过上传大小限制，请压缩后重新选择');
  return new Error('图片上传未成功，请重新选择后重试');
}
