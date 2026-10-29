import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Toaster } from 'sonner'
import { ColorThemeProvider, useColorTheme } from '#/components/color-theme-provider'
import { TooltipProvider } from '#/components/ui/tooltip'
import appCss from '#/styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Website to PDF · Gotenui' },
      {
        name: 'description',
        content: 'A stateless document workspace using a same-origin Gotenberg API proxy.',
      },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', type: 'image/svg+xml', href: '/gotenui-icon.svg' },
    ],
  }),
  component: Root,
})

function Root() {
  return (
    <Document>
      <Outlet />
    </Document>
  )
}

function Document({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <ColorThemeProvider>
          <TooltipProvider>
            {children}
            <ThemeToaster />
          </TooltipProvider>
        </ColorThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}

function ThemeToaster() {
  const { theme } = useColorTheme()
  return <Toaster theme={theme} position="bottom-right" richColors closeButton />
}
