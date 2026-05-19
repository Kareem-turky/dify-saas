import './styles.css';
import type { ReactNode } from 'react';

export const metadata = { title: 'Fulfly AI SaaS', description: 'Dify-powered AI Studio for WhatsApp and Messenger' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="ar" dir="rtl"><body>{children}</body></html>;
}
