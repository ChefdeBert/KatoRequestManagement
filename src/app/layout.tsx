import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kato · Cassava AI Software Factory',
  description: 'Conversational demand intake and BRD generation for Cassava Technologies',
  icons: { icon: '/kato.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">{children}</body>
    </html>
  );
}
