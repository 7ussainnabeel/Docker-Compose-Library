export interface EmailConfig {
  enabled: boolean;
  address: string;
}

export interface PushNotificationConfig {
  enabled: boolean;
}

export interface WebHookConfig {
  enabled: boolean;
  url: string;
  provider: "ntfy" | "gotify" | "pushbits" | "pushbullet" | "custom";
  topic?: string;
  token?: string;
  userId?: string;
  accessToken?: string;
  headers?: string;
}

export interface SignalConfig {
  enabled: boolean;
  number: string;
  apiKey: string;
}

export interface TelegramConfig {
  enabled: boolean;
  chatId: string;
}

export interface SlackConfig {
  enabled: boolean;
  webhookUrl: string;
}

export interface MatrixConfig {
  enabled: boolean;
  homeserverUrl: string;
  accessToken: string;
}

export interface SmsConfig {
  enabled: boolean;
  number: string;
}

export interface WhatsAppConfig {
  enabled: boolean;
  number: string;
}

export interface NotificationPreferences {
  email?: EmailConfig;
  pushNotification?: PushNotificationConfig;
  webHook?: WebHookConfig;
  signal?: SignalConfig;
  telegram?: TelegramConfig;
  slack?: SlackConfig;
  matrix?: MatrixConfig;
  sms?: SmsConfig;
  whatsapp?: WhatsAppConfig;
}
