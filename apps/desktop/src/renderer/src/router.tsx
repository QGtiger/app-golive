/**
 * 文件式路由表（@lightfish/router + react-router-dom）。
 *
 * 约定（apps/desktop/src/renderer/src/pages/）：
 * - index.tsx   页面
 * - layout.tsx  布局（<Outlet /> 渲染子路由）
 * - 404.tsx     兜底页
 * - [param]     动态段 → :param
 *
 * 使用 createHashRouter：生产环境通过 win.loadFile 以 file:// 协议加载，
 * History API 路由在 file:// 下不可靠；hash 路由在开发与打包后均可正常工作。
 */
import { createFileRoutes } from '@lightfish/router'
import { createHashRouter, RouterProvider } from 'react-router-dom'

// 页面模块：排除 layout / 404 / settings 等特殊文件，只保留真正生成路由的页面
const pages = import.meta.glob(
  ['/src/pages/**/*.tsx', '!/src/pages/**/layout.tsx', '!/src/pages/**/404.tsx', '!/src/pages/**/settings.tsx'],
  { eager: true }
) as Record<string, any>
const layouts = import.meta.glob('/src/pages/**/layout.tsx', { eager: true }) as Record<string, any>
const notFounds = import.meta.glob('/src/pages/**/404.tsx', { eager: true }) as Record<string, any>
const settings = import.meta.glob('/src/pages/**/settings.tsx', { eager: true }) as Record<string, any>

const routeObjects = createFileRoutes({ pages, layouts, notFounds, settings })
const router = createHashRouter(routeObjects)

export function AppRouter() {
  return <RouterProvider router={router} />
}
