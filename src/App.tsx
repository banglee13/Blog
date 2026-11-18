import { Suspense, lazy } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { useBackground } from './lib/background'
import Home from './pages/Home'

const GalaxyHome = lazy(() => import('../cosmic/GalaxyHome'))
const PostPage = lazy(() => import('./pages/PostPage'))
const Archive = lazy(() => import('./pages/Archive'))
const TagsPage = lazy(() => import('./pages/TagsPage'))
const Toolbox = lazy(() => import('./pages/Toolbox'))
const EchoCave = lazy(() => import('./pages/EchoCave'))
const GenshinData = lazy(() => import('./pages/GenshinData'))
const About = lazy(() => import('./pages/About'))
const Login = lazy(() => import('./pages/Login'))
const Admin = lazy(() => import('./pages/Admin'))
const Editor = lazy(() => import('./pages/Editor'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const NotFound = lazy(() => import('./pages/NotFound'))

function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" data-yield-list>
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
    </div>
  )
}

export default function App() {
  const { siteLayout } = useBackground()
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        {siteLayout === 'galaxy' && <Route index element={<GalaxyHome />} />}
        <Route element={<Layout />}>
          {siteLayout !== 'galaxy' && <Route index element={<Home />} />}
          <Route path="posts/:slug" element={<PostPage />} />
          <Route path="archive" element={<Archive />} />
          <Route path="tags" element={<TagsPage />} />
          <Route path="tags/:tag" element={<TagsPage />} />
          <Route path="toolbox" element={<Toolbox />} />
          <Route path="toolbox/echo" element={<EchoCave />} />
          <Route path="toolbox/genshin" element={<GenshinData />} />
          <Route path="toolbox/genshin/:kind/:id" element={<GenshinData />} />
          <Route path="about" element={<About />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="login" element={<Login />} />
          <Route path="admin" element={<Admin />} />
          <Route path="admin/new" element={<Editor />} />
          <Route path="admin/edit/:slug" element={<Editor />} />
          <Route path="editor" element={<Editor />} />
          <Route path="editor/:slug" element={<Editor />} />
          <Route path="admin/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
