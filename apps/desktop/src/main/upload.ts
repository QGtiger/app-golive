export interface UploadInput {
  absolute: string
  key: string
  size: number
  body?: Buffer
  contentType?: string
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
      const mime = input.contentType
      if (input.body) await client.put(input.key, input.body, mime ? { mime } : undefined)
      else await client.put(input.key, input.absolute, mime ? { mime } : undefined)
    }
  }
}
