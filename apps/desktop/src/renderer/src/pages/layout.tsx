/**
 * 根布局：所有路由共用。
 * AppModelProvider（由 createCustomModel 生成）持有全局状态
 * （必须在 RouterProvider 内渲染，hook 里才能使用 useNavigate），
 * Shell 在初始状态加载完成前不渲染，避免页面拿到 null 设置。
 */
import { Outlet } from 'react-router-dom'
import { AppModelProvider, useApp } from '../appModel'
import { UpdateBanner } from '../components/UpdateBanner'

function Shell() {
  const { ready } = useApp()
  if (!ready) return null
  return (
    <div className="app">
      <UpdateBanner />
      <Outlet />
    </div>
  )
}

export default function RootLayout() {
  return (
    <AppModelProvider>
      <Shell />
    </AppModelProvider>
  )
}
