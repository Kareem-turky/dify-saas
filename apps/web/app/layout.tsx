import './styles.css';
import type { ReactNode } from 'react';
import { AuthProvider } from './auth';
import { I18nProvider } from './i18n';
import { Navbar } from './components/Navbar';

export const metadata = { title: 'Fulfly AI SaaS', description: 'Dify-powered AI Studio for WhatsApp and Messenger' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <I18nProvider>
          <AuthProvider>
            <Navbar />
            {children}
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
