import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { RouterProvider, createHashRouter } from 'react-router-dom'
import { routes } from './routes'

// HashRouter: GitHub Pages serves static files only, so /#/data survives a reload.
const router = createHashRouter(routes)

export function App() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }))
  return (
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
