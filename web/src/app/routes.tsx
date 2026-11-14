import { lazy, Suspense } from 'react'
import type { RouteObject } from 'react-router-dom'
import { Layout } from './Layout'
import { DataPage } from '../pages/DataPage'
import { LearnPage } from '../pages/LearnPage'

// The navigator carries the 3D engine; load it as its own chunk so the text pages open fast.
const NavigatorPage = lazy(() => import('./NavigatorPage').then((m) => ({ default: m.NavigatorPage })))

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      {
        index: true,
        element: (
          <Suspense fallback={<p className="status">Loading the navigator…</p>}>
            <NavigatorPage />
          </Suspense>
        ),
      },
      { path: 'data', element: <DataPage /> },
      { path: 'learn', element: <LearnPage /> },
    ],
  },
]
