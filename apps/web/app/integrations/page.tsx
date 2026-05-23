'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useAuth, RequireAuth } from '../auth';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

type WhatsappChannel = {
  id: string; organizationId: string; channelType: string;
  phoneNumberId?: string | null; wabaId?: string | null;
  status: string; lastError?: string | null;
  hasAccessToken: boolean; hasVerifyToken: boolean; hasAppSecret: boolean;
  difyAppId?: string | null; hasDifyAppApiKey: boolean;
  webhookUrl: string; updatedAt: string;
};

type MessengerChannel = {
  id: string; organizationId: string; channelType: string;
  pageId?: string | null; pageName?: string | null;
  status: string; lastError?: string | null;
  hasPageAccessToken: boolean; hasVerifyToken: boolean; hasAppSecret: boolean;
  difyAppId?: string | null; hasDifyAppApiKey: boolean;
  webhookUrl: string; updatedAt: string;
};

export default function IntegrationsPage() {
  const { token } = useAuth();
  const [channel, setChannel] = useState<WhatsappChannel | null>(null);
  const [messengerChannel, setMessengerChannel] = useState<MessengerChannel | null>(null);
  const [message, setMessage] = useState('');
  const [testTo, setTestTo] = useState('');
  const [testText, setTestText] = useState('هل البوت شغال؟');

  useEffect(() => {
    if (!token) return;
    void loadWhatsapp();
    void loadMessenger();
  }, [token]);

  async function loadWhatsapp() {
    if (!token) return;
    const response = await fetch(`${API_BASE}/channels/whatsapp`, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 404) { setChannel(null); setMessage('WhatsApp غير مفعّل بعد. احفظ الإعدادات لتجهيز Webhook URL.'); return; }
    if (!response.ok) { setMessage('تعذر تحميل إعدادات WhatsApp.'); return; }
    setChannel(await response.json());
    setMessage('');
  }

  async function loadMessenger() {
    if (!token) return;
    const response = await fetch(`${API_BASE}/channels/messenger`, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 404) { setMessengerChannel(null); return; }
    if (!response.ok) return;
    setMessengerChannel(await response.json());
  }

  async function saveWhatsapp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    const formData = new FormData(event.currentTarget);
    const payload = {
      phoneNumberId: String(formData.get('phoneNumberId') || ''),
      wabaId: String(formData.get('wabaId') || ''),
      accessToken: String(formData.get('accessToken') || ''),
      verifyToken: String(formData.get('verifyToken') || ''),
      appSecret: String(formData.get('appSecret') || '') || undefined,
      difyAppId: String(formData.get('difyAppId') || '') || undefined,
      difyAppApiKey: String(formData.get('difyAppApiKey') || '') || undefined
    };
    setMessage('جاري حفظ إعدادات WhatsApp...');
    const response = await fetch(`${API_BASE}/channels/whatsapp`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(payload)
    });
    if (!response.ok) { const b = await response.json().catch(() => ({})); setMessage(b.message || 'فشل الحفظ'); return; }
    setChannel(await response.json());
    (event.target as HTMLFormElement).reset();
    setMessage('تم حفظ إعدادات WhatsApp.');
  }

  async function saveMessenger(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    const formData = new FormData(event.currentTarget);
    const payload = {
      pageId: String(formData.get('pageId') || ''),
      pageName: String(formData.get('pageName') || '') || undefined,
      pageAccessToken: String(formData.get('pageAccessToken') || ''),
      verifyToken: String(formData.get('messengerVerifyToken') || ''),
      appSecret: String(formData.get('messengerAppSecret') || '') || undefined,
      difyAppId: String(formData.get('messengerDifyAppId') || '') || undefined,
      difyAppApiKey: String(formData.get('messengerDifyAppApiKey') || '') || undefined
    };
    setMessage('جاري حفظ إعدادات Messenger...');
    const response = await fetch(`${API_BASE}/channels/messenger`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(payload)
    });
    if (!response.ok) { const b = await response.json().catch(() => ({})); setMessage(b.message || 'فشل الحفظ'); return; }
    setMessengerChannel(await response.json());
    (event.target as HTMLFormElement).reset();
    setMessage('تم حفظ إعدادات Messenger.');
  }

  async function sendTestMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setMessage('جاري إرسال رسالة اختبار...');
    const response = await fetch(`${API_BASE}/channels/whatsapp/test-message`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to: testTo, text: testText })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(data.message || 'فشل الإرسال'); return; }
    setMessage(`تم إرسال test message بنجاح. Event: ${data.outboundEvent?.eventId || 'sent'}`);
  }

  return <RequireAuth>
    <main className="shell">
      <h1>القنوات والتكاملات</h1>
      {message && <div className="item" style={{ marginTop: 16 }}><p>{message}</p></div>}

      <div className="grid" style={{ marginTop: 24 }}>
        <div className="item"><h3>WhatsApp Cloud API</h3><p>Status: {channel?.status || 'غير متصل'}</p></div>
        <div className="item"><h3>Webhook</h3><p>{channel ? 'URL جاهز' : 'احفظ الإعدادات الأول'}</p></div>
        <div className="item"><h3>Secrets</h3><p>{channel?.hasAccessToken ? 'Token مشفر ✅' : 'لم يُحفظ بعد'}</p></div>
        <div className="item"><h3>Dify App</h3><p>{channel?.hasDifyAppApiKey ? 'متصل للردود ✅' : 'غير متصل'}</p></div>
        <div className="item"><h3>Messenger/Page</h3><p>{messengerChannel?.status || 'غير متصل'}</p></div>
      </div>

      <section style={{ marginTop: 32 }}>
        <h2>إعدادات WhatsApp</h2>
        <form className="card" onSubmit={saveWhatsapp}>
          <label>Phone Number ID<input name="phoneNumberId" className="input" defaultValue={channel?.phoneNumberId || ''} required /></label>
          <label>WABA ID<input name="wabaId" className="input" defaultValue={channel?.wabaId || ''} required /></label>
          <label>Access Token<input name="accessToken" type="password" className="input" placeholder={channel?.hasAccessToken ? 'مخزن — ادخل جديد للتحديث' : 'Meta token'} required={!channel?.hasAccessToken} /></label>
          <label>Verify Token<input name="verifyToken" className="input" placeholder={channel?.hasVerifyToken ? 'مخزن' : 'Webhook verify token'} required={!channel?.hasVerifyToken} /></label>
          <label>App Secret (اختياري)<input name="appSecret" type="password" className="input" placeholder={channel?.hasAppSecret ? 'مخزن' : 'Meta app secret'} /></label>
          <label>Dify App ID<input name="difyAppId" className="input" defaultValue={channel?.difyAppId || ''} placeholder="Dify app id" /></label>
          <label>Dify App API Key<input name="difyAppApiKey" type="password" className="input" placeholder={channel?.hasDifyAppApiKey ? 'مخزن مشفر' : 'Dify API key'} /></label>
          <button className="btn" type="submit">حفظ إعدادات WhatsApp</button>
        </form>
      </section>

      {channel && <section style={{ marginTop: 32 }}>
        <h2>Webhook URL</h2>
        <div className="item">
          <code style={{ wordBreak: 'break-all' }}>{channel.webhookUrl}</code>
          {channel.lastError && <p style={{ color: 'var(--bad)' }}>Last error: {channel.lastError}</p>}
        </div>
      </section>}

      <section style={{ marginTop: 32 }}>
        <h2>إعدادات Messenger / Facebook Page</h2>
        <form className="card" onSubmit={saveMessenger}>
          <label>Page ID<input name="pageId" className="input" defaultValue={messengerChannel?.pageId || ''} required /></label>
          <label>Page Name (اختياري)<input name="pageName" className="input" defaultValue={messengerChannel?.pageName || ''} placeholder="Support Page" /></label>
          <label>Page Access Token<input name="pageAccessToken" type="password" className="input" placeholder={messengerChannel?.hasPageAccessToken ? 'مخزن' : 'Meta Page token'} required={!messengerChannel?.hasPageAccessToken} /></label>
          <label>Verify Token<input name="messengerVerifyToken" className="input" placeholder={messengerChannel?.hasVerifyToken ? 'مخزن' : 'Webhook verify token'} required={!messengerChannel?.hasVerifyToken} /></label>
          <label>App Secret (اختياري)<input name="messengerAppSecret" type="password" className="input" placeholder={messengerChannel?.hasAppSecret ? 'مخزن' : 'Meta app secret'} /></label>
          <label>Dify App ID<input name="messengerDifyAppId" className="input" defaultValue={messengerChannel?.difyAppId || ''} /></label>
          <label>Dify App API Key<input name="messengerDifyAppApiKey" type="password" className="input" placeholder={messengerChannel?.hasDifyAppApiKey ? 'مخزن مشفر' : 'Dify API key'} /></label>
          <button className="btn" type="submit">حفظ إعدادات Messenger</button>
        </form>
        {messengerChannel && <div className="item" style={{ marginTop: 16 }}>
          <code style={{ wordBreak: 'break-all' }}>{messengerChannel.webhookUrl}</code>
          {messengerChannel.lastError && <p style={{ color: 'var(--bad)' }}>Last error: {messengerChannel.lastError}</p>}
        </div>}
      </section>

      {channel && <section style={{ marginTop: 32 }}>
        <h2>رسالة اختبار</h2>
        <form className="card" onSubmit={sendTestMessage}>
          <label>رقم WhatsApp<input value={testTo} onChange={e => setTestTo(e.target.value)} className="input" placeholder="201111111111" required /></label>
          <label>نص الاختبار<input value={testText} onChange={e => setTestText(e.target.value)} className="input" required /></label>
          <button className="btn" type="submit" disabled={!channel.hasAccessToken || !channel.hasDifyAppApiKey}>إرسال رسالة اختبار</button>
        </form>
      </section>}
    </main>
  </RequireAuth>;
}
