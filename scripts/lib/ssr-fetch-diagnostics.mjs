// Disposable verification only: diagnose the exact framework warning without
// recording request arguments, headers, bodies or signed URLs.
const warning = 'Avoid calling `fetch` eagerly during server-side rendering — put your `fetch` calls inside `onMount` or a `load` function instead';
if (process.env.CITA_VERIFICATION_RUN_ID) {
 const original = console.warn.bind(console);
 let remaining = 8;
 console.warn = (...args) => {
  original(...args);
  if (args[0] !== warning || remaining-- <= 0) return;
  const previousLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 24;
  let stack;
  try { stack = new Error('CITA_SSR_FETCH_CALLSITE').stack?.split('\n').slice(1, 25)
   .map(line => line.replace(/\?[^\s)]*/g, '').slice(0, 500)); }
  finally { Error.stackTraceLimit = previousLimit; }
  original('CITA_SSR_FETCH_CALLSITE', stack ?? []);
 };
}
