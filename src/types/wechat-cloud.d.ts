/** Narrow platform boundary used by this application. Business payloads stay unknown until validated. */
interface WechatCloudCallOptions {
  name: string;
  data?: object;
  config?: { env?: string };
}
interface WechatCloudQuery {
  where(filter: object): WechatCloudQuery;
  orderBy(field: string, direction: string): WechatCloudQuery;
  limit(size: number): WechatCloudQuery;
  get(): Promise<{ data: unknown[] }>;
  count(): Promise<{ total: number }>;
  doc(id: string): WechatCloudQuery;
  watch(options: {
    onChange: (snapshot: { docs: unknown[] }) => void;
    onError: (error: unknown) => void;
  }): { close(): void };
}
declare const wx: {
  onNeedPrivacyAuthorization?: (
    listener: (
      resolve: (decision: { event: 'agree'; buttonId: string } | { event: 'disagree' }) => void,
    ) => void,
  ) => void;
  getPrivacySetting?: (options: {
    success?: (result: { needAuthorization: boolean; privacyContractName: string }) => void;
    fail?: (error: { errMsg: string }) => void;
  }) => void;
  openPrivacyContract?: (options: { fail?: (error: { errMsg: string }) => void }) => void;
  requestSubscribeMessage(options: {
    tmplIds: string[];
    success: (result: Record<string, string>) => void;
    fail: (error: { errMsg: string }) => void;
  }): void;
  shareFileMessage?: (options: {
    filePath: string;
    fileName?: string;
    fail?: (error: { errMsg: string }) => void;
  }) => void;
  getFileSystemManager(): {
    readFile(options: {
      filePath: string;
      success: (result: { data: ArrayBuffer | string }) => void;
      fail: (error: { errMsg: string }) => void;
    }): void;
  };
  cloud: {
    init(options: { env: string; traceUser?: boolean }): void;
    callFunction(options: WechatCloudCallOptions): Promise<{ result: unknown }>;
    uploadFile(options: {
      cloudPath: string;
      filePath: string;
      success?: (result: { fileID: string }) => void;
      fail?: (error: { errMsg: string }) => void;
    }): Promise<{ fileID: string }>;
    database(options?: { env?: string }): { collection(name: string): WechatCloudQuery };
  };
};
