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

export default function IntegrationsPage(){
  const [token, setToken] = useState('');
  const [channel, setChannel] = useState<WhatsappChannel | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const storedToken = localStorage.getItem('authToken') || '';
    setToken(storedToken);
    if (storedToken) void loadWhatsapp(storedToken);
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
      <h2>Next</h2>
      <p>الخطوة التالية: تحسين retries/status callbacks وواجهة اختبار الرسائل من داخل المنصة.</p>
    </section>
  </main>;
}
