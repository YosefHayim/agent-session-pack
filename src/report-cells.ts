export const describeTouched = (touched: boolean): string => (touched ? 'yes' : 'no');

export const describeStatus = (status: string, reason: string | undefined): string => {
  const isReasonMissing = reason == null;
  if (isReasonMissing) {
    return status;
  }

  return `${status} (${reason})`;
};
