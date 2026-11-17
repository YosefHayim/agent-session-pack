export function describeTouched(touched: boolean): string {
  return touched ? 'yes' : 'no';
}

export function describeStatus(status: string, reason: string | undefined): string {
  const isReasonMissing = reason == null;
  if (isReasonMissing) {
    return status;
  }

  return `${status} (${reason})`;
}
