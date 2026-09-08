import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <div style={{ fontSize: 40, fontWeight: 700, color: '#98a2b3', marginBottom: 8 }}>404</div>
      <div className="view-sub" style={{ marginBottom: 16 }}>页面不存在</div>
      <Link className="link-btn" to="/">返回首页</Link>
    </div>
  )
}
