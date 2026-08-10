import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const geistSans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })

export const metadata: Metadata = {
  title: 'Flowgent — AI Agent Workflow Builder',
  description:
    'A mini n8n for chaining AI agent steps: multi-org workflows, two-layer permissions, live run subscriptions, and an approval-gated execution engine.',
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#1a1b26',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable}`}>
      <body className="antialiased bg-background text-foreground font-sans">
        {children}
      </body>
    </html>
  )
}
