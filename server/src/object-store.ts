import COS from "cos-nodejs-sdk-v5";

export type SignedUpload = {
  url: string;
  headers: Record<string, string>;
  expiresIn: number;
};

export type ObjectMetadata = {
  byteSize: number;
  sha256: string;
  versionId?: string;
  serverSideEncryption: string;
};

export interface ObjectStore {
  readonly configured: boolean;
  readonly backupDeletionConfigured: boolean;
  signUpload(key: string, input: {
    mimeType: string;
    byteSize: number;
    sha256: string;
    expiresIn: number;
  }): Promise<SignedUpload>;
  signDownload(key: string, expiresIn: number): Promise<string>;
  head(key: string): Promise<ObjectMetadata>;
  deleteAllVersions(key: string): Promise<void>;
  deleteAllBackupVersions(key: string): Promise<void>;
}

export class TencentCosObjectStore implements ObjectStore {
  readonly configured: boolean;
  readonly backupDeletionConfigured: boolean;
  private readonly client: COS;
  private readonly backupClient: COS | null;
  private readonly bucket: string;
  private readonly backupBucket: string;
  private readonly region: string;
  private readonly backupRegion: string;

  constructor(options: {
    secretId: string;
    secretKey: string;
    backupSecretId: string;
    backupSecretKey: string;
    bucket: string;
    backupBucket: string;
    backupRegion: string;
    region: string;
  }) {
    this.configured = [
      options.secretId,
      options.secretKey,
      options.bucket,
      options.region
    ].every((value) => value.trim().length > 0);
    this.client = new COS({
      SecretId: options.secretId,
      SecretKey: options.secretKey,
      Protocol: "https:",
      Timeout: 15_000,
      KeepAlive: true,
      ForceSignHost: true
    });
    this.backupDeletionConfigured = Boolean(
      options.backupBucket && options.backupSecretId && options.backupSecretKey
    );
    this.backupClient = this.backupDeletionConfigured
      ? new COS({
          SecretId: options.backupSecretId,
          SecretKey: options.backupSecretKey,
          Protocol: "https:",
          Timeout: 15_000,
          KeepAlive: true,
          ForceSignHost: true
        })
      : null;
    this.bucket = options.bucket;
    this.backupBucket = options.backupBucket;
    this.region = options.region;
    this.backupRegion = options.backupRegion;
  }

  private assertConfigured(): void {
    if (!this.configured) throw new Error("Tencent COS is not configured.");
  }

  async signUpload(
    key: string,
    input: { mimeType: string; byteSize: number; sha256: string; expiresIn: number }
  ): Promise<SignedUpload> {
    this.assertConfigured();
    const headers: Record<string, string> = {
      "content-type": input.mimeType,
      "x-cos-meta-sha256": input.sha256,
      "x-cos-server-side-encryption": "AES256",
      // 覆盖历史上传的旧对象时必须替换元数据：早期直接写入的 COS
      // 对象缺少 x-cos-meta-sha256，若不替换，重传后服务端校验仍会失败。
      "x-cos-metadata-directive": "Replace"
    };
    const url = this.client.getObjectUrl({
      Bucket: this.bucket,
      Region: this.region,
      Key: key,
      Sign: true,
      Method: "PUT",
      Expires: input.expiresIn,
      Protocol: "https:",
      Headers: headers
    });
    return { url, headers, expiresIn: input.expiresIn };
  }

  async signDownload(key: string, expiresIn: number): Promise<string> {
    this.assertConfigured();
    return this.client.getObjectUrl({
      Bucket: this.bucket,
      Region: this.region,
      Key: key,
      Sign: true,
      Method: "GET",
      Expires: expiresIn,
      Protocol: "https:"
    });
  }

  async head(key: string): Promise<ObjectMetadata> {
    this.assertConfigured();
    const result = await this.client.headObject({
      Bucket: this.bucket,
      Region: this.region,
      Key: key
    });
    const headers = Object.fromEntries(
      Object.entries(result.headers || {}).map(([name, value]) => [name.toLocaleLowerCase(), String(value)])
    );
    const byteSize = Number(headers["content-length"] || 0);
    return {
      byteSize,
      sha256: headers["x-cos-meta-sha256"] || "",
      versionId: result.VersionId || headers["x-cos-version-id"] || undefined,
      serverSideEncryption: headers["x-cos-server-side-encryption"] || ""
    };
  }

  private async deleteVersions(client: COS, bucket: string, region: string, key: string): Promise<void> {
    if (!bucket) return;
    let marker: string | undefined;
    let versionMarker: string | undefined;
    let found = false;
    do {
      const listed = await client.listObjectVersions({
        Bucket: bucket,
        Region: region,
        Prefix: key,
        Marker: marker,
        VersionIdMarker: versionMarker,
        MaxKeys: "1000"
      });
      const objects = [
        ...(listed.Versions || []),
        ...(listed.DeleteMarkers || [])
      ]
        .filter((item) => item.Key === key)
        .map((item) => ({ Key: item.Key, VersionId: item.VersionId }));
      if (objects.length) {
        found = true;
        const deleted = await client.deleteMultipleObject({
          Bucket: bucket,
          Region: region,
          Objects: objects,
          Quiet: true
        });
        if (deleted.Error?.length) {
          throw new Error(`Tencent COS failed to delete ${deleted.Error.length} object version(s).`);
        }
      }
      marker = listed.NextMarker;
      versionMarker = listed.NextVersionIdMarker;
      if (listed.IsTruncated !== "true") break;
    } while (marker || versionMarker);

    if (!found) {
      await client.deleteObject({
        Bucket: bucket,
        Region: region,
        Key: key
      });
    }
  }

  async deleteAllVersions(key: string): Promise<void> {
    this.assertConfigured();
    await this.deleteVersions(this.client, this.bucket, this.region, key);
  }

  async deleteAllBackupVersions(key: string): Promise<void> {
    if (!this.backupClient || !this.backupDeletionConfigured) {
      throw new Error("Tencent COS backup deletion identity is not configured in this process.");
    }
    await this.deleteVersions(this.backupClient, this.backupBucket, this.backupRegion, key);
  }
}
