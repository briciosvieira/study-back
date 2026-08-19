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

  objectExists(key: string): Promise<boolean>;

  delete(key: string): Promise<void>;

  getPublicUrl(key: string): string;
}
