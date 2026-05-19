export const supportedLocales = ['ar', 'en'] as const;
export type SupportedLocale = (typeof supportedLocales)[number];

export const channelTypes = ['whatsapp', 'messenger', 'facebook_page'] as const;
export type ChannelType = (typeof channelTypes)[number];

export const paymentMethods = ['instapay', 'vodafone_cash', 'bank_transfer', 'card'] as const;
export type PaymentMethod = (typeof paymentMethods)[number];
