export function isReportPeriodWithinRange(
  periodStart: string,
  periodEnd: string,
  rangeStart: string,
  rangeEnd: string,
): boolean {
  return periodStart >= rangeStart && periodEnd <= rangeEnd;
}
