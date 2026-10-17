// Compatibility export for callers of the former server parser. All active
// availability reads use availability-windows; no legacy RPC/table fallback.
export { parseIntegratedAvailabilityRows, type IntegratedAvailabilityRows } from '$lib/availability/rows';
