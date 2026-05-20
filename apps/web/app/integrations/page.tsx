"use client";

import { FormEvent, useEffect, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';

type WhatsappChannel = {
  id: string;
  organizationId: string;
  channelType: string;
  phoneNumberId?: string | null;
  wabaId?: string | null;
  status: string;
  lastError?: string | null;
  hasAccessToken: boolean;
  hasVerifyToken: boolean;
  hasAppSecret: boolean;
  difyAppId?: string | null;
  hasDifyAppApiKey: boolean;
  webhookUrl: string;
  updatedAt: string;
};

type MessengerChannel = {
  id: string;
  organizationId: string;
  channelType: string;
  pageId?: string | null;
  pageName?: string | null;
  status: string;
  lastError?: string | null;
  hasPageAccessToken: boolean;
  hasVerifyToken: boolean;
  hasAppSecret: boolean;
  difyAppId?: string | null;
  hasDifyAppApiKey: boolean;
  webhookUrl: string;
  updatedAt: string;
};

export default function IntegrationsPage(){
  const [token, setToken] = useState('');
  const [channel, setChannel] = useState<WhatsappChannel | null>(null);
  const [messengerChannel, setMessengerChannel] = useState<MessengerChannel | null>(null);
  const [message, setMessage] = useState('');
  const [testTo, setTestTo] = useState('');
  const [testText, setTestText] = useState('هل البوت شغال؟');

  useEffect(() => {
    const storedToken = localStorage.getItem('authToken') || '';
    setToken(storedToken);
    if (storedToken) { void loadWhatsapp(storedToken); void loadMessenger(storedToken); }
  }, []);

  async function loadWhatsapp(authToken = token) {
    if (!authToken) {
      setMessage('سجل دخولك الأول من صفحة signup/login حتى تظهر إعدادات القنوات.');
      return;
    }
    const response = await fetch(`${API_BASE}/channels/whatsapp`, { headers: { Authorization: `Bearer ${authToken}` } });
    if (response.status === 404) {
      setChannel(null);
      setMessage('WhatsApp غير مفعّل بعد. احفظ الإعدادات لتجهيز Webhook URL.');
      return;
    }
    if (!response.ok) throw new Error('تعذر تحميل إعدادات WhatsApp.');
    setChannel(await response.json());
    setMessage('');
  }

  async function sendTestMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setMessage('سجل دخولك الأول قبل إرسال رسالة اختبار.');
      return;
    }
    setMessage('جاري إرسال رسالة اختبار إلى Dify ثم WhatsApp...');
    const response = await fetch(`${API_BASE}/channels/whatsapp/test-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to: testTo, text: testText })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data.message || 'فشل إرسال رسالة الاختبار.');
      return;
    }
    setMessage(`تم إرسال test message بنجاح. WhatsApp event: ${data.outboundEvent?.eventId || 'sent'}`);
    await loadWhatsapp();
  }

  async function loadMessenger(authToken = token) {
    if (!authToken) return;
    const response = await fetch(`${API_BASE}/channels/messenger`, { headers: { Authorization: `Bearer ${authToken}` } });
    if (response.status === 404) {
      setMessengerChannel(null);
      return;
    }
    if (!response.ok) throw new Error('تعذر تحميل إعدادات Messenger/Page.');
    setMessengerChannel(await response.json());
  }

  async function saveMessenger(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!token) {
      setMessage('سجل دخولك الأول قبل حفظ إعدادات Messenger/Page.');
      return;
    }
    const formData = new FormData(form);
    const payload = {
      pageId: String(formData.get('pageId') || ''),
      pageName: String(formData.get('pageName') || '') || undefined,
      pageAccessToken: String(formData.get('pageAccessToken') || ''),
      verifyToken: String(formData.get('messengerVerifyToken') || ''),
      appSecret: String(formData.get('messengerAppSecret') || '') || undefined,
      difyAppId: String(formData.get('messengerDifyAppId') || '') || undefined,
      difyAppApiKey: String(formData.get('messengerDifyAppApiKey') || '') || undefined
    };
    setMessage('جاري حفظ إعدادات Messenger/Page...');
    const response = await fetch(`${API_BASE}/channels/messenger`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data.message || 'فشل حفظ إعدادات Messenger/Page.');
      return;
    }
    setMessengerChannel(data);
    form.reset();
    setMessage('تم حفظ إعدادات Messenger/Page بدون عرض الأسرار مرة أخرى.');
  }

  async function saveWhatsapp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!token) {
      setMessage('سجل دخولك الأول قبل حفظ إعدادات WhatsApp.');
      return;
    }

    const formData = new FormData(form);
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
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message || 'فشل حفظ إعدادات WhatsApp.');
    }
    setChannel(await response.json());
    form.reset();
    setMessage('تم حفظ إعدادات WhatsApp بدون عرض الأسرار مرة أخرى.');
  }

  return <main className="shell">
    <h1>Integrations</h1>
    <p>Phase 3 حسب الخطة: WhatsApp channel + Meta webhooks + ربط Dify App للردود.</p>
    {message && <p>{message}</p>}

    <div className="grid">
      <div className="item"><h3>WhatsApp Cloud API</h3><p>Status: {channel?.status || 'Not connected'}</p></div>
      <div className="item"><h3>Webhook</h3><p>{channel ? 'Configured URL ready' : 'Save settings to generate URL'}</p></div>
      <div className="item"><h3>Secrets</h3><p>{channel?.hasAccessToken ? 'WhatsApp token stored encrypted' : 'WhatsApp token not stored yet'}</p></div>
      <div className="item"><h3>Dify App</h3><p>{channel?.hasDifyAppApiKey ? 'Linked for auto-replies' : 'Not linked yet'}</p></div>
      <div className="item"><h3>Messenger/Page</h3><p>{messengerChannel?.status || 'Not connected'}</p></div>
    </div>

    <section style={{marginTop: 32}}>
      <h2>WhatsApp channel settings</h2>
      <form className="card" onSubmit={saveWhatsapp}>
        <label>Phone Number ID<input name="phoneNumberId" defaultValue={channel?.phoneNumberId || ''} required /></label>
        <label>WhatsApp Business Account ID<input name="wabaId" defaultValue={channel?.wabaId || ''} required /></label>
        <label>Permanent Access Token<input name="accessToken" type="password" placeholder={channel?.hasAccessToken ? 'Stored — enter a new token to rotate' : 'Meta permanent token'} required={!channel?.hasAccessToken} /></label>
        <label>Verify Token<input name="verifyToken" placeholder={channel?.hasVerifyToken ? 'Stored — enter again to update' : 'Webhook verify token'} required={!channel?.hasVerifyToken} /></label>
        <label>App Secret optional<input name="appSecret" type="password" placeholder={channel?.hasAppSecret ? 'Stored — enter a new secret to rotate' : 'Meta app secret'} /></label>
        <label>Dify App ID<input name="difyAppId" defaultValue={channel?.difyAppId || ''} placeholder="Dify app id/name for this WhatsApp number" /></label>
        <label>Dify App API Key<input name="difyAppApiKey" type="password" placeholder={channel?.hasDifyAppApiKey ? 'Stored encrypted — enter a new key to rotate' : 'Dify App API key'} /></label>
        <button className="btn" type="submit">Save WhatsApp settings</button>
      </form>
    </section>

    {channel && <section style={{marginTop: 32}}>
      <h2>Meta webhook setup</h2>
      <div className="item">
        <p>Webhook URL:</p>
        <code>{channel.webhookUrl}</code>
        <p>WhatsApp/Dify secrets are encrypted server-side only and are never returned to the browser.</p>
        {channel.lastError && <p>Last error: {channel.lastError}</p>}
      </div>
    </section>}


    <section style={{marginTop: 32}}>
      <h2>Messenger / Facebook Page settings</h2>
      <form className="card" onSubmit={saveMessenger}>
        <label>Facebook Page ID<input name="pageId" defaultValue={messengerChannel?.pageId || ''} required /></label>
        <label>Page Name optional<input name="pageName" defaultValue={messengerChannel?.pageName || ''} placeholder="Support Page" /></label>
        <label>Page Access Token<input name="pageAccessToken" type="password" placeholder={messengerChannel?.hasPageAccessToken ? 'Stored — enter a new token to rotate' : 'Meta Page token'} required={!messengerChannel?.hasPageAccessToken} /></label>
        <label>Verify Token<input name="messengerVerifyToken" placeholder={messengerChannel?.hasVerifyToken ? 'Stored — enter again to update' : 'Webhook verify token'} required={!messengerChannel?.hasVerifyToken} /></label>
        <label>App Secret optional<input name="messengerAppSecret" type="password" placeholder={messengerChannel?.hasAppSecret ? 'Stored — enter a new secret to rotate' : 'Meta app secret'} /></label>
        <label>Dify App ID<input name="messengerDifyAppId" defaultValue={messengerChannel?.difyAppId || ''} placeholder="Dify app id/name for this Messenger Page" /></label>
        <label>Dify App API Key<input name="messengerDifyAppApiKey" type="password" placeholder={messengerChannel?.hasDifyAppApiKey ? 'Stored encrypted — enter a new key to rotate' : 'Dify App API key'} /></label>
        <button className="btn" type="submit">Save Messenger/Page settings</button>
      </form>
      {messengerChannel && <div className="item" style={{marginTop: 16}}>
        <p>Webhook URL:</p>
        <code>{messengerChannel.webhookUrl}</code>
        {messengerChannel.lastError && <p>Last error: {messengerChannel.lastError}</p>}
      </div>}
    </section>

    {channel && <section style={{marginTop: 32}}>
      <h2>Test message</h2>
      <form className="card" onSubmit={sendTestMessage}>
        <label>Recipient WhatsApp number<input value={testTo} onChange={event => setTestTo(event.target.value)} placeholder="201111111111" required /></label>
        <label>Test prompt<input value={testText} onChange={event => setTestText(event.target.value)} required /></label>
        <button className="btn" type="submit" disabled={!channel.hasAccessToken || !channel.hasDifyAppApiKey}>Send test message</button>
      </form>
      <p>الاختبار يرسل النص إلى Dify App API ثم يرسل رد Dify إلى رقم WhatsApp المحدد، ويسجل inbound/outbound events.</p>
    </section>}

    <section style={{marginTop: 32}}>
      <h2>Next</h2>
      <p>Phase 3 اكتملت وظيفياً: settings + webhooks + Dify replies + retries + status callbacks + test message. التالي Phase 4: Messenger/Pages وproduction hardening.</p>
    </section>
  </main>;
}
