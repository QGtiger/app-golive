/**
 * OSS 直传适配（docs/TECHNICAL.md §5.4）：
 * 服务端不签发临时凭证，由主进程用用户配置的长期凭据直传。
 * 文件按本地路径整份上传，Content-Type 由 SDK 依扩展名推断。
 * SDK 通过 require 延迟加载：只有真正开始发布才会引入 ali-oss。
 */
export interface UploadInput {
  /** 本地文件绝对路径 */
  absolute: string
  /** OSS 对象键：{appId}/{version}/{相对路径} */
  key: string
}

export interface OssUploader {
  upload(input: UploadInput): Promise<void>
}

export function createOssUploader(options: {
  region: string
  bucket: string
  accessKeyId: string
  accessKeySecret: string
}): OssUploader {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const OSS = require('ali-oss')
  // timeout：单请求 60s 超时；secure：HTTPS 直连
  const client = new OSS({
    region: options.region,
    bucket: options.bucket,
    accessKeyId: options.accessKeyId,
    accessKeySecret: options.accessKeySecret,
    timeout: 60000,
    secure: true
  })
  return {
    async upload(input) {
      await client.put(input.key, input.absolute)
    }
  }
}
