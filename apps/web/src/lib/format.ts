export function formatDate(val: any): string {
  if (!val) return '';
  if (val instanceof Date) {
    return val.toISOString().slice(0, 10);
  }
  return String(val).slice(0, 10);
}

export function formatDateTime(val: any): string {
  if (!val) return '';
  if (val instanceof Date) {
    return val.toISOString().slice(0, 16).replace('T', ' ');
  }
  return String(val).slice(0, 16).replace('T', ' ');
}
