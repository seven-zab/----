/// <reference types="@dcloudio/types" />
/// <reference types="wot-design-uni/global" />

interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly VITE_CLOUD_ENV_ID?: string;
  readonly VITE_APP_ENV?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.vue' {
  import { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
