import { Suspense, lazy } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import Home from './pages/Home'
// 这几个页面各自只有一两 KB：直接进主包，页签之间跳转不必再等一次分包请求（issue #128）。
import Archive from './pages/Archive'
import TagsPage from './pages/TagsPage'
import Toolbox from './pages/Toolbox'
import NotFound from './pages/NotFound'
import { routeLoaders } from './routes'

// 较重的页面按需加载；同一批 loader 也用于预取（见 src/routes.ts）。
const PostPage = lazy(routeLoaders.post)
const EchoCave = lazy(routeLoaders.echo)
const GenshinData = lazy(routeLoaders.genshin)
const About = lazy(routeLoaders.about)
const Login = lazy(routeLoaders.login)
const Admin = lazy(routeLoaders.admin)
const Editor = lazy(routeLoaders.editor)
const SettingsPage = lazy(routeLoaders.settings)

function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" data-yield-list>
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
    </div>
  )
}

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
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
