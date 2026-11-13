import type { Metadata, Viewport } from 'next';
import { Montserrat } from 'next/font/google';
import './globals.css';

// Brand typeface, self-hosted by next/font at build time (no request to Google from users' browsers)
const montserrat = Montserrat({ subsets: ['latin'], display: 'swap', variable: '--font-montserrat' });

export const metadata: Metadata = {
  title: 'Kato · Cassava AI Software Factory',
  description: 'Conversational demand intake and BRD generation for Cassava Technologies',
  icons: { icon: '/kato.svg' },
};

export const viewport: Viewport = { themeColor: '#001D58' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={montserrat.variable}>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">{children}</body>
    </html>
  );
}
