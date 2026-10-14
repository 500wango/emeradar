export * from './types';
export * from './basis';
export * from './generator';
export * from './render-markdown';
export * from './render-html';
export * from './localization';

// 点火包**刻意不从桶里导出**，走 `@emeradar/report/launch-kit` 这条子路径。
//
// 原因不是洁癖：`launch-kit.ts` 依赖 `node:crypto` 与 `node:zlib`（产物指纹与 ZIP
// 打包），而 web 端的三个客户端组件（FeedClient / GoalSimulator / ReportStudioClient）
// 从这个桶里取值。让它们经由桶把 node 内建模块拉进浏览器包，构建会直接失败——
// 而失败信息（`UnhandledSchemeError: node:zlib`）指向的是构建配置，不是这里。
// 把它划成独立入口，等于把"点火包是服务端制品"这件事写进包的形状里。
