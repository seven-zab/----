/// <reference types="@dcloudio/types" />
/// <reference types="wot-design-uni/global" />

declare module '*.vue' {
  import { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
