import { supabase } from './supabase';

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.register('/sw.js');
  void registration.update();
  return registration;
}

export function getInstallState() {
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in window.navigator && Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone));

  return {
    isStandalone,
    canNotify: 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window,
    permission: 'Notification' in window ? Notification.permission : 'unsupported',
  };
}

export async function subscribeToNotifications() {
  const publicVapidKey = import.meta.env.VITE_PUBLIC_VAPID_KEY as string | undefined;
  if (!publicVapidKey) {
    throw new Error('Thieu VITE_PUBLIC_VAPID_KEY.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Người dùng chưa cấp quyền notification.');
  }

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicVapidKey),
  });

  if (supabase) {
    const { error } = await supabase.functions.invoke('register-push-subscription', {
      body: {
        subscription: subscription.toJSON(),
        userAgent: navigator.userAgent,
      },
    });
    if (error) throw error;
  }

  return subscription.toJSON();
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}
