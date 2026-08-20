export interface PresignedUpload {
  uploadUrl: string;
  key: string;
  publicUrl: string;
}

export interface StorageProvider {
  presignUpload(params: {
    keyPrefix: string;
    fileName: string;
    contentType: string;
  }): Promise<PresignedUpload>;

  // Temporary GET URL that serves the object under a friendly filename
  // (Content-Disposition), instead of forcing a download of the raw storage key.
  presignDownload(params: {
    key: string;
    downloadFileName: string;
  }): Promise<string>;

  putObject(params: {
    key: string;
    body: Buffer;
    contentType: string;
    bucket?: string;
  }): Promise<void>;

  objectExists(key: string): Promise<boolean>;

  delete(key: string, bucket?: string): Promise<void>;

  getPublicUrl(key: string): string;
}
