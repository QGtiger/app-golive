/**
 * 项目详情布局：/detail/:id 及其子路由（config）共用。
 * - 门控：全局状态未加载完不渲染；项目记录不存在回首页；
 * - ProjectModelProvider 提供项目维度状态机（见 ./model.ts）。
 */
import { Navigate, Outlet, useParams } from 'react-router-dom'
import { useApp } from '../../../appModel'
import { ProjectModelProvider } from './model'

export default function DetailLayout() {
  const { ready, projects } = useApp()
  const { id } = useParams()
  if (!ready) return null
  if (!projects.some(p => p.id === id)) return <Navigate to="/" replace />
  return (
    <ProjectModelProvider>
      <Outlet />
    </ProjectModelProvider>
  )
}
