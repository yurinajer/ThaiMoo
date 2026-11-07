import { $, createElement } from '../lib/utils';

let toastContainer: HTMLElement | null = null;

function getContainer(): HTMLElement {
  if (!toastContainer) {
    toastContainer = createElement('div', { className: 'toast-container' });
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

export function showToast(message: string, type: 'info' | 'success' | 'error' = 'info', duration = 2000): void {
  const container = getContainer();
  const toast = createElement('div', { className: `toast toast-${type}` }, message);
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

export function showSuccess(message: string): void {
  showToast(message, 'success');
}

export function showError(message: string): void {
  showToast(message, 'error');
}
