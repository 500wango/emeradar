'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';

/**
 * 站点壳层：全局导航栏 + 正文 + 页脚。
 *
 * 存在的唯一理由是 `/admin`：控制台自带顶部导航（`admin/layout.tsx` 的 EMERADAR
 * OPS 条），而 `Navbar` 在管理员登录时也会渲染出指向 /admin、/admin/candidates、
 * /admin/sources、/admin/users 的同一批链接，两组导航上下叠在一起。
 *
 * 为什么把 <main> 也收进来：导航栏与页脚必须夹住正文。若它们作为两个独立的
 * flex 子项交给根 layout 摆放，一旦收敛成一个组件就会变成「导航栏、页脚、正文」
 * 的顺序（body 是 flex-col），页脚会跑到正文上方。收在一处，顺序由构造保证。
 *
 * 判断为什么必须在客户端：跟主题同一个约束 —— 根 layout 在软导航时不会重渲染，
 * 服务端也拿不到 pathname。`usePathname()` 在客户端组件里首帧就已知路径，服务端
 * 预渲染与客户端一致，不产生水合差异。children 由服务端 layout 传入，仍是服务端
 * 渲染的产物，不因为经过这里而变成客户端组件。
 *
 * 收口方向：等 (marketing)/(app) 路由组重组完成（docs/16 §2），应当由路由组决定
 * 谁渲染壳层，这个组件随之删除。
 */
export function SiteChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isConsole = pathname?.startsWith('/admin') ?? false;

  return (
    <>
      {!isConsole && <Navbar />}
      <main id="main-content" className="flex-1">
        {children}
      </main>
      {!isConsole && <Footer />}
    </>
  );
}
