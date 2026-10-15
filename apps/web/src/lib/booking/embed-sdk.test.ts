/** @vitest-environment jsdom */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';

const source = readFileSync(new NodeURL('../../../static/booking/embed-v1.js', import.meta.url), 'utf8');
const key = 'a'.repeat(32);
const origin = 'https://booking.example.test';
let api: any;
const hostApi = () => (window as any).CitaSuiteBooking;
const frame = () => document.querySelector('iframe')!;
function send(type: string, extra = {}, overrides: Partial<MessageEventInit> = {}) {
  const instanceId = new URL(frame().src).searchParams.get('instance_id');
  window.dispatchEvent(new MessageEvent('message', { origin, source: frame().contentWindow, data: { protocol: 'cita-suite.booking', version: 1, instanceId, type, ...extra }, ...overrides }));
}
beforeEach(() => {
  vi.useFakeTimers(); document.body.innerHTML = '<button id="trigger">Reservar</button>'; sessionStorage.clear();
  delete (window as any).CitaSuiteBooking;
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function () { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function () { this.removeAttribute('open'); } });
  window.eval(source);
});
afterEach(() => { api?.destroy(); api = null; vi.useRealTimers(); });
describe('framework-independent booking host', () => {
  it('loads lazily, keeps the attempt after closing and restores focus', () => {
    const trigger = document.getElementById('trigger')!; trigger.focus();
    api = hostApi().mount({ integrationKey: key, baseURL: origin });
    expect(frame().hasAttribute('src')).toBe(false);
    api.open(); const url = frame().src; expect(new URL(url).searchParams.get('recover')).toBe('1');
    api.close(); expect(frame().src).toBe(url); expect(document.activeElement).toBe(trigger);
    api.open(); expect(frame().src).toBe(url);
  });
  it('ignores messages from spoofed origin, other frames or unsupported versions', () => {
    api = hostApi().mount({ integrationKey: key, baseURL: origin, mode: 'inline' });
    send('ready', {}, { origin: 'https://attacker.example.test' }); expect(frame().hidden).toBe(true);
    send('ready', {}, { source: window }); expect(frame().hidden).toBe(true);
    send('ready', { version: 2 }); expect(frame().hidden).toBe(true);
    send('resize', { height: Infinity }); expect(frame().style.height).toBe('');
    send('ready'); expect(frame().hidden).toBe(false);
    send('resize', { height: 650 }); expect(frame().style.height).toBe('650px');
  });
  it('persists only an attempt reference, reuses it on retry and offers recovery on timeout', () => {
    api = hostApi().mount({ integrationKey: key, baseURL: origin, mode: 'inline' });
    const id = new URL(frame().src).searchParams.get('request_id');
    expect(Object.values(sessionStorage)).toEqual([id]);
    vi.advanceTimersByTime(15000);
    const fallback = document.querySelector('.cita-booking-feedback a') as HTMLAnchorElement;
    expect(fallback.hidden).toBe(false); expect(new URL(fallback.href).searchParams.get('request_id')).toBe(id);
    expect(new URL(fallback.href).searchParams.has('parent_origin')).toBe(false);
    (document.querySelector('.cita-booking-feedback button') as HTMLButtonElement).click();
    expect(new URL(frame().src).searchParams.get('request_id')).toBe(id);
    api.destroy(); api = hostApi().mount({ integrationKey: key, baseURL: origin, mode: 'inline' });
    expect(new URL(frame().src).searchParams.get('request_id')).toBe(id);
  });
  it('never forwards completion payloads to the website and clears the completed attempt', () => {
    const onComplete = vi.fn();
    api = hostApi().mount({ integrationKey: key, baseURL: origin, mode: 'inline', onComplete });
    send('completed', { patientName: 'Must never leave frame', phone: 'private', answers: { medication: 'private' } });
    send('completed');
    expect(onComplete).toHaveBeenCalledTimes(1); expect(onComplete).toHaveBeenCalledWith(); expect(sessionStorage.length).toBe(0);
  });
  it('allows a new intent only when the frame provides a valid request reference', () => {
    api = hostApi().mount({ integrationKey: key, baseURL: origin, mode: 'inline' });
    const first = Object.values(sessionStorage)[0]; send('request', { requestId: 'invalid' });
    expect(Object.values(sessionStorage)[0]).toBe(first);
    const next = '12345678-1234-4234-8234-123456789012'; send('request', { requestId: next });
    expect(Object.values(sessionStorage)[0]).toBe(next);
  });
  it('deduplicates mounts and fully removes event handling on destruction', () => {
    api = hostApi().mount({ integrationKey: key, baseURL: origin, mode: 'inline' });
    expect(() => hostApi().mount({ integrationKey: key, baseURL: origin })).toThrow();
    api.destroy(); expect(document.querySelector('iframe')).toBeNull();
    expect(() => api.open()).toThrow();
    api = hostApi().mount({ integrationKey: key, baseURL: origin, mode: 'inline' });
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
  });
  it.each(['http://remote.example.test', 'https://booking.example.test/path', 'javascript:alert(1)'])('refuses unsafe booking service %s', (baseURL) => {
    expect(() => hostApi().mount({ integrationKey: key, baseURL })).toThrow();
    expect(document.querySelector('iframe')).toBeNull();
  });
  it('installs copied markup once, preserves an invalid block fallback and never removes the manual API', () => {
    document.body.insertAdjacentHTML('beforeend', `<div data-cita-suite-booking="bad-key"><a data-cita-suite-fallback href="/">Fallback</a></div><div data-cita-suite-booking="${key}"><a data-cita-suite-fallback href="${origin}/embed/v1/${key}">Reservar turno</a></div>`);
    const installed=hostApi().install();
    expect(installed).toHaveLength(1);
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
    expect(new URL(frame().src).pathname).toBe('/embed/v1/'+key);
    expect((document.querySelector('[data-cita-suite-booking="bad-key"] a') as HTMLAnchorElement).hidden).toBe(false);
    expect((document.querySelector(`[data-cita-suite-booking="${key}"] a`) as HTMLAnchorElement).hidden).toBe(true);
    expect(hostApi().install()[0]).toBe(installed[0]);
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
    expect(typeof hostApi().mount).toBe('function');
    installed.forEach((widget:any)=>widget.destroy());
  });
});
